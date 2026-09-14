## DPA 企业级开发与稳定性门禁（长期规则）

以后每次 DPA 功能更新都必须遵守以下流程，作为项目长期“记忆”和发布门禁：

1. **先分层再展示**：员工公开讨论进入 `room`；任务、工具、Skill、权限、模型 usage、诊断和内部复核进入 `worklog`/`activity`/`control`。聊天框只展示可对参与者公开的讨论，不展示隐藏思维、工具参数或原始诊断。
2. **先测试再发布**：代码完成后必须执行语法检查、单元/集成测试、异常事件测试、损坏 JSONL 恢复测试、高事件量测试、桌面桥接试运行和正式构建包检查。
3. **异常安全退出**：主进程记录未捕获异常和未处理 Promise 拒绝；不在未知状态下继续运行。Electron renderer、GPU、子进程异常要记录并进行有限次数恢复，超过次数给出明确提示，禁止无限重启。
4. **持久化抗崩溃**：JSON 快照使用临时文件替换并 `fsync`；事件日志追加写入并 `fsync`；读取时跳过坏行、恢复其余记录；所有用户数据和工作目录默认不删除。
5. **高负载有上限**：前端事件和流式消息必须设上限，工作台 telemetry 不得无限进入聊天 DOM；长时间运行的项目要支持取消、轮询失败重试和子进程退出诊断。
6. **企业级发布**：版本号递增；暂存构建通过全部门禁后才轮换正式 `dist\\win-unpacked`；旧正式目录进入 `.dpa-backups`，桌面快捷方式只指向唯一正式入口；发布后再次验证 `app.asar`、启动路径、版本号和快捷方式。

该规则参考 AG-UI 对消息、工具、活动和推理事件的分层，OpenHands/AutoGen Studio 对可观测动作与工作区的分离，以及 Electron/Node 官方关于本地 crashReporter、异常退出和持久化安全的建议。详细执行记录应写入每次发布的验证日志。

### 每次发布的最小验证命令

```powershell
npm run check
npm test
npm run smoke:bridge
npm run sync:app-src
npm run dist:dir
npm run verify:staging
```

`verify:staging` 只校验尚未晋升的目录构建，不轮换正式 `dist`、不写桌面快捷方式。只有准备更新本机正式桌面版时，才执行 `npm run publish:desktop`，随后使用 `npm run verify:dist` 复核已晋升版本。
