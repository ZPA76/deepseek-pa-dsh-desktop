# Public export manifest — DPA 0.6.0

This directory is the source repository for the DPA 0.6.0 developer preview. It is separate from local business data and desktop release assets.

## Included

- Application source and package manifests.
- Tests, build scripts, public development policies and CI configuration.
- English and Simplified Chinese READMEs, Windows installation instructions, public release notes and a bounded validation summary.
- License, third-party notices, contribution, support, security and privacy documentation.
- Five synthetic screenshots under `docs/images`: project room, employee center, project wizard, extension discovery and appearance settings.

## Excluded

DSH runtime checkouts, DSH home, credentials, employee/project data, personal conversations, logs, crash reports, local validation directories, repair packages, caches, `.dpa-backups`, generated `app-src`, `node_modules`, `dist`, and `dist-staging` are not part of the source export. Installers and portable archives belong to GitHub Releases.

## Screenshot provenance

The 0.6.0 gallery was rendered from deterministic synthetic project and employee fixtures. Discovery uses 75 simulated `demo-*` repositories to demonstrate pagination; it is not a captured live GitHub result. The appearance screenshot uses built-in themes. No personal account, production project, machine path, or credential is visible. The five PNGs contain no textual or EXIF metadata chunks.

Original local test logs and operational repair notes are intentionally not copied into this repository. [The public validation summary](docs/VALIDATION-v0.6.0.md) distinguishes synthetic UI checks from real network/runtime checks and records remaining limits.

Before pushing, review `git status` and the staged diff, scan for actual secrets and machine-specific paths, and follow [the upload guide](GITHUB_UPLOAD_GUIDE.md). Passing a text scan alone is not proof that an arbitrary new file is safe to publish.
