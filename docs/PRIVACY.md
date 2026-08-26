# Privacy and Data Handling

DPA is local-first, but the application can call external model providers and GitHub APIs when the user enables those features.

## Never commit

- `DSH_HOME`, project files, employee profiles, sessions, logs, caches, or crash dumps;
- `.credentials.yaml`, API keys, OAuth tokens, or encrypted token stores;
- `dist`, `dist-staging`, `node_modules`, `.dpa-backups`, and machine-specific paths;
- screenshots containing project names, file paths, prompts, tokens, or personal information.

## Credentials

Use environment variables or a user-owned credentials file outside the repository. GitHub OAuth tokens are stored by the desktop app through Electron `safeStorage`; they are not part of the source export.

## Network behavior

The local DSH service is loopback-oriented. GitHub browsing is read-only until the user explicitly installs an extension/Skill or authorizes an operation. Model-provider traffic follows the provider configured by the user.

## Reporting

If you discover a credential leak or security issue, do not open a public issue containing the secret. Follow `SECURITY.md` and revoke the exposed credential first.