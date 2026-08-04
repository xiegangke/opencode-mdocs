---
id: "review-remote-ls-ble-migration"
title: "审查 remote 工程迁移至 ls_ble 接口"
status: "active"
created: "2026-08-03"
updated: "2026-08-04"
owner: "AI"
tags: ["code-review","remote","ls_ble","migration"]
related_wiki: ["reviews/remote-ls-ble-migration-review"]
priority: "medium"
---

## Objective
审查 feat/refactor 分支最新一次提交，确认 remote 工程向 ls_ble 接口的迁移是否完整，并识别功能、资源、并发、生命周期和兼容性方面的潜在风险。

## Plan
- [ ] 确认 feat/refactor 分支最新提交及其变更边界，识别 remote 工程中所有迁移点
- [ ] 对比旧接口与 ls_ble 接口的语义、参数、返回值、回调和生命周期，检查迁移完整性
- [ ] 审查变更代码中的错误处理、资源管理、并发时序、边界条件及兼容性风险
- [ ] 汇总按严重级别排序的问题，给出文件与行号证据及修复建议
- [ ] 更新审查记录并验证 mdocs 完整性

## Progress Log
- [2026-08-03T07:35:16.973Z] Created initiative via mdocs command
- 已完成提交 9e41e3c7031463372d13495145b8cee8c58a2431 的两轮静态审查与独立复核。确认迁移不完整：2 个高风险、3 个中风险、1 个低风险兼容性事项。审查报告已写入 wiki：reviews/remote-ls-ble-migration-review。按约束未构建、未执行测试。
- 用户确认当前主要使用 CMake，但要求补齐 Make 构建配置；其余风险后续按严重度逐项处理。本轮仅修改并静态核验 Makefile，不构建、不测试。
- 已补齐 projects/remote/remote/Makefile：在 CSRCS 加入 mods/ls_ble/*.c，在 CFLAGS 加入 ./mods/ls_ble。静态核验与 CMakeLists.txt 的 ls_ble 源文件和 include 配置一致；git diff --check 通过，diff 仅 2 行新增。按约束未构建、未测试。Makefile 遗漏风险已关闭。
- 用户要求将低功耗 ble_task_sleep/init 生命周期问题放到最后处理。按风险顺序转向下一项：RTK/MTK 特殊广播被拆成多个异步请求，上层在失败不可见时仍推进状态。
- 已修复 RTK/MTK 特殊广播非原子事务：新增单个 app transaction，内联深拷贝 advertising/scan response 数据，在 BT task 内连续执行 prepare/data/set/start；仅在 transaction 接受成功后推进 timer 和广播状态。首次或后续阶段 post 失败均撤销本次 PW_EVENT_ADV 计数锁，首次失败额外清理逻辑广播状态。独立静态复核发现并修正了 POWERBOX_RESET 误清全部引用的问题。git diff --check 通过；未构建、未测试。已知限制：post 成功仍不代表 controller 最终启动成功。
- 用户要求先验证两种构建入口，明确执行命令：`build.sh remote` 与 `make TGT=remote`。已获得用户对构建操作的明确确认；低功耗问题仍最后处理。
- 已按用户确认分别执行两种构建：CMake `./build.sh remote` 成功，remote 目标成功链接；报告一个既有 enum comparison warning（bt_if/bt_app_if.c:692），内存区域 apram0 使用 49136/49152 bytes（99.97%）。Make `make TGT=remote` 已纳入并编译 mods/ls_ble/*.c，但在 bt_if/bt_app_if.c:692 因 `-Werror=enum-compare` 失败：ls_ble_status_t 与 BT_APP_STATUS_OK 枚举比较，导致未链接。另有 Bt_BootClock_Init 隐式声明 warning，但当前不是阻断错误。
- 用户明确要求修复构建问题。当前优先处理 Make 阻断错误，不处理低功耗生命周期问题。
- 已修复 Make 构建阻断问题：bt_if/bt_app_if.c 将 bt_app_transaction_dispatch() 返回值接收为 bt_app_status_t，再与 BT_APP_STATUS_OK 同类型比较，避免 -Werror=enum-compare。随后 `make TGT=remote` 成功链接；仍有两个 app_nvs_ptr_get 长度参数类型 warning，以及此前 main.c 的 Bt_BootClock_Init 隐式声明 warning（非阻断）。`./build.sh remote` 重新验证成功，remote 镜像生成；apram0 49136/49152 bytes（99.97%），flash 498012/524288 bytes（94.99%）。本轮未处理低功耗。
- 用户要求开始将应用代码中的 ls_ble_task_timer_xx 替换为 FreeRTOS OS timer，约束是 timer callback 内不得调用 BLE 协议栈裸接口，必须通过 ls_ble 系列封装。低功耗生命周期仍最后处理。已进入 timer 迁移规划阶段。
- 已将 remote_timer.c 的通用 app-event timer timer_event_handler 迁移为 FreeRTOS one-shot OS timer。保留公开业务接口和单 pending event 语义；timer callback 使用 FreeRTOS 签名，仅清 pending 状态并调用 app_evt_set，不调用 BLE 裸接口；timer 创建后复用，停止使用 block time 0。低功耗、广播、voice、连接参数、LED、IR training 暂未修改。git diff --check 通过，未构建、未测试。
- 用户指出 remote_timer.c 仍存在大量 ble_task_timer_xx。确认上一轮只迁移了通用 app-event timer，不足以满足整体迁移目标。本轮扩大范围：非低功耗 timer 迁移为 FreeRTOS OS timer；涉及 BLE 的 callback 只投递应用事件或异步 transaction；广播状态机和低功耗相关 timer 分别后续处理。
- 已继续迁移 remote_timer.c 中四类非低功耗 timer：广播持续时间、power 特殊广播、连接后配对超时、BLE 参数更新，均改用 FreeRTOS one-shot timer。OS timer callback 仅设置 app event；业务 handler 在应用任务中调用既有 app_ble/ls_ble/BT transaction 封装。remote_ble_if.c 的广播 timer active 查询已改为专用 OS timer 查询函数。剩余调用集中于低功耗、BLE latency、OTA、voice record delay、IR second-send 等暂留项。未构建、未测试。
- 用户明确要求不要在 remote_event 模块增加事件。此前通过新增事件把 OS timer callback 转到应用任务的方案过度扩大了事件模型，现决定撤销新增事件及 handler，改为 OS timer callback adapter 直接调用既有 callback；对于包含同步 BLE 调用且没有现成非阻塞封装的 timer 暂留，低功耗继续最后处理。
- 已按用户要求完全恢复 remote_event.c/.h，本轮不增加事件、不修改事件枚举和 handler。保留在 remote_timer.c 内可安全迁移的 FreeRTOS timer：通用 app-event、IR repeat、keypad wait；其 callback 仅设置既有事件。IR study、voice reconnect、factory timeout、广播、power adv、配对超时、参数更新等因原 callback 较重或包含同步/可能阻塞 BLE 路径，已恢复为原 BLE task timer，避免在 Timer Service Task 直接执行。低功耗仍最后。
- 按用户要求已回退本轮全部 timer 改动：remote_timer.c/.h 恢复到 HEAD，remote_event.c/.h 无工作区修改；撤销 bt_app_if.c 的参数更新 timer transaction bridge；remote_ble_if.c 恢复对原 timer handle 的 ble_task_timer_get 查询。静态搜索确认无新增 timer event、OS timer adapter、active 查询封装或 bt_stack_parameter_update_request 残留。保留此前非 timer 修复：Makefile ls_ble 配置、RTK/MTK 原子广播 transaction、bt_app enum 类型构建修复等。未构建、未测试。

## Artifacts
