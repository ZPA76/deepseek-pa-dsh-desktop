# DPA 0.6.0 — Public validation summary / 公开验收摘要

Validation window: 2026-09-13 to 2026-09-14. Environment: Windows x64, Electron 43.4.1, DSH 0.1.5-rc.2. This summary reports the local development-release checks; it does not by itself certify every future downloadable artifact or other runtime version.

| Evidence | Observed result |
| --- | --- |
| Syntax and regression tests | Syntax checks passed; 98 regression tests passed in the release validation run. |
| Packaged application integrity | Application files/resources, local module dependencies, production YAML dependency and package version were verified. |
| Packaged desktop interaction | Pagination, duplicate-start protection, visible startup failure, retry, three resize handles, project context menu and six built-in themes passed; no recorded renderer errors. |
| Real GitHub requests | Anonymous search returned different first/second pages; the boundary page exposed results 991–1000 while retaining the independent total count. |
| Real ACP compatibility | Packaged client initialized a session against the tested DSH runtime. A minimal synthetic model request returned the expected short reply with no tool calls. |
| Visual review | Dark, warm, light, compact 980px workspace, discovery and appearance settings reviewed using synthetic data. |
| Local-data boundaries | Development checks used isolated fixtures; personal project delivery was not executed as a screenshot/demo test. |

## What these checks do not prove

- Synthetic UI/IPC fixtures verify interaction behavior. Real network and ACP checks were separate; neither is evidence that an arbitrary multi-agent project completes successfully.
- No multi-day endurance result or blanket third-party plugin compatibility claim is made.
- GitHub Search API limits a single query to the first 1,000 results. Refinement is required beyond that range.
- Theme review covered DPA-owned navigation, Cluster and Extension Center. Newer DSH Agent content is not fully color-adapted, and the remote Chat website retains its own appearance.
- The original local package hash is not reused as a hash for a rebuilt public installer. Each publicly uploaded asset must receive its own checksum and corresponding artifact checks.

## Screenshot provenance and privacy

Gallery images use fixed fictional roles, sample project messages and local test fixtures. The discovery illustration contains **75 simulated repositories**, not a live GitHub search. No user identity, actual project, credential, machine path or personal conversation is included. PNG text/EXIF metadata checks found no such metadata chunks in the selected files.

Raw logs, local runtime repair files, private paths and personal-data checks are omitted from this public summary. Screenshots demonstrate the interface; they are not independent evidence of completed work.

## Reproducing repository checks

```powershell
npm ci
npm run check
npm test
npm run smoke:bridge
npm run sync:app-src
npm run dist:dir
npm run verify:staging
```

Desktop smoke/build steps require a suitable Windows/Electron environment. `verify:staging` checks the unpacked directory build without promoting it or changing desktop shortcuts. Use `publish:desktop` followed by `verify:dist` only when publishing the local formal desktop build under the repository's [update policy](UPDATE_POLICY.md). Real ACP checks additionally require your own configured DSH environment and can consume model usage.

## 中文说明

本记录对应 2026-09-13 至 2026-09-14 的 Windows x64 本地开发发行验收，运行环境为 Electron 43.4.1 与 DSH 0.1.5-rc.2。语法检查、98 项回归、打包界面交互、六种主题、真实 GitHub 分页及最小真实 ACP 请求均有对应结果。

界面验收使用可复现的模拟消息和项目；真实网络及运行时请求另行检查，不能把这些检查合并描述成“真实复杂项目已经完整交付”。未验证多日连续高负载运行或所有第三方插件。

公开截图没有使用私人会话，发现页的 75 项为合成仓库。上游 Agent 的全局主题适配仍有边界。公共安装包若重新构建，必须重新校验文件和哈希，不能沿用本机旧包的哈希。原始本地日志和修复资料没有复制到此文档。
