# DPA 0.6.0：更新现有 GitHub 仓库

当前仓库是 [ZPA76/deepseek-pa-dsh-desktop](https://github.com/ZPA76/deepseek-pa-dsh-desktop)。这次更新沿用已有仓库和历史，不需要再创建同名仓库，也不要把源码目录里的 `.git` 删除后重新初始化。

本目录用于提交源码、双语文档、测试、构建脚本和经过检查的演示截图。桌面安装包单独放到 GitHub Releases；用户项目、凭据、日志、缓存和运行时目录不进入源码仓库。范围见 [公开导出清单](PUBLIC_EXPORT_MANIFEST.md)。

## 1. 检查准备上传的内容

在本目录打开 PowerShell：

```powershell
git status --short
git remote -v
git branch --show-current
git diff --stat
git diff -- README.md README.zh-CN.md package.json
npm ci
npm run check
npm test
```

`origin` 应指向上面的仓库。不要在发现地址不符时继续推送；先核对自己所在目录。截图与文档已使用合成数据，最新源码和安装包仍必须分别验证。

隐私检查只先列出匹配文件，避免把潜在密钥回显到终端记录：

```powershell
git status --short --untracked-files=all
rg -l --hidden --glob '!.git/**' --glob '!node_modules/**' --glob '!package-lock.json' '(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)' .
```

没有命中不等于完成安全审计；还应检查文件列表，确认没有 `.credentials.yaml`、`.env`、token 文件、真实项目、日志、缓存、旧备份和本机截图。API 字段名与示例占位符属于正常源码，不能见到 `token` 一词就删除。

## 2. 提交并推送源码

检查完成后再执行：

```powershell
git add .
git diff --cached --stat
git diff --cached --check
git commit -m "feat: release DPA 0.6.0 desktop improvements"
git push origin main
```

若远端已有新提交导致推送被拒绝，先检查分歧并合并，不使用强制推送覆盖他人的修改。遇到 GitHub 认证提示时，通过浏览器或已配置的 Git 凭据管理器登录，不把访问令牌写进仓库或 remote URL。

上传后检查首页能打开双语 README 和五张图片，`package.json` 为 0.6.0，CI 检查通过。源码推送和 Release 安装包发布是两件事。

## 3. 创建 0.6.0 预发布

进入仓库 **Releases → Draft a new release**，选择已经通过检查的 `main` 提交，并建立标签 `v0.6.0`。若该标签已经存在，先核对它对应的提交，不能把旧标签静默移到新代码。

标题建议：

> DeepSeek-PA v0.6.0 — Paginated discovery, reliable project startup and refreshed workspace

将 [0.6.0 更新说明](docs/RELEASE_NOTES-v0.6.0.md) 的双语正文填入 Release notes。选择 **Pre-release**（开发者预览）。GitHub 界面标签可能调整，以其“非生产就绪版本”含义为准。

在附件区域上传经过验证的以下文件；文件名应与实际产物及校验清单一致：

| 文件 | 用途 |
| --- | --- |
| `DeepSeek-PA-Setup-0.6.0-win-x64.exe` | Windows 安装版 |
| `DeepSeek-PA-0.6.0-win-x64-portable.zip` | 解压即启动的桌面程序；仍需另备 DSH |
| `INSTALL-WINDOWS.md` | 安装说明，从 docs 中的同名文件复制 |
| `SHA256SUMS.txt` | 对实际上传的安装版与便携版计算 SHA256 |

不要把旧版 0.5.1 文件改名成 0.6.0，不上传 `dist` 整目录、开发用 `node_modules`、真实配置或本机验证日志。文件上传完成后预览正文，确认版本与附件吻合，再发布。GitHub 自动生成的 Source code 压缩包是源码，不是桌面安装包。

本版本仍需单独准备 DSH，已测试 DSH 0.1.5-rc.2。不要在 Release 文案中写“内置 DSH”或“无需配置”。

## 4. About 与 Topics

双语简介：

> 基于 DeepSeek Harness（DSH）的非官方模块化 Windows 桌面工作台，集成独立 Chat/Agent、扩展与主题、员工培养和可监督多智能体项目。Unofficial modular desktop for DSH with separate Chat/Agent, extensions, themes and supervised multi-agent projects.

建议 Topics：

```text
deepseek-pa deepseek-harness dsh electron desktop-app windows
ai-agents multi-agent-systems agent-orchestration agent-skills local-first
```

仓库名称保持 `deepseek-pa-dsh-desktop`。DPA 目前不是一个单独可安装的 DSH 插件，不为了曝光添加容易误导的 `dsh-plugin` 标签。

## 5. 发布后核对与交流

使用浏览器打开公开仓库，检查图片、双语切换、下载和安装链接。在干净测试环境验证下载的安装包及其哈希值，不以开发目录运行成功代替发行验收。

如要在 [DSH Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 介绍项目，先阅读当前版规，选择适合社区作品展示的分类，明确注明“独立非官方桌面项目”，附自己的仓库、Release 和演示链接。源代码仍放在自己的仓库，不直接上传到 DSH 官方仓库。

说明可以介绍模块化桌面、Chat/Agent 分离、可定制外观、扩展发现和集群审批，避免只把 DPA 描述成“集群插件”。社区发帖属于单独的对外操作；本文件中的步骤不会自动发布任何内容。
