# DPA 0.5.1

Developer-preview release prepared for public review.

## Included

- Cluster project room with public discussion separated from work logs and tool activity.
- Employee profiles, project appointments, Skill access policy and computer permission levels.
- Global themes, typography controls, image background and GitHub extension/Skill discovery.
- Bounded event buffers, atomic/fsync persistence, corrupt-snapshot quarantine, and local Electron crash diagnostics.

## Validation

- `npm run check`
- `npm test` — 41 tests passed in the local release build.
- Electron cluster bridge smoke test.
- Skill ACP smoke test.
- Packaged desktop startup/exit smoke test.

## Known limitations

- DSH is a rapidly changing developer preview; upstream compatibility can change.
- The packaged build is currently Windows-focused.
- Model providers and credentials must be configured by the user.
- DPA is unofficial and is not endorsed by DeepSeek AI.