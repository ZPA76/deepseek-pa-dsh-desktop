# DeepSeek-PA v0.6.0 — Paginated discovery, reliable project startup and a refreshed workspace

[English](#english) | [简体中文](#简体中文)

## English

DPA is an unofficial modular Windows desktop workspace built around DeepSeek Harness (DSH). Version 0.6.0 remains a **developer preview**, tested with **DSH 0.1.5-rc.2**.

### Changes

- **Discovery:** GitHub repository search now preserves the visible query and supports sorting, previous/next pages, page jumps, and 30 / 60 / 100 items per page. The curated list is a separate source; result totals and the equivalent GitHub search are accessible.
- **Project startup:** updated credential-file and ACP-launch compatibility, startup checks, persistent errors, retry and duplicate-click protection. Failures and cancellation clear stale running state and empty streams.
- **Runtime resilience:** bounded model waiting, cancellation handling, safer child-process failure handling, parallel-worker cleanup and more explicit permission handling.
- **Workspace design:** clearer navigation, employee cards, project lists, discussion typography, task panels and keyboard focus. Approval details scroll within a bounded panel; small windows keep task details below the conversation.
- **Startup stability:** webview work waits for readiness before page operations, preventing an initialization-time unhandled error.

### Installation and compatibility

Download the versioned setup `.exe` or portable `.zip` from [Releases](https://github.com/ZPA76/deepseek-pa-dsh-desktop/releases), and verify `SHA256SUMS.txt`. Follow the [Windows installation guide](https://github.com/ZPA76/deepseek-pa-dsh-desktop/blob/main/docs/INSTALL-WINDOWS.md).

DSH, its package-manager/runtime requirements and model credentials must be configured separately; **DSH is not bundled**. Windows x64 only; binaries are not commercially code-signed. Assets absent from the Release have not been published.

### Validation and limits

Local validation included **98 regression tests**, packaged UI interactions with six themes, real GitHub pagination and a minimal real ACP request. See the [validation summary](https://github.com/ZPA76/deepseek-pa-dsh-desktop/blob/main/docs/VALIDATION-v0.6.0.md) for the evidence and its limits.

- GitHub Search API exposes at most the first **1,000 results per query**. DPA displays this limit; refine the query to explore other results. Visible repositories are not necessarily installable extensions.
- Themes cover DPA's own shell, Cluster and Extension Center. Newer upstream Agent pages are not fully color-adapted; remote Chat retains its website appearance.
- Employee development changes profiles and prompts, not model weights. Fine-tuning/distillation is not implemented. Public discussion excludes hidden model reasoning.
- Synthetic screenshot fixtures demonstrate UI behavior; the 75 discovery results are simulated. No claim is made that synthetic UI checks prove full real-project delivery or multi-day stability.

## 简体中文

DPA 是基于 DeepSeek Harness（DSH）构建的非官方模块化 Windows 桌面工作台。0.6.0 仍为**开发者预览版**，已测试 **DSH 0.1.5-rc.2**。

### 更新内容

- **扩展发现：** 保留界面可见的 GitHub 查询，支持排序、上一页/下一页、跳页和每页 30 / 60 / 100 项。DPA 推荐独立为一个来源，可查看总数并打开同条件 GitHub 搜索。
- **项目启动：** 适配新版凭据和 ACP 入口，补齐启动前检查、持续错误提示、重试及重复点击保护；失败和取消后清理旧运行状态及空流式消息。
- **运行稳定性：** 补齐模型等待上限、取消响应、子进程异常处理、并行员工清理和权限判断。
- **桌面界面：** 改善导航、员工卡片、项目列表、聊天字体、任务面板与键盘焦点；审批内容独立滚动，小窗口下任务面板移到讨论区下方。
- **启动安全：** WebView 就绪后再进行页面操作，避免初始化时的未处理异常。

### 安装与边界

从 [Releases](https://github.com/ZPA76/deepseek-pa-dsh-desktop/releases) 下载版本匹配的安装版或便携版，并检查 `SHA256SUMS.txt`，详见[安装指南](https://github.com/ZPA76/deepseek-pa-dsh-desktop/blob/main/docs/INSTALL-WINDOWS.md)。**本版没有内置 DSH**，需另外准备 DSH、其依赖工具及模型凭据。仅提供 Windows x64 预览版，尚无商业代码签名；Release 未列出的附件表示尚未发布。

本地已完成 **98 项回归测试**、六种主题的打包交互、真实 GitHub 分页和最小真实 ACP 请求，证据与限制见[验收摘要](https://github.com/ZPA76/deepseek-pa-dsh-desktop/blob/main/docs/VALIDATION-v0.6.0.md)。

- GitHub Search API 每个查询最多翻阅前 **1,000 项**，DPA 会展示该边界；可细化关键词继续检索。检索结果不等于兼容扩展。
- DPA 原生模块共享主题；新版上游 Agent 仍有配色未覆盖处，远程 Chat 保持网站原样。
- 员工培养属于配置与提示词调整，未实现微调或蒸馏；公开讨论不展示隐藏思维。
- 所有展示截图均为合成数据，发现页 75 项是模拟仓库。UI 模拟验收不能替代真实项目交付或多日压力测试。

DeepSeek-PA is an independent community project, not an official DeepSeek product. DSH and third-party components retain their respective licenses.
