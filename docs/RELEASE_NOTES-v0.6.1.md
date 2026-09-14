# DeepSeek-PA v0.6.1 — Local IPC security hardening / 本地 IPC 安全加固

[English](#english) | [简体中文](#简体中文)

## English

DeepSeek-PA 0.6.1 is a security-focused developer preview that **supersedes 0.6.0**. It contains every discovery, project-startup, resilience and workspace improvement shipped in 0.6.0; see the [0.6.0 release notes](RELEASE_NOTES-v0.6.0.md) for that feature set.

### Security hardening

- **SHA-256 action identifiers:** project action IDs now use the first 24 hexadecimal characters of a deterministic SHA-256 digest instead of a 16-character SHA-1 prefix. These identifiers correlate local events; they are not authentication tokens.
- **Pinned local iframe messaging:** DPA-owned frames no longer use a wildcard `postMessage` target. The shell targets the local `file://` context and accepts messages only from the expected frame window at the exact Cluster or Extension Center file URL. Child pages likewise require the expected parent window and exact shell URL, while accounting for Chromium's opaque `file:` event origin.
- **Malicious-frame regression:** the desktop bridge smoke test navigates the Cluster iframe to synthetic untrusted content and verifies that the frame cannot invoke the privileged Cluster API or receive appearance/project messages.

### Included from 0.6.0

- Paginated GitHub repository discovery with visible queries, sorting, page jumps and explicit 1,000-result API boundaries.
- DSH credential/ACP startup compatibility, persistent startup errors, retry and duplicate-start protection.
- Runtime cancellation and cleanup safeguards, refreshed Cluster/Extension UI, shared appearance controls and startup WebView readiness handling.

### Validation and publication status

The local 0.6.1 gate completed syntax checks and **100/100 regression tests**, including the new action-ID and local-frame IPC tests. The malicious-frame desktop bridge regression also passed locally. See the [0.6.1 validation summary](VALIDATION-v0.6.1.md).

GitHub Actions and CodeQL results must be checked after the commit is pushed. This pre-publication note does **not** claim that remote CI has passed or that CodeQL has zero alerts.

Download only version-matched 0.6.1 setup/portable assets from [Releases](https://github.com/ZPA76/deepseek-pa-dsh-desktop/releases) and verify `SHA256SUMS.txt`. DSH is not bundled; prepare the separately configured runtime described in the [Windows installation guide](INSTALL-WINDOWS.md).

## 简体中文

DeepSeek-PA 0.6.1 是以安全加固为重点的开发者预览版，**取代 0.6.0**。它完整包含 0.6.0 已发布的扩展发现、项目启动、运行韧性和工作区改进；功能详情见 [0.6.0 更新说明](RELEASE_NOTES-v0.6.0.md)。

### 安全加固

- **SHA-256 操作标识：** 项目操作 ID 由 16 位十六进制 SHA-1 前缀升级为确定性 SHA-256 摘要的前 24 位十六进制字符。该 ID 用于关联本地事件，不是认证令牌。
- **限定本地 iframe 消息边界：** DPA 自有 frame 不再使用通配 `postMessage` 目标。外壳只向本地 `file://` 上下文发送消息，并且仅接受来自预期 frame 窗口及精确集群/扩展中心文件 URL 的消息；子页面也会校验预期父窗口和精确外壳 URL，同时兼容 Chromium 对本地 `file:` 消息报告的不透明来源。
- **恶意 frame 回归：** 桌面桥接冒烟测试会把集群 iframe 导航到合成的不可信内容，验证它既不能调用特权集群 API，也收不到外观或项目消息。

### 包含 0.6.0 的全部功能

- GitHub 仓库分页发现、可见查询、排序、跳页和明确的 1,000 项 API 边界。
- DSH 凭据/ACP 启动适配、持续错误提示、重试与重复启动保护。
- 运行取消及清理保护、集群/扩展界面更新、共享外观设置和 WebView 启动就绪处理。

### 验收与发布状态

0.6.1 本地门禁已通过语法检查及 **100/100 项回归测试**，包含新增的操作 ID 和本地 frame IPC 测试；恶意 frame 桌面桥接回归也已在本机通过。详见 [0.6.1 验收摘要](VALIDATION-v0.6.1.md)。

提交推送后仍须单独核对 GitHub Actions 与 CodeQL。本发布前说明**不会预先声称**远端 CI 已通过或 CodeQL 为零告警。

请只从 [Releases](https://github.com/ZPA76/deepseek-pa-dsh-desktop/releases) 下载版本匹配的 0.6.1 安装版/便携版，并核对 `SHA256SUMS.txt`。DPA 不内置 DSH，仍需按 [Windows 安装指南](INSTALL-WINDOWS.md)另行准备已配置的运行时。

DeepSeek-PA is an independent community project, not an official DeepSeek product. DSH and third-party components retain their respective licenses.
