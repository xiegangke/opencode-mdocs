---
id: "sync-app-tasks-with-bluetooth-ready"
title: "同步应用任务与蓝牙就绪状态"
status: "active"
created: "2026-08-04"
updated: "2026-08-04"
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

## Artifacts
