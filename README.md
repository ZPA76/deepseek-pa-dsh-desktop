# DeepSeek-PA (DPA)

**An unofficial modular desktop workspace for DeepSeek Harness (DSH).**

DeepSeek-PA (DPA) turns the local DeepSeek Harness ecosystem into a cohesive, customizable desktop application. It separates everyday Chat from task-oriented Agent work, adds a modular capability and extension center, supports application-wide themes and typography, and provides a supervised multi-agent Cluster workspace for larger projects.

> DPA is an independent community project. It is not an official DeepSeek product and does not replace the upstream DSH runtime. DeepSeek Harness and its trademarks belong to their respective owners.

## Highlights

- Unified Windows desktop shell with separate Chat and Agent workspaces, tray residency, startup recovery, and update-safe packaging.
- Modular capability architecture for adding, discovering, enabling, and managing DSH plugins, Skills, themes, fonts, and future DPA modules.
- Application-wide appearance system with custom themes, DSH/VS Code theme conversion, typography controls, background images, and GitHub extension discovery.
- DSH runtime integration with local sessions, tools, Skills, plugins, and update compatibility checks.
- Cluster projects with three governance policies: hierarchical, collaborative, and autonomous.
- Reusable employee profiles with role, model, skills, training history, versioning, and project appointments.
- Public project-room discussions separated from work logs, tool calls, permissions, diagnostics, and usage telemetry.
- Harness-backed employees can use files, Shell, Skill discovery, and other DSH tools inside a project workspace.
- Three computer-access levels: request approval, risk-managed automatic execution, and full project-workspace access.
- User approval gates for plans and final deliverables, with versioned revisions and preserved history.
- Global themes, DSH/VS Code theme conversion, typography controls, background images, GitHub extension browsing, and Skill discovery.
- Local-first persistence with append-only event logs, atomic snapshots, bounded UI event buffers, and crash diagnostics.

## Status

DPA is an active developer-preview project. DSH is also a rapidly changing developer preview, so compatibility-breaking upstream changes are possible. The current local release is `0.5.1`.

## Requirements

- Windows 10/11 x64 for the packaged desktop build.
- Node.js 22+ and npm for development.
- A local DeepSeek Harness checkout or runtime. See the [upstream DSH repository](https://github.com/deepseek-ai/deepseek-harness).
- Model credentials supplied through environment variables or a user-owned DSH credentials file. Never commit credentials to this repository.

## Development quick start

```powershell
npm install
$env:DSH_DESKTOP_HARNESS_DIR = 'C:\path\to\deepseek-harness'
$env:DSH_DESKTOP_DSH_HOME = "$env:LOCALAPPDATA\DeepSeek-PA\dsh-home"
$env:DSH_DESKTOP_DATA_DIR = "$env:LOCALAPPDATA\DeepSeek-PA\data"
npm start
```

Run the quality gates before opening an issue or pull request:

```powershell
npm run check
npm test
```

The packaged desktop build is created with:

```powershell
npm run sync:app-src
npm run dist:dir
```

Build output is intentionally ignored by Git. Upload installers and portable archives as GitHub Release assets, not as ordinary source files.

## Architecture

DPA owns the desktop shell, employee identities, cluster governance, project persistence, approval flow, appearance layer, and extension/Skill discovery. DSH owns the agent runtime, plugin composition, sessions, tools, and underlying web service. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DPA-DEVELOPMENT-GUARDRAILS.md](docs/DPA-DEVELOPMENT-GUARDRAILS.md).

## Security and privacy

DPA stores project records and encrypted GitHub credentials locally. Do not upload `DSH_HOME`, `.credentials.yaml`, `dsh-desktop-data`, logs, caches, `node_modules`, `dist`, or `.dpa-backups`. See [SECURITY.md](SECURITY.md) and [docs/PRIVACY.md](docs/PRIVACY.md).

## Contributing

Bug reports, design feedback, documentation improvements, and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first. For upstream DSH questions, use the official [DSH Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).

## License

DPA source code is released under the MIT License. DSH and third-party packages retain their own licenses; see [NOTICE.md](NOTICE.md).