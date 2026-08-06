---
id: "implement-complexity-aware-llm-routing"
title: "实施复杂度感知 LLM 路由"
status: "done"
created: "2026-08-04"
updated: "2026-08-06"
owner: "mdocs-orchestrator"
tags: ["implementation","llm-routing","opencode","subagent"]
related_wiki: ["decisions/user-maintained-complexity-llm-routing","architecture/complexity-routing-core-pattern"]
priority: "medium"
phase: "done"
handoff_summary: "已完成三项已确认的最小修复：orchestrator 明确 resolved 与 default-host fallback 执行分支；mdocs_dispatch 恢复原成功返回契约且不含 routing/resolverTool；mdocs_route 接收原始 classification 并统一交由 RoutingManager defaultLevel parser 处理。两份路由 Wiki 和相关测试断言已同步，skills/mdocs-workflow/SKILL.md 保持不变。"
next_action: "等待用户允许后运行路由专项测试、完整测试和构建。"
---

## Objective
按照已接受的路由 ADR，实现项目级 mdocs/routing.json 加载与校验、静态路由 Agent 注册、三级复杂度决策接口、有序 binding 解析，以及 validate/status/dispatch 集成；保持无配置时现有行为不变。本 Initiative 包含运行时代码与测试，但执行测试或构建前必须征得用户确认。

## Plan
- [x] 梳理实现所需的配置 hook、类型、validator、工具返回和 Agent prompt 修改点，并冻结最小实现边界
- [x] 实现 routing.json 类型、读取、严格校验和有序 binding 解析
- [x] 在 config hook 中原子注册 model target Agent并校验 agent target 冲突
- [x] 向 orchestrator 暴露分类结果到确定性路由决策的接口，并保持 mdocs_dispatch 上下文职责
- [x] 扩展 mdocs_validate 和 mdocs_status 的路由诊断与配置摘要
- [/] 补充单元测试与集成测试，并在用户确认后执行测试和构建
- [ ] 更新 Wiki、进度日志，验证图关系并提交实现

