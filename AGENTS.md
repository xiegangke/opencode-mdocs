# AGENTS.md

## 关键规则（请先阅读）

**语言**:

- 代码应使用英文
- 交互过程、文档、注释和提交信息应使用中文，专业术语除外

**禁止**:

- 查看未明确允许的文件和目录

**必须**:

- 进行编译或者构建前要进行确认
- 编写或者执行测试前要进行确认

## 提交信息规则

使用 Conventional Commits 格式：`type: description`

**注意发布说明**：

- 提交信息会出现在发布说明中，请为用户撰写。

**类型选择**：

| 类型 | 是否出现在发布说明 | 用途 |
|------|--------------|---------|
| `feat` | 新功能 | 面向用户的新功能 |
| `fix` | 错误修复 | 影响用户的错误修复 |
| `chore`、`ci`、`build`、`refactor` | 不出现 | 内部变更 |

**关键**：仅当修复的是用户可感知的错误时才使用 `fix`，内部修复（linter 错误、类型错误、构建脚本）必须使用 `chore`。

**提交信息质量示例**：

- 差：`fix: fix lingui error`（内部问题）
- 差：`feat: add button`（太模糊）
- 好：`feat: add dark mode toggle to settings`
- 好：`fix: session list not updating after deletion`
- 好：`chore: update lingui compiled messages`
