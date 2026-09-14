# DPA 0.6.1 — Public validation summary / 公开验收摘要

Local validation date: 2026-09-15. Target: Windows x64, Electron 43.4.1 and DSH 0.1.5-rc.2. Version 0.6.1 supersedes 0.6.0 and includes its complete feature set; this record focuses on the new security gate and separates local evidence from remote checks that can exist only after publication.

## Local evidence

| Gate | Observed local result |
| --- | --- |
| Package metadata | Root package and lockfile package versions are `0.6.1`; production `yaml` remains `2.9.1`. |
| Syntax gate | `npm run check` completed successfully. |
| Regression suite | `npm test` completed with **100/100 tests passing** and no failed, skipped, cancelled or todo tests. |
| Action-ID regression | Deterministic action IDs match a 24-character lowercase hexadecimal prefix derived from SHA-256. |
| Local iframe IPC regression | Static checks reject wildcard message targets and require the expected parent/frame source plus exact local shell/frame URL. |
| Malicious-frame desktop regression | The Electron bridge smoke test navigated the Cluster frame to synthetic untrusted content; no appearance/project message was observed and the forged privileged Cluster request was not dispatched. |
| Public-export gate | The repository export audit and local Markdown link/version consistency checks passed. |

The 100-test total is the Node regression suite. The Electron malicious-frame bridge check is an additional local desktop smoke gate rather than an extra numbered Node test.

## Inherited 0.6.0 coverage

0.6.1 contains all 0.6.0 changes. The earlier release record covers packaged interactions across six themes, real GitHub pagination and a minimal real ACP request. Those historical observations are not silently relabelled as newly rerun network/model checks; see [VALIDATION-v0.6.0.md](VALIDATION-v0.6.0.md).

## Remote checks pending push

- Confirm the GitHub Actions matrix on the exact pushed 0.6.1 commit.
- Confirm the CodeQL workflow and review every alert against that same commit.
- Confirm the tag, release assets and freshly generated `SHA256SUMS.txt` after packaging.

Until those steps finish, this document makes **no claim** that remote CI passed, that CodeQL produced zero alerts, or that downloadable 0.6.1 artifacts have been verified.

## Security scope and remaining limits

- SHA-256-derived action IDs improve collision resistance for local event correlation; they are not secrets, authorization decisions or replacements for runtime permission checks.
- The frame controls authenticate DPA-owned local page relationships. They do not turn Electron, DSH tools or a selected project directory into an operating-system sandbox.
- Synthetic iframe content tests the message boundary; it is not proof against every future navigation, Electron or browser-engine vulnerability.
- No multi-day endurance result or blanket third-party plugin compatibility claim is made.

## Reproducing local gates

```powershell
npm ci
npm run check
npm test
node scripts/public-export-audit.js
npm run smoke:bridge
git diff --check
```

The desktop smoke command requires a suitable Windows/Electron environment. It uses synthetic fixtures and must not consume or publish personal project data. Build and Release verification are separate post-build steps.

## 中文说明

本记录对应 2026-09-15 的 0.6.1 本地安全门禁。0.6.1 取代 0.6.0 并包含其全部功能；本轮新增证据是 SHA-256 操作标识、本地 iframe 来源/URL 校验和恶意 frame 隔离回归。

本地语法检查、公开导出检查和 **100/100 项 Node 回归测试**通过；Electron 桌面桥接还额外验证了被导航到合成不可信内容的 frame 既不能调用特权集群 API，也收不到外观或项目消息。100 项数量不把这条额外桌面冒烟重复计数。

GitHub Actions、CodeQL、标签、安装包和安装包哈希只能在推送及构建后核对。因此当前文档不会提前写“远端 CI 已通过”“CodeQL 0 告警”或“0.6.1 安装包已验证”。0.6.0 的真实 GitHub/ACP 与打包界面历史证据仍保留在 [0.6.0 验收摘要](VALIDATION-v0.6.0.md)，不会伪装成本轮重新执行的检查。
