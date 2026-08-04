---
id: "user-maintained-complexity-llm-routing"
title: "基于用户维护复杂度映射的 LLM 路由"
category: "decisions"
created: "2026-08-04"
updated: "2026-08-04"
related_initiatives: ["add-complexity-aware-llm-routing","implement-complexity-aware-llm-routing"]
tags: ["llm-routing","architecture","orchestration","complexity","opencode"]
---

# 基于用户维护复杂度映射的 LLM 路由

## 状态

架构设计已接受，核心配置、静态 Agent 注册、确定性解析和宿主默认 Task 回退契约已实现；可信运行时 override、安全失败判定和自动后续尝试尚未实现。

## 背景

Mdocs 编排模型在派发子代理前，根据当前 TUI 输入和可信上下文判断任务复杂度，再使用用户预先配置的 LLM。Mdocs 不使用外部 benchmark、内置模型能力画像、本地自动评测或运行时学习；用户决定每个复杂度等级对应哪些模型，以及同级模型的使用顺序。

## 已确认的边界

- `mdocs_dispatch` 只组装 initiative、plan、handoff、blockers、Wiki、检索记忆和 audit 上下文，不执行 Task，不返回路由状态，也看不到当前 TUI 原始输入。
- `mdocs-orchestrator` 先调用 `mdocs_dispatch`，再通过 OpenCode Task 派发子代理。
- OpenCode 支持静态 Agent 绑定模型；Task 逐次传入 `model` 或 `variant` 不是可依赖的稳定契约。
- Mdocs config hook 可以注册 Agent。
- OpenCode 顶层配置 schema 严格，当前默认插件入口也未消费 plugin tuple options，因此路由使用独立项目文件。
- 主 orchestrator 不硬编码具体模型。

## 核心决策

### 三级复杂度

| 等级 | 定义 | 典型任务 |
|---|---|---|
| `simple` | 目标和范围明确、局部、低风险、容易验证和撤销 | 修改已定位配置、解释明确函数、机械性维护 |
| `standard` | 常规多步骤任务，需要有限探索、跨相关文件修改及验证 | 常规功能、有限范围 Bug、现有模式内实现 |
| `complex` | 跨边界、高风险、关键歧义或架构级推理 | 协议、公共 API、迁移、安全、并发、重大重构 |

三级只表达任务复杂度，不表达模型速度、价格或能力。binding 名称及其模型含义完全由用户定义。

### 分类器只判断等级

```ts
type ComplexityLevel = "simple" | "standard" | "complex"

interface ClassificationResult {
  level: ComplexityLevel
  reasons: string[]
}
```

分类器不得选择或推荐 `agent`、`model`、`variant` 或 `binding`。额外路由字段必须被忽略并记录协议违规；具体执行目标只能由确定性程序根据结构化覆盖和用户配置解析。

### 唯一配置入口

```text
<项目根目录>/mdocs/routing.json
```

```json
{
  "schemaVersion": 1,
  "defaultLevel": "standard",
  "levels": {
    "simple": ["simple-primary", "simple-backup"],
    "standard": ["standard-primary", "standard-backup"],
    "complex": ["complex-primary", "complex-backup"]
  },
  "bindings": {
    "simple-primary": {
      "model": "provider-a/model-small",
      "variant": "fast"
    },
    "simple-backup": {
      "model": "provider-b/model-small"
    },
    "standard-primary": {
      "model": "provider-a/model-medium"
    },
    "standard-backup": {
      "model": "provider-b/model-medium"
    },
    "complex-primary": {
      "model": "provider-a/model-large",
      "variant": "reasoning"
    },
    "complex-backup": {
      "agent": "project-complex-runner"
    }
  },
  "overrides": {
    "allowedLevels": ["simple", "standard", "complex"],
    "allowedBindings": [
      "simple-primary",
      "simple-backup",
      "standard-primary",
      "standard-backup",
      "complex-primary",
      "complex-backup"
    ]
  }
}
```

`levels.<level>` 必须是有序且非空的 binding 数组。数组索引是唯一优先级：

