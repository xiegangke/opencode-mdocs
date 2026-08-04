---
id: "simplify-ls-ble-task-execute"
title: "简化 ls_ble_task_execute 调用流程"
status: "done"
created: "2026-08-04"
updated: "2026-08-04"
owner: ""
tags: ["ble","ls_ble","refactor"]
related_wiki: ["architecture/ble-task-execute-context"]
priority: "medium"
phase: "done"
---

## Objective
检查 ls_ble_task_execute 的实现与全部调用上下文，判断 LS_BLE_ID_TASK_EXECUTE 消息封装是否冗余；若确认 ble_task_execute 仅需且仅会在蓝牙任务内执行，则以最小改动简化调用流程。

## Plan
- [ ] 定位 ls_ble_task_execute、ble_task_execute、LS_BLE_ID_TASK_EXECUTE 的定义、消息处理逻辑与全部调用点
- [ ] 验证所有调用是否处于蓝牙任务上下文，并分析移除消息封装后的行为与风险
- [ ] 根据分析结论实施最小改动，清理仅由该封装产生的无用代码
- [ ] 经用户确认后执行相关构建或测试，并检查变更结果
- [ ] 记录结论与关键调用约束，更新进度并完成 initiative

## Progress Log
- [2026-08-04T04:02:36.493Z] Created initiative via mdocs command
- 已完成静态调用链分析：remote 工程仅有两处 ls_ble_task_execute 调用，均位于 bt_app_task（dispatcher executor）上下文。该上下文中 LS_BLE_ID_TASK_EXECUTE 不会入队，只同步调用空 handler，随后调用 ble_task_execute，因此消息封装对现有调用路径明确冗余。非蓝牙任务调用时，该 API 仍承担向 bt_app_task 投递空事务并在事件循环尾部触发协议栈执行的兼容语义。建议至少将两处现有调用直接替换为 ble_task_execute；是否进一步删除公共 wrapper、handler 和消息 ID，需要确认对仓外调用者的兼容要求。未修改源码，未执行构建或测试。
- 用户确认采用完整清理方案：直接调用 ble_task_execute；删除 ls_ble_task_execute 公共接口、空 handler 和注册；保留原 LS_BLE_ID_TASK_EXECUTE 数值槽位，避免后续 ID 重排。
- 已实施完整清理：bt_app_task 两处改为直接调用 ble_task_execute；删除 ls_ble_task_execute 声明、实现、空 handler 与注册；原枚举槽位改名为 LS_BLE_ID_TASK_RESERVED，后续 ID 布局不变。静态验证通过：目标旧符号无残留，git diff --check 通过，源码改动限于四个目标文件。尚未构建或测试，等待用户确认。
- 用户已确认允许执行 remote 工程现有构建，不编写或执行额外测试。
- 验证完成：经用户确认执行 ./build.sh remote，Release 默认配置构建成功，flash_boot 与 remote 均完成编译、链接和打包，无编译或链接错误；构建未改变 Git 工作区状态。已创建稳定架构 wiki architecture/ble-task-execute-context，记录 ble_task_execute 仅限 bt_app_task 执行、其他上下文通过 BT 事件队列唤醒以及 reserved ID 槽位约束。未执行测试。
- [2026-08-04T04:54:31.560Z] Marked done via mdocs command
- 按用户要求重新打开 initiative，检查其对 bt_app_task 的后续修改；确认后不执行构建。
- 已静态复核用户调整后的 bt_app_task：status 已缩小到 BT_EVT_STACK_TRANSACTION 分支内；两处 ble_task_execute 仍都位于 bt_app_task，分别在初始化完成后及每个成功出队事件处理后执行。BT_EVT_STACK_EXECUTE 空分支会落到统一执行点，无遗漏或单事件重复执行；删除 LS_BLE_ID_TASK_EXECUTE 封装的结论仍成立。按用户要求未构建、未测试。
- [2026-08-04T05:04:13.843Z] Marked done via mdocs command

## Artifacts
