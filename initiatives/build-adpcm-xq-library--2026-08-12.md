---
id: "build-adpcm-xq-library"
title: "增加 adpcm-xq 静态库构建支持"
status: "done"
created: "2026-08-12"
updated: "2026-08-12"
owner: ""
tags: ["adpcm","adpcm-xq","build"]
related_wiki: ["build/adpcm-xq-cmake-library"]
priority: "medium"
phase: "done"
---

## Objective
修改仓库构建规则，使 modules/adpcm-xq 源码可以独立编译为库；本阶段不集成到任何具体工程。

## Plan
- [ ] 检查 modules/adpcm-xq 的源码结构以及仓库现有模块构建模式
- [ ] 按照现有构建约定添加最小化的库构建规则，不接入具体工程
- [ ] 审查改动并在获得用户确认后执行编译验证
- [ ] 记录构建方式与相关产物，完成 mdocs 验证

## Progress Log
- [2026-08-12T07:36:00.039Z] Created initiative via mdocs command
- 用户明确要求构建规则先采用 CMake，不采用 Makefile 方案。调查发现 adpcm-xq 自带上游 CMakeLists，可独立构建库但默认也定义命令行程序；仓库模块 CMake 则依赖根构建提供的 create_module_library()。
- 已完成 CMake 最小改动与静态审查：CMakeLists 仅保留 adpcm-lib STATIC 目标及可用时的 libm 依赖；未发现 executable 残留，git diff --check 无错误。modules/adpcm-xq 是用户新增的未跟踪目录。未执行配置、编译或测试。
- 参考根 build.sh 使用绝对 Nuclei toolchain 文件与 NUCLEI_TOOLCHAIN_PATH 完成独立交叉编译。GNU 14.2.1 编译成功，产物 /tmp/opencode/adpcm-xq-build/libadpcm-lib.a；ar 检查仅含两个预期对象，无 adpcm-xq.c。CHIP 变量在独立模块中未使用，仅产生非阻塞警告。已创建并关联 wiki：build/adpcm-xq-cmake-library。
- 最终 mdocs 索引一致；相关构建 wiki 已设为 stable，准备进入完成阶段。
- 用户补充验收要求：生成的静态库名称必须使用 libadpcm-xq.a。initiative 从待完成状态返回实现阶段。
- 已在 modules/adpcm-xq/CMakeLists.txt 为 adpcm-lib 设置 OUTPUT_NAME adpcm-xq，静态审查与 diff check 通过，尚未重新编译。
- 用户明确授权重新构建，并将范围扩展为把 adpcm-xq 加入 projects/remote/remote 后执行 ./build.sh remote 验证。默认理解为加入 CMake 编译和链接，不修改业务调用代码。
- 在 projects/remote/remote/CMakeLists.txt 通过 add_subdirectory 引入 modules/adpcm-xq，并将 adpcm-lib 加入 REMOTE_MODULE_LIBS；保留系统库 m。执行 ./build.sh remote 成功，flash_boot、remote 及打包步骤均通过。静态库位于 build/projects/remote/remote/modules/adpcm-xq/libadpcm-xq.a，ar 检查仅有 adpcm-lib.c.obj 和 adpcm-dns.c.obj。
- 用户要求内部 CMake 目标名与实际库名保持一致，需将 adpcm-lib 统一改为 adpcm-xq。
- 已统一 CMake 目标名：模块使用 add_library(adpcm-xq ...)，数学库依赖及 remote 的 REMOTE_MODULE_LIBS 均引用 adpcm-xq；删除 OUTPUT_NAME。静态检查未发现 adpcm-lib 目标残留。
- 用户确认后重新执行 ./build.sh remote 成功。构建日志显示 Built target adpcm-xq，产物为 build/projects/remote/remote/modules/adpcm-xq/libadpcm-xq.a；归档仅含 adpcm-lib.c.obj 和 adpcm-dns.c.obj。remote、flash_boot 与镜像打包均成功。
- 开始完成阶段：已先在 modules/adpcm-xq 子仓库提交 CMake 改动，提交 62c9637（build: 仅构建 adpcm-xq 静态库）。
- [2026-08-12T08:27:23.416Z] Marked done via mdocs command
- 用户要求调整版本管理方式：modules/adpcm-xq 不作为独立仓库或子模块管理，需删除其 .git、.gitignore 及主仓库子模块配置；并将本任务的 mdocs 与主仓库历史分别整理为一个提交。

## Artifacts
