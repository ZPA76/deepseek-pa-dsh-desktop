# DPA 上传 GitHub 操作指南

这份目录就是完整的 GitHub 仓库上传目录：源码、页面、图标、测试、构建脚本、文档、许可证和 GitHub 社区配置都放在这里。它不包含不应进入源码仓库的本机用户数据、凭证、`node_modules`、构建产物、缓存和旧版备份。

## 推荐仓库名称

首选：`deepseek-pa`

仓库显示标题建议：

> DeepSeek-PA (DPA) — a modular desktop workspace for DeepSeek Harness

仓库简介建议直接使用：

> Unofficial modular DeepSeek Harness desktop workspace with separate Chat and Agent experiences, extensions, Skills, application-wide themes, and supervised multi-agent cluster projects.

推荐 Topics：

```text
deepseek-pa
deepseek-harness
dsh
ai-agents
multi-agent-systems
agent-orchestration
agent-skills
electron
desktop-app
local-first
windows
```

只有当仓库同时提供可安装的 DSH 插件时，才增加 `dsh-plugin`；不要为了曝光添加不准确的标签。

`deepseek-harness-desktop` 这个名称已经有多个社区项目使用，容易混淆。`deepseek-pa` 更短，也能把 DPA 作为独立项目品牌建立起来。

## 创建仓库时怎么选

1. 在 GitHub 新建 Public repository，名称填 `deepseek-pa`。
2. 不要勾选 Add README、Add `.gitignore`、Choose a license，因为本目录已经准备好了这些文件。
3. 创建后进入仓库的 Settings/About，填入上面的描述和 Topics。
4. 创建完成后复制仓库页面显示的 HTTPS 地址。
5. 在本目录空白处按住 Shift 点击鼠标右键，选择“在此处打开 PowerShell”，然后执行：

```powershell
cd '本目录的完整路径'
git init
git branch -M main
git add .
git commit -m "feat: publish DeepSeek-PA desktop workspace"
git remote add origin https://github.com/ZPA76/deepseek-pa-dsh-desktop.git
git push -u origin main
```

本仓库地址已经设置为 `ZPA76/deepseek-pa-dsh-desktop`。如果 GitHub 要求登录，按浏览器提示完成授权；GitHub 已不再接受账户密码作为命令行推送密码。此目录不会自动上传，也不会替你登录 GitHub。

上传成功后刷新仓库网页，应当能看到 `README.md`、`main.js`、`package.json`、`docs`、`scripts`、`test` 和 `.github`。看不到这些文件就说明还没有成功 push。

## GitHub 的基本逻辑

- Repository：项目主页，代码、文档、Issue、Discussion 和 Release 都在这里。
- Commit：一次本地变更记录；可以理解为一个可追踪的版本节点。
- Push：把本地 commit 上传到 GitHub。
- Issue：具体的 Bug、需求或任务。
- Discussion：开放交流、方案讨论和项目展示。
- Release：从 Git tag 发布的可下载版本，适合放 `.exe`/`.zip`；GitHub 官方也建议用 Release 分发软件和二进制文件。
- Star：收藏/关注项目，不等于下载；Fork：复制仓库并可独立修改；Watch：接收更新通知。

## DSH 社区应该怎么参与

DSH 有官方 GitHub Discussions、官方 Discord，以及官方仓库的 `Show Your Plugins!` 分类。DPA 不是 DeepSeek 官方项目，也不是单一 DSH 插件，所以不要把代码直接上传到官方仓库，也不要暗示官方背书。

推荐顺序：

1. 先把 `deepseek-pa` 仓库 README、截图、Release 和安装说明做好。
2. 在官方 DSH Discussions 的 General 或 Show Your Plugins! 发一篇简短介绍，明确写“unofficial community desktop companion”。
3. 在帖子中给出 GitHub 链接、30 秒 GIF/截图、当前版本、安装方法和已知限制。
4. 关注官方 `dsh-plugin` Topic；如果以后把 DPA 的某部分拆成真正可安装的 DSH 插件，再单独做插件仓库并使用该 Topic。
5. 后续用户反馈放在自己的 Issue/Discussion，DSH 本体 Bug 再回报官方仓库。

## 曝光度的现实做法

GitHub 不会因为创建仓库就自动给流量。比“标题夸张”更有效的是：

- README 首屏在 10 秒内说明“它解决什么问题”；
- 放一张清晰的集群项目截图或 20–40 秒 GIF；
- 给出可复制的安装命令和一个最小演示项目；
- 每次发布使用 `v0.5.1` 这样的 tag 和 Release notes；
- 用英文关键词 + 中文说明；
- 真实回应 Issue，不刷星、不互相灌水；
- 每次更新写清楚兼容的 DSH 版本、Windows 版本和已知限制；
- 先讲清 DPA 的总定位——模块化 DSH 桌面工作台——再分别展示 Chat/Agent 分离、主题与字体、扩展与 Skill、集群协作、人工审批和本地优先等亮点。

第一阶段的目标不要定成“马上获得很多 Star”，而是让陌生用户能够安装、看懂、复现并提出第一条有效反馈。

## 发布桌面安装包

不要把本地 `dist` 整个目录提交到 Git。正式构建后，在 GitHub 的 Releases 页面创建 `v0.5.1`，上传 Windows 安装包或 portable ZIP，并在 Release notes 中写：兼容的 DSH 版本、安装步骤、校验值和已知问题。源码仓库只保留构建脚本与说明。

## 上传前最后检查

```powershell
rg -n "DEEPSEEK_API_KEY|ZHIPU_API_KEY|credentials|token|password|Z:\\|C:\\Users" .
Get-ChildItem -Force
npm run check
npm test
```

如果搜索结果出现真实凭证、个人目录、项目数据或日志，不要上传；先删除或改为环境变量/占位符。