- 索引越小，优先级越高；首选项索引为 `0`。
- 当前项可用时不访问后续项。
- 只有当前项在业务执行前发生可安全识别的基础设施失败时，才尝试 `index + 1`。
- 同一数组项在一次路由执行中最多尝试一次。
- 不评分、不随机、不轮询，也不按成本、延迟、历史结果或运行时信息重排。
- binding 不包含独立 `fallback` 字段。

多个等级可以引用同一个 binding；同一 binding 也可以只出现在结构化覆盖 allowlist 中。

## Binding target

每个 binding 必须且只能使用以下一种 target：

```text
{ model, variant? }
```

或：

```text
{ agent }
```

对于 model target，config hook 自动生成 `mdocs-route-<binding>`、`mode: subagent` 的静态 Agent，并应用 binding 的 `model`、可选 `variant` 和 Mdocs 统一执行提示。生成的 Agent 不覆盖宿主权限策略。用户无需重复创建 Agent。

对于 agent target，Mdocs 引用用户已有的静态 subagent，不修改其模型、提示、权限或工具；模型唯一来源是该 Agent 的 OpenCode 配置。不得同时声明 `agent` 和 `model`。

## `defaultLevel`

`defaultLevel` 只在以下分类失败时使用：

- 分类输出无法解析；
- 缺少 `level` 或其他必需字段；
- `level` 不是三个固定等级之一；
- 分类过程异常中断。

使用后，程序直接查询 `levels.<defaultLevel>`，从索引 `0` 开始处理，不再自动调整等级。它不是所有任务统一使用的常规默认路由。

## 复杂度判定

- `simple`：只有范围明确、目标单一、局部低风险、无需架构取舍、容易验证和撤销，且不存在升级信号时选择。
- `standard`：出现常规多步骤信号且没有 complex 信号时选择，例如先探索再修改、多个相关文件、实现与验证、有限需求解释空间或两个紧密相关层次。
- `complex`：出现任一强信号即选择，包括跨独立子系统或运行时边界；改变架构、协议、公共 API 或数据模型；迁移或不可逆变更；认证、授权、隐私、安全、资金或合规；并发、分布式一致性或复杂性能；关键歧义；长期架构取舍、多阶段 handoff、多个子代理协调；与既有决策明显冲突。

检查顺序为 `complex`、`standard`、`simple`；信号冲突时取最高等级，范围未知时不得选择 `simple`。

## 结构化覆盖

覆盖只能来自 TUI 结构化字段，普通自然语言和检索记忆不能产生覆盖。

```text
binding override > level override > classified level
```

- binding override 只尝试指定且允许的 binding，不隐式进入任何等级数组。
- level override 查询指定且允许等级的有序数组。
- 没有覆盖时使用合法分类结果。
- 分类失败时查询 `defaultLevel` 的有序数组。

## 同级备用与失败边界

只有能确认尚未产生业务副作用的基础设施失败，才允许从当前索引移动到 `index + 1`，例如：

- Agent 无法创建或目标 Agent 不存在；
- Provider 未配置、暂时不可用或明确限流；
- 模型不存在、无权限或 `variant` 不受支持；
- 首次模型请求在业务执行前连接失败。

以下情况不得尝试下一项：

- 子代理已经执行工具、写入文件或产生其他副作用；
- 实现、验证或业务结果失败；
- 输出质量不理想；
- 无法确认失败前是否已经产生副作用。

这些情况直接返回 orchestrator 处理，避免同一任务被另一模型重复执行。

## 路由流程

```text
TUI input + trusted context
-> read structured override
-> binding override: resolve one binding
-> level override: obtain that level's ordered array
-> otherwise classify level/reasons
-> validate classification or use defaultLevel
-> obtain ordered binding array
-> attempt index 0
-> on safe pre-execution infrastructure failure, attempt index + 1
-> 有有效 decision.agent: Task(subagent_type = resolved static agent)
-> 无有效 decision.agent: Task 使用宿主默认行为，不指定路由 Agent 或模型
```

`mdocs_dispatch` 接口保持不变，成功结果不附加 `routing` 字段；当前 TUI 输入由 orchestrator 独立持有。路由诊断由 `mdocs_status` 和 `mdocs_validate` 提供，本次路由结果由 `mdocs_route` 返回。

## 最小 RouteDecision