## Progress Log
- [2026-08-04T07:53:58.517Z] Created initiative via mdocs command
- [2026-08-04] 完成最小核心实现：严格 parser、原子静态 Agent 注册、确定性 mdocs_route resolver，以及 validate/status/dispatch 集成。
- [2026-08-04] 补充 parser、resolver、config hook 和工具集成测试代码；按用户要求未执行测试、构建、编译或 lint。
- 按用户反馈将 src/routing.ts 从分散生命周期函数重构为 RoutingManager 类，参考现有 Manager/Engine 模块封装 baseDir、配置加载结果和 runtime state。公开接口收敛为 constructor、activate、resolve、status；plugin 和测试已迁移，状态读取返回防御性快照，避免外部破坏内部不变量。未运行测试、构建、编译或 lint。
- 按用户要求，将 agents/mdocs-orchestrator.md 和 skills/mdocs-workflow/SKILL.md 中本轮新增的中文路由说明全部改为英文，与原文件语言保持一致。已检查两文件无中文字符并通过 git diff --check；未运行测试或构建。
- 根据用户要求收敛文档改动范围：仅保留 Execute/dispatch/route 的必要流程说明和 mdocs_route 工具条目；删除独立的 Complexity Classification 大段落及重复规则，压缩 workflow skill 中的路由说明。两个文件继续保持英文，与原文件语言一致。已通过 git diff --check，未运行测试或构建。
- 用户确认开始完善实现。依据符合性审查，采用最小修正范围：1) 让 mdocs_dispatch 始终返回最小 routing.status，使 disabled 与 invalid 可区分；2) 收紧 mdocs_route 的 classification 参数 schema，明确 level/reasons 契约；3) 暂保留 RoutingManager 的程序化 override/API，因为 Wiki 已将其定义为未来可信宿主适配接口，本轮不扩展模型可调用入口；4) 不重复扩写两个英文文档。验证仍仅做静态检查和 mdocs 校验，测试/构建前需再次确认。
- 用户要求根据其更新后的 agents/mdocs-orchestrator.md 同步 skills/mdocs-workflow/SKILL.md。将仅调整 EXECUTE/Subagent Dispatch 的流程表述，保持最小改动：dispatch 后分类，调用 mdocs_route({ classification })，必须使用有效 decision.agent 作为 Task subagent_type；不自行选择模型或 Agent。
- 已根据用户更新后的 agents/mdocs-orchestrator.md 同步 skills/mdocs-workflow/SKILL.md：EXECUTE 改为 dispatch → classify → mdocs_route → Task；明确只有返回有效 decision.agent 才继续，并将其作为 Task subagent_type；删除不再与当前 orchestrator 表述一致的冗余 routing 状态和 nextAttempt 说明。已通过 git diff --check 与 mdocs_validate，未运行测试或构建。
- 用户确认保持 skills/mdocs-workflow/SKILL.md 不变，已撤销本轮对该文件的改动，当前 git diff 不再包含该文件。路由流程仅保留在 agents/mdocs-orchestrator.md 中；已通过 git diff --check 和 mdocs_validate。
- 按用户要求检查 TS 源码中的纯格式化改动。对比基线后确认，当前 TS diff 中没有可独立回退的纯格式化改动：src/plugin.ts 的配置合并代码虽然行结构变化较大，但属于路由 Agent 原子注册/保留既有 Agent 的功能性修正；其余 TS 改动均为路由功能、状态、工具或测试断言。未修改源码，避免误回退功能代码。
- 用户确认新的保底语义：当没有有效 decision.agent 时，直接使用 OpenCode 宿主默认模型/原有 Task 行为。后续将简化 RoutingManager 的外部状态处理，不再把 disabled/invalid 阻断为路由错误；路由仅在存在有效静态 Agent 时介入。配置错误仍保留诊断，且不伪造默认 Agent。修改前不运行测试或构建。
- 按已确认契约完成默认宿主回退重构：RoutingManager.resolve 在 disabled/pending/invalid 时返回 fallback/default-host、decision:null 和配置诊断；有效路由继续返回真实静态 Agent。mdocs_route、dispatch、status、validate 不再因无有效路由阻断宿主默认 Task，orchestrator 仅在有效 decision.agent 时传 subagent_type。同步更新相关测试断言及两篇路由 Wiki；未修改 skills/mdocs-workflow/SKILL.md。仅完成 git diff --check、定向静态搜索和 mdocs_validate，未运行测试、构建、编译或 lint。
- 按反馈完成最小修复：彻底移除 RoutingManager.this.state.status 和对外 disabled/pending/invalid/valid RuntimeState 判别联合；使用可选 activeRoute 表示已激活解析表，status 仅返回 configured/active 配置摘要及 diagnostics。plugin 不再按 status 分支阻断，mdocs_route 在无有效 Agent 时返回 default-host fallback，dispatch/status/validate 保留诊断。相关测试断言已更新。两份 Wiki 已以 HEAD 为基线恢复原有完整设计，仅修订无有效 decision.agent 时回到宿主默认模型/原有 Task 行为的契约。未修改 skills/mdocs-workflow/SKILL.md；仅执行静态搜索、git diff --check 和差异核对，未运行测试、构建、编译或 lint。
- 已继续收敛实现：RoutingManager 删除 this.state、this.state.status 和 RuntimeState 判别联合，改为 activeRoute + 配置诊断；无有效路由时 resolve 返回 decision:null 的 default-host fallback，不伪造 Agent。plugin 不再因路由诊断阻断默认 Task 行为。已恢复两份 Wiki 被误删的完整设计内容，仅保留宿主默认模型 fallback 的必要修改；skills/mdocs-workflow/SKILL.md 保持不变。git diff --check、mdocs_validate 和索引检查通过；未运行测试、构建、编译或 lint。
- 根据用户要求精简 agents/mdocs-orchestrator.md 的路由说明：将两条关于 decision.agent、模型提示词、候选 Agent 和宿主回退的重复描述合并为一句，保留有效 decision.agent 使用为 subagent_type、否则使用宿主模型的完整语义。
- 根据用户要求进一步精简 agents/mdocs-orchestrator.md：压缩复杂度分类步骤和 mdocs_route 工具描述，保留当前输入/可信上下文、分类调用、首选静态 Agent 与宿主模型回退语义。
- 评估 src/api.ts 的路由导出后确认：当前源码、插件和测试均直接从 ./routing 使用 RoutingManager，外部 API 没有路由类型的既有消费方；新增整组导出形成不必要的公共兼容承诺。本次将移除 api.ts 的整段路由 re-export，路由仍作为插件内部实现，保持 skills 文件不变。
- 用户确认尽可能保持原代码、减少无关改动。将恢复 src/plugin.ts 中 mdocs-orchestrator 注册逻辑的原有直接写入方式；路由 Agent 的注册仍由 RoutingManager 独立负责。
- 已按用户确认恢复 src/plugin.ts 中 mdocs-orchestrator 注册逻辑的原始直接写入实现，移除与路由无关的 mergedAgents/existingAgents 结构改动；RoutingManager 的路由 Agent 注册逻辑保持不变。已通过 git diff --check 和 mdocs_validate，未运行测试或构建。
- 用户确认删除 mdocs_dispatch 返回的 routing 字段，并修复审查发现的三个问题：明确 orchestrator 的 default-host fallback 执行分支；移除 dispatch routing 扩展并同步测试/Wiki；统一 mdocs_route 输入与 defaultLevel 解析契约。保持 skills/mdocs-workflow/SKILL.md 不变。测试、构建、编译和 lint 仍需用户确认。
- - [2026-08-04] 完成三项已确认的最小修复：orchestrator 仅在 status=resolved 且 decision.agent 有效时设置 Task subagent_type，default-host fallback 不指定路由 Agent/model/variant，Task 契约不允许省略时由当前 orchestrator 直接执行；mdocs_dispatch 成功返回删除 routing 与 resolverTool；mdocs_route schema 接受原始 classification 并交由 RoutingManager.resolve parser 统一应用 defaultLevel。同步更新相关测试断言及两份路由 Wiki，skills/mdocs-workflow/SKILL.md 保持不变。按要求未运行测试、构建、编译或 lint。
- 已完成用户确认的三项最小修复：orchestrator 明确 resolved/default-host fallback 分支；mdocs_dispatch 恢复原有返回契约并移除 routing/resolverTool；mdocs_route 放宽 classification 入口，由 RoutingManager 统一校验并应用 defaultLevel。未修改 skills/mdocs-workflow/SKILL.md。git diff --check、mdocs_validate 和 INDEX consistency 均通过。尚未运行测试、构建、编译或 lint，等待用户确认。
- 用户要求将 agents/mdocs-orchestrator.md 第 25–28 行恢复为本次 fallback 细化前的精简描述，同时保留 mdocs_route 工具条目的当前描述。仅调整该 Agent 文档，不修改 skills/mdocs-workflow/SKILL.md。
- 用户已明确同意按 workflow 先测试后提交。验证顺序：先运行路由专项测试，修复失败后运行完整测试；通过后完成 mdocs 校验、更新状态并提交。
- 验证结果：路由专项测试 `npx jest src/__tests__/routing.test.ts src/__tests__/routing-plugin.test.ts src/__tests__/plugin.test.ts --runInBand` 全部通过（3 suites，103 tests）。完整测试 `npm test -- --runInBand` 中路由及其余 11 个 suites 通过，总计 236/238；仅两个既有 INDEX stale mtime 测试失败（wiki.test.ts、initiative.test.ts），原因是当前文件系统中直接改写文件与 INDEX 的 mtimeMs 相同，与本次路由改动无关，相关测试文件未修改。按 surgical change 原则不顺带修复。下一步完成 mdocs 校验并提交已验证的路由实现。
- 最终审查修复：自动生成的路由 Agent 不再显式授予 read/edit/write/bash 等权限，改为遵循 OpenCode 宿主权限策略；新增测试确认 permission 未被覆盖。生成 Agent 内置 prompt 改为英文。Wiki 将尚未实现的路由可观测性明确标记为后续要求。权限修复后路由专项测试再次 103/103 通过。完整测试的两个既有 mtime stale 测试失败已单独复现，与路由改动无关。
- [2026-08-04T11:15:02.933Z] Marked done via mdocs command
- 用户要求 binding 名称支持大写英文字母。当前 mdocs/routing.json 是用户未跟踪文件，将保持不修改。最小改动范围：更新正则以允许大小写首字母及后续大小写字母，仍不支持点号、下划线、空格或斜杠；同步 parser 测试和 Wiki 格式约束。
- 完成启动性能只读分析：路由自身仅同步读取/JSON解析/Zod校验/稳定序列化/SHA-256，预计毫秒级且无模型网络请求；主要潜在开销是 config hook 为 bindings 中全部 13 个 model target 生成静态 Agent，宿主随后处理 13 个带 model 的 Agent。当前 levels 实际引用 11 个，DeepSeek-V4-Flash、GPT-5-5、GPT-5-6-Luna、MiniMax-M2 等部分 binding 未被等级数组使用。建议先做启动阶段分段计时和 Agent 数量 A/B，再考虑只生成被 levels/可信 override 引用的 Agent或按相同 model/variant 合并；缓存解析和延迟非路由管理器属于次级优化。未修改代码。
- 审查 mdocs_route 无效输入问题：根因是 agents/mdocs-orchestrator.md 只写 `mdocs_route({ classification })`，未明确 classification 的对象结构；src/plugin.ts 又将工具参数声明为 z.any().optional()，模型看不到 level/reasons 枚举与类型约束，错误结构会被 RoutingManager 静默按 defaultLevel 处理。建议采用“工具层严格、resolver 层容错”：mdocs_route schema 严格接受 `{ level: simple|standard|complex, reasons: string[] }`，classification 仅在分类异常时整体省略；RoutingManager.resolve 继续为内部/直接调用保留 defaultLevel 防御性处理；同步精简 Agent 调用示例、测试和 Wiki。
- 用户确认实施 mdocs_route 输入契约修复。执行范围：工具层使用严格 `{ level: simple|standard|complex, reasons: string[] }` schema，额外/错误字段由工具校验拒绝；classification 仅在分类过程失败时整体省略并使用 defaultLevel；RoutingManager.resolve 保留防御性容错；同步精简 orchestrator 调用格式、相关测试与两份 Wiki。保持 skills/mdocs-workflow/SKILL.md 和本地未跟踪 mdocs/routing.json 不变。
- 已完成 mdocs_route 输入契约修复：工具 schema 严格要求 classification={level: simple|standard|complex, reasons: string[]} 并拒绝额外字段；classification 整体省略仅表示分类失败并使用 defaultLevel；RoutingManager.resolve 的直接入口继续保留防御性容错。orchestrator 保持精简并明确当前 TUI 输入/可信上下文、合法调用格式和禁止字段。routing-plugin 测试新增合法结构与非法 level、缺 reasons、错误 reasons、agent/model/variant/binding/confidence、字符串/数组/null 的 schema 断言；两份 Wiki 已区分严格工具层和容错 resolver 层。skills/mdocs-workflow/SKILL.md 与未跟踪 mdocs/routing.json 均未修改。git diff --check、mdocs_validate 和 INDEX consistency 通过；尚未运行测试或构建。
- 用户已确认运行路由专项测试；若通过则完成 Mdocs/Git 校验，并排除本地未跟踪的 mdocs/routing.json 后直接提交本次输入契约与大写 binding 支持改动。
- 路由专项测试已通过：`npx jest src/__tests__/routing.test.ts src/__tests__/routing-plugin.test.ts src/__tests__/plugin.test.ts --runInBand`，3 个测试套件、104 项测试全部通过。mdocs_validate、INDEX consistency 和 git diff --check 均通过。提交范围仅包含严格 mdocs_route 输入契约、orchestrator/Wiki/测试同步及 Initiative 记录；本地未跟踪 mdocs/routing.json 不提交。
- [2026-08-06T10:02:35.074Z] Marked done via mdocs command

## Artifacts
- src/routing.ts
- src/plugin.ts
- src/__tests__/routing.test.ts
- src/__tests__/routing-plugin.test.ts