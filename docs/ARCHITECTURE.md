# DPA Architecture

## Boundary with DeepSeek Harness

```text
DPA desktop shell
  ├─ window/tray/startup/update lifecycle
  ├─ appearance and extension center
  ├─ employee profiles and training records
  ├─ cluster governance and user approval gates
  ├─ project/event persistence
  └─ public discussion + work-log presentation
        │
        ▼
DeepSeek Harness (DSH)
  ├─ agent loop and model adapters
  ├─ Cordis plugin composition
  ├─ sessions, files, Shell, Skill and other tools
  └─ local web service/profile
```

DPA is an independent desktop companion. It does not modify the upstream DSH repository. The path to a local DSH checkout is configured with `DSH_DESKTOP_HARNESS_DIR`.

## Cluster event channels

- `room`: user messages and employee discussion intended for project participants.
- `worklog`: tasks, tool calls, Skill calls, permission decisions, telemetry and execution summaries.
- `activity`: progress and diagnostic status.
- `control`: approvals, artifacts, decisions and membership changes.
- `system`/`private`: internal lifecycle or owner-only records.

The UI renders `room` in the chat feed and keeps the other channels in the project workbench. It does not present hidden model reasoning as a user-facing transcript.

## Storage

Each project has a JSON snapshot plus an append-only `events.jsonl`. Snapshots are written through a temporary file and rename; snapshot and event writes are synchronized before completion. Malformed JSON snapshots are quarantined as `.corrupt-*` files, while malformed event lines are skipped so the remaining history can be recovered.

## Extension and Skill discovery

The extension center can browse GitHub anonymously or with a user-authorized token. Installation is a separate, explicit operation. Skill discovery is scoped to the project workspace and user-owned Skill roots; permissions and tool activity remain visible in the workbench rather than the public chat.