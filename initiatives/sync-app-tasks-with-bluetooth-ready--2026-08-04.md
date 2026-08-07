---
id: "sync-app-tasks-with-bluetooth-ready"
title: "同步应用任务与蓝牙就绪状态"
status: "active"
created: "2026-08-04"
updated: "2026-08-07"
owner: "lisa"
tags: ["remote","bluetooth","freertos","startup","synchronization"]
related_wiki: []
priority: "medium"
phase: "verification"
blockers: ["本轮明确保留现有 EVT_BLE_RDY 设置位置和蓝牙任务等待条件，不处理潜在的就绪语义及启动竞态问题。","尚未获得用户对构建或测试的确认。"]
---

## Objective
在 remote 工程启动阶段建立可靠的蓝牙与应用任务初始化屏障：应用任务完成 app_device_init 后才能允许蓝牙任务执行可能触发应用事件的 BLE 流程；业务代码不得早于约定的就绪状态运行，并避免依赖偶然的任务优先级或调度顺序。

## Plan


## Progress Log
- [2026-08-04T03:24:24.917Z] Created initiative via mdocs command
- 用户确认 EVT_BLE_RDY 当前不影响功能，本轮保持现状，后续再考虑调整。当前优先事项仅为确认 BT 在首次 ls_ble_task_execute 前等待 EVT_APP_RDY，避免 app_device_init 清理 BLE 早期事件的启动竞态。
- 用户进一步确认：蓝牙任务等待 EVT_APP_RDY 的方案本轮也保持现状，后续再考虑。故本轮不修改 EVT_BLE_RDY 设置位置、不增加 BT 对 EVT_APP_RDY 的等待。
- 已提交当前 remote 任务同步代码，提交为 178efa8（feat: 增加蓝牙与应用任务启动同步）。提交包含 appinc.h、main.c、task_app.c/.h、bt_app_if.c/.h 和 misc.c 共 7 个文件。按用户决定保留 EVT_BLE_RDY 现状、BT 仅等待 EVT_SYS_RDY；未构建、未测试。mdocs 子模块及 devtools、opencode.json 未纳入本次提交。
- 用户希望评估将 main.c 中 remote_ble_transaction_init 调用移入 app_os_task_init 是否合适；已开始核对初始化职责与启动顺序。
- 完成静态评估：不建议将 remote_ble_transaction_init 移入 app_os_task_init。该函数注册 BT observer，当前 boot_task 在创建 BT task 前完成注册，时序最强且保持启动编排与应用 OS 资源创建职责分离。若强制移动，仅可放在 app_os_task_init 最前、队列和 task 创建之前；但会引入 task_app 对 BLE transaction 的耦合，并使后续 app task 创建失败时 observer 已注册。未修改代码、未构建、未测试。
- 用户指出 sysevt 屏障会阻止 BT task 在 EVT_SYS_RDY 前进入 BLE 执行阶段；接受纠正，重新评估此前关于 observer 未注册窗口的判断。
- 按 sysevt 完整时序修正结论：BT task 即使在 bt_app_stack_init 后立即运行，也会在 EVT_SYS_RDY 阻塞；boot_task 仅在 app_os_task_init 成功返回后设置该事件，因此将 observer 注册移入 app_os_task_init 不存在此前所述的回调未注册窗口。移动在时序上合适；推荐在 xTaskCreate 成功后、函数返回前注册，以避免队列或 task 创建失败时留下已注册副作用，同时仍严格早于 EVT_SYS_RDY 发布。
- 已实施初始化调用移动：main.c 移除 remote_ble_transaction.h 和 boot_task 中的 remote_ble_transaction_init；task_app.c 引入该头文件，并仅在 xTaskCreate 成功后、app_os_task_init 返回前注册 observer。队列或应用 task 创建失败时不会注册；成功返回后 boot_task 才发布 EVT_SYS_RDY。git diff --check 通过，差异仅涉及 2 个文件、3 行新增/2 行删除。按项目规则未构建、未运行测试，等待用户确认。
- 已将本次两个源文件改动提交至仓库，提交 da0b878（refactor: 调整 Remote BLE 事务初始化位置）。提交仅包含 projects/remote/remote/main.c 与 tasks/task_app.c；mdocs、devtools、opencode.json 未纳入。此前 git diff --check 通过，未构建、未运行测试。

## Artifacts
