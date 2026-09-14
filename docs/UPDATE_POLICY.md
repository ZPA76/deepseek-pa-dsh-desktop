# DPA 桌面版更新规范

这是 DPA 的固定发布规则，后续不再直接把新版本放进另一个可运行目录。

## 唯一启动目录

- `dist\win-unpacked\DeepSeek-PA.exe` 是唯一正式解压版入口。
- 桌面 `DPA.lnk` 始终指向上面的入口。
- `dist-staging` 只用于构建过程，发布成功后必须消失。
- `dist-rebuilt` 是历史临时目录，迁移后不再作为启动路径。

## 发布流程

在 DPA 完全退出（包括托盘图标）后，在 `harness-desktop` 目录执行：

```powershell
npm run publish:desktop
npm run verify:dist
```

发布器会依次执行：

1. 检查 DPA 是否仍在运行；运行中不会强制结束，避免丢失未保存内容。
2. 同步应用源文件到 `app-src`。
3. 在 `dist-staging` 构建新版。
4. 检查可执行文件和 `app.asar` 完整性。
5. 将旧 `dist` 和历史 `dist-rebuilt` 归档到 `.dpa-backups`。
6. 原子地把暂存目录改名为 `dist`。
7. 写入 `release.json` 并重新生成桌面快捷方式。

## 数据安全

更新只轮换桌面程序目录，不删除或覆盖以下业务数据：

- DSH 用户目录：默认 `%LOCALAPPDATA%\DeepSeek-PA\dsh-home`，可通过 `DSH_DESKTOP_DSH_HOME` 或 `DSH_HOME` 指定。
- DPA 用户数据：默认 `%LOCALAPPDATA%\DeepSeek-PA\data`，可通过 `DSH_DESKTOP_DATA_DIR` 指定。
- DPA 源码和托管 DSH 运行时

`.dpa-backups` 是回滚保留区，不是启动目录。若新版出现问题，可以从其中恢复上一版正式目录；恢复前必须先退出 DPA。

## 禁止事项

- 不要直接双击 `dist-staging` 或 `.dpa-backups` 里的程序。
- 不要手动复制出第二个 `win-unpacked` 目录作为“新版”。
- 不要在 DPA 运行时替换 `dist`。
- 不要把 DPA 桌面程序和 DSH 数据目录混在一起。