```ts
interface RouteDecision {
  classifiedLevel: ComplexityLevel
  reasons: string[]
  effectiveLevel: ComplexityLevel
  bindingOrder: string[]
  selectedBinding: string
  agent: string
  attemptIndex: number
  configHash: string
  override?: {
    type: "level" | "binding"
    value: string
    source: "tui"
  }
}
```

`attemptIndex` 与数组一样从零开始。

`RoutingManager.resolve()` 只有在静态 Agent 已完整激活时才返回带真实 `decision.agent` 的 resolved 结果。未配置、配置无效或尚未激活时返回 `fallback: "default-host"` 和 `decision: null`；配置摘要与错误、警告仍供 `mdocs_status`、`mdocs_validate` 和 `mdocs_route` 诊断，但插件不按诊断状态阻断宿主默认执行。

## 加载、凭据和校验

- 路由文件只保存模型标识和可选 `variant`，不保存 API key、token、OAuth 数据、header 或 provider 凭据。
- 文件不存在：路由禁用，保持现有行为。
- 文件有效：原子加载整份配置，为 model target 生成静态 Agent并校验 agent target。
- 文件存在但无效：整份配置失败，不注册任何路由 Agent，保留诊断并回到宿主默认模型和原有 Task 行为。
- 文件修改后需要重载项目或重启 OpenCode；当前设计不承诺热更新。
- 自动 Agent 使用保留前缀 `mdocs-route-`；同名不同定义时不覆盖并使整份配置失败，相同定义按幂等处理。
- `schemaVersion` 必须为 `1`；`levels` 完整包含三个非空数组；同一数组不允许重复项；所有项必须引用已声明 binding。
- binding 名称匹配 `^[A-Za-z][A-Za-z0-9-]{0,62}$`，允许大小写英文字母、数字和连字符，且必须以英文字母开头；恰好声明 `model` 或 `agent`；`variant` 只能与 `model` 共存；`fallback` 是非法字段。
- agent target 不得使用保留前缀，且必须存在、可作为 subagent 调用并静态绑定模型。

## 可观测性（后续要求）

后续应记录分类等级和理由、最终等级、binding 顺序、实际 binding、从零开始的尝试索引、Agent、模型、配置 hash、基础设施失败分类和 Task 状态。默认不记录完整 TUI 输入，也不根据执行结果修改规则或重排 binding。

## 设计范围

包含固定三级复杂度、`mdocs/routing.json`、每级有序 binding 数组、索引优先级、静态 Agent 注册/引用、结构化覆盖、安全的同级基础设施备用、RouteDecision、路由校验和状态摘要。

不包含外部 benchmark、能力画像、模型评分排序、随机或轮询、基于成本/历史的重排、动态 Task model/variant、热更新、自动评测、运行时学习、业务失败后自动换模型重做或多模型投票。

## 验收场景

1. 每个 level 接受非空有序 binding 数组。
2. 首项索引为 `0`，索引越小优先级越高。
3. 索引 `0` 可用时不访问后续项。
4. 仅在业务执行前可安全识别的基础设施失败后尝试 `index + 1`。
5. 同一数组项一次路由最多尝试一次。
6. 已执行工具、产生副作用或无法确认副作用时不尝试下一项。
7. 不评分、不随机、不轮询、不按成本或历史重排。
8. 未知或重复 binding、binding 中的 `fallback` 均使整份配置失败。
9. 分类非法、缺字段、无法解析或异常时使用 `defaultLevel` 并直接查询对应数组。
10. model target 自动生成 `mdocs-route-<binding>`；agent target 与 model target 互斥。
11. binding override 只使用指定 binding。
12. 无配置或配置无效时不伪造 Agent，保持宿主默认模型和原有 Task 行为。

## 后果

优点：配置紧凑；同级模型及优先级由数组直观表达；不存在备用关系图和环路；用户完全控制顺序；普通用户无需手工维护 Agent。

代价：系统不会按成本、健康度或历史表现自动优化顺序；后续实现需完成文件加载、schema 校验、Agent 注册、失败分类、状态展示和诊断。

## Referenced By

*Auto-generated by mdocs*

- add-complexity-aware-llm-routing
- implement-complexity-aware-llm-routing
