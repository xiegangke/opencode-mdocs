---
id: "add-complexity-aware-llm-routing"
title: "为 Mdocs 增加基于任务复杂度的 LLM 路由"
status: "done"
created: "2026-08-04"
updated: "2026-08-04"
owner: "lisa"
tags: ["architecture","llm-routing","orchestration","cost-optimization","subagent"]
related_wiki: ["decisions/user-maintained-complexity-llm-routing","architecture/complexity-routing-core-pattern"]
priority: "medium"
phase: "verification"
handoff_summary: "架构设计已收敛：分类器只输出 level/reasons，不再使用置信度；每级 binding 数组按从零开始的索引升序匹配，仅在业务执行前的安全基础设施失败时尝试下一项。"
next_action: "架构设计已完成；如进入实现阶段，按 ADR 实现 routing.json 加载、校验、静态 Agent 注册和安全失败切换。"
---

## Objective
设计一套可实现的 LLM 路由方案：由默认的中等规模编排模型分析当前请求与会话复杂度，完善执行提示词，并为子代理选择在能力、推理时间和成本之间更优的模型或变体；覆盖用户显式选择、能力约束、降级策略和可观测性。本次仅完成匹配方案与架构设计，不实现运行时代码。

## Plan
- [ ] 梳理现有 mdocs 编排、子代理 dispatch 与模型配置边界，明确可用扩展点
- [ ] 定义任务复杂度与模型能力画像，设计可解释的分级、硬约束和评分机制
- [ ] 设计路由决策流程，包括用户覆盖、置信度、升级、降级和失败回退
- [ ] 定义配置结构、路由决策数据结构、组件边界及与 mdocs_dispatch/Task 的集成方式
- [ ] 分析成本、延迟、质量、供应商可用性和提示注入等风险，确定 MVP 边界
- [ ] 形成架构决策 Wiki，并验证设计与现有 OpenCode/Mdocs 能力兼容

## Progress Log
- [2026-08-04T06:32:29.376Z] Created initiative via mdocs command
- 架构讨论结论：模型能力画像不应只依赖外部榜单，也不应完全要求用户手工维护。采用分层混合证据：Mdocs 提供版本化的外部评测种子画像，部署方配置负责可用性、价格、合规及显式覆盖，本地标准任务评测负责环境内能力校准，运行时遥测负责延迟、失败率和验证通过率的动态修正。硬能力仅接受厂商规格或本地探测；质量类外部评测仅作为低/中置信度先验，不能自动突破用户策略与安全约束。无可靠画像的模型默认不参与自动降级，可保守映射到 balanced 或要求用户确认。
- 用户确认 MVP 的模型匹配规则完全由用户维护：用户配置不同复杂度等级应使用的 LLM；Mdocs 编排模型仅根据当前 TUI 输入及可信会话上下文判定任务复杂度，再查表分配 LLM。不引入外部 benchmark、内置模型能力评分、本地自动评测或运行时能力自学习。未知或低置信度复杂度采用保守等级，不自动降级。
- 完成架构设计并创建 decisions/user-maintained-complexity-llm-routing Wiki。最终采用 simple/standard/complex 三级；分类器仅输出 level/confidence/reasons，程序按用户维护的 level→binding→静态 Agent→model 映射确定目标；low confidence 向上提升一级；覆盖必须结构化；不可用时只沿用户显式 fallback；mdocs_dispatch 保持现有职责和接口；MVP 不包含外部评测、能力画像、自动学习或动态 Task model/variant。
- [2026-08-04T06:59:27.341Z] Marked done via mdocs command
- 用户指出现有 ADR 未说明映射配置的实际提供方式。重新打开 initiative，补充配置承载位置、静态 Agent 生成/引用方式和用户操作流程。
- 补齐用户配置入口：项目根目录 mdocs/routing.json 是 MVP 唯一来源。普通用户在 binding 中只声明 model/variant/fallback，由 config hook 自动生成 mdocs-route-<binding> 静态 subagent；需要自定义 prompt/权限/tools 时可互斥地引用已有 agent。凭据由 OpenCode 标准机制维护。无文件表示禁用，存在但无效则整份配置失败；修改后需重载。已更新 ADR 与 stable architecture Wiki。
- [2026-08-04T07:12:41.707Z] Marked done via mdocs command
- 用户确认配置收敛：继续使用 defaultLevel；置信度策略暂由 Mdocs 设计并在实现验证后根据反馈调整；每个 levels.<level> 直接配置有序 binding 字符串数组，同级首选与基础设施备用由数组顺序表达；删除 binding 级 fallback。
- 按用户最终确认删除全部置信度设计：ClassificationResult、RouteDecision、路由流程、可观测性、设计范围和验收场景均不再包含 confidence 或低置信度升级。同步明确 levels.<level> 数组索引越小优先级越高，首项为 0，仅在业务执行前可安全识别的基础设施失败时按 index + 1 尝试。ADR 与 stable architecture Wiki 已同步，校验和索引一致性通过。
- [2026-08-04T07:43:42.395Z] Marked done via mdocs command

## Artifacts
