# DeepSeek-PA 0.6.0 — Windows installation / Windows 安装

[English](#english) | [简体中文](#简体中文) · [Downloads / 下载](https://github.com/ZPA76/deepseek-pa-dsh-desktop/releases)

## English

DPA is an unofficial Windows x64 developer preview. It does **not** bundle DeepSeek Harness (DSH). Version 0.6.0 was tested with **DSH 0.1.5-rc.2**; other runtime versions may require additional compatibility work.

### 1. Prepare the runtime

Use Windows 10/11 x64, Node.js 22+ and the package manager required by your DSH checkout (pnpm for the tested checkout). Follow the [upstream DSH instructions](https://github.com/deepseek-ai/deepseek-harness) to prepare that version and configure your model credentials outside the DPA installation directory.

Keep the DSH runtime directory and DSH home distinct. The runtime contains DSH's `package.json`; DSH home contains the configured profiles, sessions and credentials. Pointing DPA at an empty home does not reuse credentials configured elsewhere.

### 2. Download DPA

On [Releases](https://github.com/ZPA76/deepseek-pa-dsh-desktop/releases), select the desired preview and download one of:

| File | Purpose |
| --- | --- |
| `DeepSeek-PA-Setup-0.6.0-win-x64.exe` | Guided per-user Windows installer |
| `DeepSeek-PA-0.6.0-win-x64-portable.zip` | Extract the complete archive and launch `DeepSeek-PA.exe` |
| `SHA256SUMS.txt` | SHA256 checksums of the release assets |

If these 0.6.0 files are not listed yet, the binaries have not been published. Do not rename older downloads. GitHub's automatic “Source code” downloads require building and are not desktop installers.

The preview is not commercially code-signed; Windows may show an unknown publisher. Download from the DPA repository and verify the checksum before running:

```powershell
Get-FileHash '.\DeepSeek-PA-Setup-0.6.0-win-x64.exe' -Algorithm SHA256
Get-Content '.\SHA256SUMS.txt'
```

### 3. Connect the existing DSH environment

Replace the example paths below, then run these PowerShell commands. They set environment variables for your Windows user, not for all users:

```powershell
[Environment]::SetEnvironmentVariable('DSH_DESKTOP_HARNESS_DIR', 'C:\path\to\deepseek-harness', 'User')
[Environment]::SetEnvironmentVariable('DSH_DESKTOP_DSH_HOME', 'C:\path\to\your\configured-dsh-home', 'User')
```

Completely exit DPA, including its tray process, and reopen it. If a launcher still has the old environment, sign out of Windows and sign in again. Never put an API key into the source repository or these path variables.

Without overrides, DPA's user data is stored under `%LOCALAPPDATA%\DeepSeek-PA\data`, and its DSH home under `%LOCALAPPDATA%\DeepSeek-PA\dsh-home`. The latter still needs model configuration. Set `DSH_DESKTOP_DATA_DIR` only when deliberately choosing a different application-data location.

### Optional GitHub account sign-in

Anonymous public-repository search works without a GitHub account. To enable the account button in DPA 0.6.0, register your own GitHub OAuth App, enable Device Flow, and save its client ID for the Windows user:

```powershell
[Environment]::SetEnvironmentVariable('DPA_GITHUB_CLIENT_ID', 'YOUR_GITHUB_OAUTH_CLIENT_ID', 'User')
```

Completely exit DPA, including the tray process, and reopen it before starting the device flow. The current request asks GitHub for the `read:user` and `repo` scopes. `repo` is broader than public search and can authorize private-repository access; inspect the GitHub consent page and do not sign in if anonymous browsing is sufficient. DPA encrypts a returned token with Electron `safeStorage`; disconnecting the account removes the stored token file.

### 4. First launch and updates

Confirm the Agent view can connect to your local DSH. In Cluster, create or select an employee, create a project, enter its task, and click **Start project**. Failed startup checks display the cause and allow retry after correcting configuration.

The DSH update control updates the runtime; a DPA desktop release updates the shell and DPA modules. For a desktop update, close DPA completely, preserve the configured data paths, and install the new version or replace the extracted application directory. Do not copy private data into program files, run multiple old copies, or delete data directories as a repair step.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing model credentials | DPA and the working DSH environment must use the same configured DSH home. |
| Local port 3080 is occupied | Identify the existing DSH instance and close/reuse it deliberately; do not terminate unrelated processes. |
| `authentication required` in Agent | Reopen DPA so it obtains the current authenticated local URL; avoid copying token-bearing URLs into reports. |
| GitHub returns a limit or sign-in error | Read the displayed error, authenticate if appropriate, or wait for the API limit to reset. |
| A newer runtime stops working | Compare the version with tested DSH 0.1.5-rc.2 and include a redacted error in an issue. |

Local diagnostics are under the DPA data directory's `logs` folder. Review and redact paths, prompts and credentials before sharing any log. See [Privacy](https://github.com/ZPA76/deepseek-pa-dsh-desktop/blob/main/docs/PRIVACY.md).

## 简体中文

DPA 是非官方 Windows x64 开发者预览版，**没有内置 DSH**。0.6.0 已测试 DSH 0.1.5-rc.2；不能保证其他版本兼容。

1. **准备环境。** 使用 Windows 10/11 x64、Node.js 22+，并按[上游说明](https://github.com/deepseek-ai/deepseek-harness)准备 DSH 及其要求的包管理器（本轮为 pnpm）。在自己的 DSH 数据目录配置模型，不把凭据放入 DPA 安装目录。
2. **选择下载。** 从上方 Releases 下载 0.6.0 安装版 `.exe` 或便携版 `.zip`，对照 `SHA256SUMS.txt` 校验。便携版要完整解压，再运行 `DeepSeek-PA.exe`。自动生成的 Source code 不是安装包；没有列出的 0.6.0 附件表示尚未公开发布。
3. **设置两个目录。** 将上方 PowerShell 示例中的 `DSH_DESKTOP_HARNESS_DIR` 改为 DSH 根目录；将 `DSH_DESKTOP_DSH_HOME` 改为已经配置凭据的 DSH 数据目录。二者用途不同。复制命令时只填目录，不填密钥。

### 可选：GitHub 账号登录

匿名搜索公开仓库无需账号。若要启用 0.6.0 的账号按钮，需要自行注册 GitHub OAuth App、启用 Device Flow，并按英文示例把 `DPA_GITHUB_CLIENT_ID` 写入当前 Windows 用户环境变量，随后完全退出并重开 DPA。当前授权会请求 `read:user` 与 `repo` scope；`repo` 权限明显宽于公开搜索，并可能授权访问私有仓库，请在 GitHub 授权页确认后再继续，不需要时保持匿名。

4. **完全退出后重开。** 包括托盘进程。若启动器还持有旧环境变量，注销 Windows 后重新登录。默认程序数据位于 `%LOCALAPPDATA%\DeepSeek-PA\data`，默认 DSH home 位于 `%LOCALAPPDATA%\DeepSeek-PA\dsh-home`；使用默认 home 也需要在其中配置模型。
5. **试运行。** 先确认 Agent 能连接本地 DSH，再在集群中选员工、建项目、填写任务并点击“开始项目”。失败原因会显示在状态区，修正配置后可以重试。
6. **更新。** DSH 更新与 DPA 桌面更新是两条版本线。安装新版 DPA 前完全退出软件，保留现有数据目录；不要把旧程序复制成多个启动入口，也不要通过删除项目或凭据目录修复问题。

没有商业代码签名时，Windows 可能提示“未知发布者”。先核对下载来源和 SHA256。遇到凭据错误优先检查 DSH home 是否一致；3080 端口占用时先确认是哪个 DSH 进程，不随意结束其他程序；出现本地鉴权提示可重开 DPA 获取当前入口，不公开带 token 的 URL。

问题反馈请附版本、复现步骤和脱敏后的错误信息。截图与日志里不要包含真实会话、个人文件路径或密钥。程序能打开不代表所有插件兼容，详见[验收摘要](https://github.com/ZPA76/deepseek-pa-dsh-desktop/blob/main/docs/VALIDATION-v0.6.0.md)。
