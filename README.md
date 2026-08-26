# DeepSeek-PA (DPA)

[English](README.md) | [简体中文](README.zh-CN.md)

**An unofficial modular desktop workspace for DeepSeek Harness (DSH).**

DeepSeek-PA turns the local DeepSeek Harness ecosystem into a cohesive Windows desktop application. It keeps everyday Chat separate from task-oriented Agent work, adds a unified extension and appearance center, and provides a supervised multi-agent Cluster workspace for larger projects.

> DPA is an independent community project built on DeepSeek Harness. It is not an official DeepSeek product and does not replace the upstream DSH runtime.

![DPA Cluster project workspace](docs/images/dpa-cluster-room.png)

> All screenshots use synthetic demo projects and fictional employee profiles. They contain no personal account, production project, local path, or credential data.

## Why DPA

DeepSeek Harness is a composable agent runtime. DPA focuses on the desktop experience around that runtime: organizing different ways of working, exposing capabilities without forcing users to edit configuration files, and making multi-agent execution visible and governable.

DPA is more than a desktop wrapper and the Cluster module is only one part of the product. Its current direction combines:

- **Agent and Chat separation:** use the local DSH Agent workspace for tool-driven work while keeping ordinary DeepSeek Chat in a dedicated view.
- **Modular capability center:** discover and manage plugins, Skills, themes, fonts, backgrounds, updates, backups, and future DPA modules from one place.
- **Application-wide appearance:** apply themes across DPA, import compatible theme definitions, adjust typography and zoom, or use an image background independently of the active theme.
- **Supervised multi-agent projects:** create employee profiles, appoint a project team, discuss work visibly, execute tasks with tools, review evidence, and approve plans or deliverables.
- **Local-first operations:** preserve project events, revisions, approvals, work traces, diagnostics, and recovery data on the local machine.

## Product modules

| Module | What it provides |
| --- | --- |
| Agent | Local DSH task workspace for agents, tools, files, Shell commands, plugins and Skills. |
| Chat | A separate conversational workspace for ordinary DeepSeek Chat usage. |
| Extension Center | GitHub discovery, plugin and Skill management, themes, fonts, backgrounds, update and recovery controls. |
| Employee Center | Reusable employee-agent identities with roles, models, Skills, development history, versions and project appointments. |
| Cluster Projects | Project rooms, governance policies, public discussions, tasks, decisions, approvals, deliverables and telemetry. |
| Desktop Shell | Tray residency, global navigation, startup recovery, update-safe packaging and crash diagnostics. |

## Interface gallery

### Extension and Skill discovery

Search plugins, Skills, themes and MCP integrations from one modular center. GitHub browsing can remain anonymous or use an authenticated account when higher limits and account features are needed.

![DPA Extension Center](docs/images/dpa-extension-center.png)

### Employee development

Employees are persistent, editable agent identities rather than one-off prompts. Profiles can be revised, trained through staged development records, versioned, archived and appointed differently for each project.

![DPA Employee Center](docs/images/dpa-cluster-room-employees.png)

### Project creation and governance

Every project selects participating employees and one of three governance policies—hierarchical, collaborative or autonomous. These policies change authority and coordination; they do not create three unrelated workflow engines.

![DPA new project wizard](docs/images/dpa-cluster-room-wizard.png)

### Visible work with human approval

The project room separates employee discussion from work traces, tool calls, tasks, decisions, approvals and delivery records. Computer access can be configured as request approval, risk-managed automatic execution, or full access limited to the project workspace.

## Cluster lifecycle

1. Create a project, define its goal and optional workspace.
2. Choose a governance policy and appoint employee agents.
3. Introduce the task in the public project discussion.
4. Let employees discuss the plan while DPA records decisions and responsibilities.
5. Review and approve the proposed plan.
6. Execute tasks through DSH tools and Skills with the selected permission level.
7. Inspect progress, tool traces, token usage and cache metrics outside the public discussion.
8. Review a structured delivery report covering completed work, discussion outcomes, risks and approval requests.
9. Accept the delivery or return it for a versioned revision.

## Reliability and privacy

DPA uses atomic snapshots, append-only project events, bounded UI buffers, idempotent updates, corrupt-state isolation and crash diagnostics. Project data and GitHub credentials remain local; credentials are encrypted by the operating system where supported.

Do not commit `DSH_HOME`, `.credentials.yaml`, user project data, logs, caches, `node_modules`, build output or `.dpa-backups`. See [SECURITY.md](SECURITY.md) and [docs/PRIVACY.md](docs/PRIVACY.md).

## Status

DPA is an active developer preview. DeepSeek Harness is also evolving rapidly, so upstream compatibility can change between release candidates. The current DPA source version is `0.5.1`.

Current focus areas include DSH compatibility, safe updates, richer extension discovery, employee development, project governance, global appearance, and stability under long-running workloads.

## Requirements

- Windows 10/11 x64 for packaged desktop builds.
- Node.js 22+ and npm for development.
- A local [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) checkout or compatible runtime.
- Model credentials supplied through environment variables or a user-owned DSH credentials file.

## Development quick start

```powershell
npm install
$env:DSH_DESKTOP_HARNESS_DIR = 'C:\path\to\deepseek-harness'
$env:DSH_DESKTOP_DSH_HOME = "$env:LOCALAPPDATA\DeepSeek-PA\dsh-home"
$env:DSH_DESKTOP_DATA_DIR = "$env:LOCALAPPDATA\DeepSeek-PA\data"
npm start
```

Run the quality gates:

```powershell
npm run check
npm test
```

Create a packaged directory build:

```powershell
npm run sync:app-src
npm run dist:dir
```

Build output is ignored by Git. Installers and portable archives should be distributed through GitHub Releases.

## Architecture

DPA owns the desktop shell, module navigation, employee identities, cluster governance, project persistence, approval flow, appearance layer, extension discovery, update policy and recovery UX. DSH owns the underlying agent runtime, plugin composition, sessions and tools.

See [Architecture](docs/ARCHITECTURE.md), [Development guardrails](docs/DPA-DEVELOPMENT-GUARDRAILS.md) and [Update policy](docs/UPDATE_POLICY.md).

## Contributing

Bug reports, compatibility reports, design feedback, documentation improvements and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. For upstream DSH questions, use the official [DSH Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).

## License

DPA source code is available under the MIT License. DeepSeek Harness and third-party packages retain their own licenses; see [NOTICE.md](NOTICE.md).