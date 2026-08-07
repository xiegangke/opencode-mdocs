---
id: "review-remote-ls-ble-migration"
title: "审查 remote 工程迁移至 ls_ble 接口"
status: "active"
created: "2026-08-03"
updated: "2026-08-07"
owner: "AI"
tags: ["code-review","remote","ls_ble","migration"]
related_wiki: ["reviews/remote-ls-ble-migration-review","reviews/task-btle-feasibility-review","reviews/bt-if-phased-migration-plan","reviews/task-btle-merged-implementation","reviews/ls-ble-error-interface","reviews/bt-common-header-removal","reviews/bt-callback-merge-feasibility","reviews/bt-callback-merge-implementation","reviews/bt-callback-handler-consolidation"]
priority: "medium"
phase: "verification"
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
- 已完成 task_btle.c/h 可行性静态评估与独立复核。结论：旧 task_btle 原样恢复不可行，其依赖的 btos_al/bt_stack_if 与旧消息所有权模型已在 9e41e3c 中整体删除；将当前 bt_app_task/FreeRTOS queue/ls_ble dispatcher 核心实现移动或重命名为 tasks/task_btle.c/h 可行且推荐，但应保留 bt_cb、类型、内部接口和错误模块，不建议为追求两文件而全部合并。必须维持唯一 BLE executor、ble_task_execute 仅在 BT task 执行、异步请求及 app transaction 各自所有权规则、现有初始化顺序和公开 API 兼容。低功耗裸 ble_task_sleep/init 风险不会随文件迁移消失，需另行设计。报告已写入 reviews/task-btle-feasibility-review；本轮未修改源码、未构建、未测试。
- 用户要求在 HCI 错误码迁往 tasks/task_btle.c、工程蓝牙配置迁往 tasks/task_btle.h 完成后，分析 bt_app_if.c/h、bt_cb.c、bt_internal.h、bt_types.h、bt_common.h 剩余职责与依赖，提出分阶段迁移方案；覆盖 include/循环依赖、公开 API 兼容、唯一 executor、queue、ls_ble dispatcher、transaction 所有权、callback 表、初始化顺序、静态/运行时验证、低功耗裸 ble_task_sleep/init 最后处理且不得简单同步 wrapper 化；输出阶段顺序与第一步最小改动。本轮静态核验：bt_error.c 已删除，hci_status_code_to_string 唯一定义在 tasks/task_btle.c；bt_common.h 已瘦身并 include tasks/task_btle.h；构建清单未验证；未构建、未测试。
- 已完成本轮三路工作并整合：删除 bt_if/bt_error.c，将原 HCI 状态字符串表和 hci_status_code_to_string() 原样迁入 tasks/task_btle.c；将 PLF 资源、GAP 设备、PHY/连接/广播工程配置迁入 tasks/task_btle.h，bt_common.h 保留协议栈公共 include 并单向兼容包含 task_btle.h。集成核查修复了并行实现中的非法注释和循环 include；确认 CMake/Make 已通过 tasks/*.c 与 tasks include 目录覆盖新文件，无需改构建配置。剩余迁移方案已记录于 reviews/bt-if-phased-migration-plan。git diff --check 通过；按约束未构建、未测试。
- 用户调整 HCI 错误码归属：实现应放入 mods/ls_ble/ls_ble_error.c，并增加文件描述；hci_status_code_to_string() 声明迁入 tasks/task_btle.h 供外部使用。本轮仅调整该实现、声明和空文件，不构建、不测试。
- 按用户调整完成 HCI 错误码归属：实现与状态字符串表位于 mods/ls_ble/ls_ble_error.c，新增中文文件描述及所需标准类型头；保留现有越界保护。hci_status_code_to_string() 声明迁入 tasks/task_btle.h，bt_internal.h 删除重复声明；空的 tasks/task_btle.c 已移除。静态确认调用方通过 bt_app_if.h -> bt_common.h -> task_btle.h 获取声明，CMake/Make 均已通配 mods/ls_ble/*.c，git diff --check 通过。未构建、未测试。
- 用户确认继续执行文件归并：bt_app_if.c 迁至 tasks/task_btle.c；bt_app_if.h、bt_types.h 合入既有 tasks/task_btle.h；随后完善所有依赖。计划保持公开 bt_app_* 符号和运行时语义不变，本轮默认只做静态验证，构建与测试另行确认。
- 已完成 task_btle 文件归并：bt_app_if.c 迁为 tasks/task_btle.c；bt_app_if.h 与 bt_types.h 内容合入既有 task_btle.h；旧三个文件删除；所有直接调用方改 include task_btle.h。切断 bt_common.h 对 task_btle.h 的兼容反向包含，bt_internal.h 仅显式依赖 bt_common.h。静态确认旧头引用为零，executor/queue/dispatcher/transaction 定义唯一，两处 ble_task_execute 调用位置和运行时顺序不变，CMake/Make 通配无需调整，git diff --check 通过。未构建、未测试。
- 用户要求将 hci_status_code_to_string 改为 ls_ble_ 前缀并把声明移入 ls_ble 模块。根据现有模块布局，采用独立 mods/ls_ble/ls_ble_error.h 与 ls_ble_error.c 配对，接口命名为 ls_ble_hci_status_code_to_string()。本轮默认静态验证，不构建、不测试。
- 已将 HCI 状态码文本接口完整收敛到 ls_ble 模块：新增 mods/ls_ble/ls_ble_error.h，接口重命名为 ls_ble_hci_status_code_to_string()；ls_ble_error.c 包含自身公开头；task_btle.c 显式包含 ls_ble_error.h 并更新两处调用；task_btle.h 删除原声明。静态确认旧名称为零，新名称一处声明、一处定义、两处调用，CMake/Make 构建通配无需调整，git diff --check 通过。未构建、未测试。
- 按用户确认不保留 ls_ble_error.h：删除该头，将 ls_ble_hci_status_code_to_string() 声明迁入 ls_ble_gap.h；ls_ble_error.c 改为包含 ls_ble_gap.h，task_btle.c 删除多余 ls_ble_error.h include并继续通过已有 GAP 头获取声明。接口名称、状态码表与越界行为不变。同步重写相关 wiki 记录。未构建、未测试。
- 已删除 bt_if/bt_common.h，并将聚合的协议栈依赖下沉到实际使用者：task_btle.c 显式包含平台、BLE task 与 DISS/BASS/HOGPD/OTA 头；bt_internal.h 自包含 callback/GAP/profile 类型头；bt_cb.c 显式包含 sdk_config.h 与 ble_drv.h 以完整解析 lsip_rf。静态确认项目内无 bt_common.h 残留引用、无新增公共头循环，git diff --check 通过。未构建、未测试。
- 完成 bt_cb.c 合入 tasks/task_btle.c 的只读静态评估。结论：技术可行；四张 callback 表仅由 task_btle.c 注册，trampoline 无其他仓内调用，bt_internal.h 仅服务这两个实现文件，合并后可删除并以文件内前置声明替代。建议先机械搬入再单独 static 化，必须保留外部 dis_profile_get_cb()/app_hid_rcv_data() 声明、callback 签名和初始化顺序；仅需补充 ble_drv.h。CMake/Make 通配无需改，但 CMake 验证时应重新配置。低功耗 TODO 仍最后处理。本轮未修改源码、未构建、未测试。
- 已实施 bt_cb.c 回调归并：BLE task/GAP/DISS/HOGPD trampoline 与四张 callback 表合入 tasks/task_btle.c；新增 ble_drv.h 显式依赖，使用文件内 static 前置声明并私有化内部 callback/handler；保留外部 dis_profile_get_cb()/app_hid_rcv_data() 边界；删除 bt_if/bt_cb.c 与 bt_if/bt_internal.h。独立静态复核未发现阻断或中风险问题，旧引用清零，初始化顺序、唯一 executor/queue/dispatcher/transaction 及两处 ble_task_execute 均保持。git diff --check 通过。未构建、未测试。
- 用户确认 callback 与 handler 已位于同一文件，可进一步合并。本轮将消除纯转发层，保留协议栈要求的 callback 签名及确有参数转换/外部桥接职责的适配函数；不处理低功耗 TODO，构建与测试需另行确认。
- 已完成 callback/handler 收敛：reset、GAP enable、连接/断开、参数更新、bond、info、广播/activity/event 及 HOGPD notify 的业务逻辑直接进入协议栈 callback；删除无意义 handler 层。保留 bond status 拆分、HOGPD token 适配、DISS/HID 外部桥接和低功耗 TODO。独立静态复核未发现问题，四表签名/字段、初始化顺序、唯一 executor/queue/dispatcher/transaction 与两处 ble_task_execute 均保持；git diff --check 通过。未构建、未测试。
- 按用户确认执行 `./build.sh remote`。首次构建在 task_btle.c 的 bt_stack_gap_enable_cmp 中失败：callback 上移后 hid_report_map 仅有未定长前置声明，不能 sizeof。新增定义后可见的 hid_report_map_size() helper，并在 profile 初始化中使用，保持 callback 合并和 report map 长度语义。重新执行 `./build.sh remote` 成功，flash_boot 与 remote 均链接并生成镜像；remote apram0 49136/49152 bytes（99.97%），flash 499156/524288 bytes（95.21%）。git diff --check 通过；未运行测试。

## Artifacts
