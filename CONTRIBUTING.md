# Contributing to DPA

Thank you for helping improve DeepSeek-PA.

## Before opening an issue

- Search existing Issues and Discussions.
- Include DPA version, DSH version, Windows version and reproduction steps.
- Remove API keys, tokens, local paths and project data from logs and screenshots.

## Before opening a pull request

```powershell
npm install
npm run check
npm test
```

Keep public discussion separate from private reasoning, credentials and raw tool parameters. New persistence or long-running behavior should include malformed-input, cancellation, restart and high-load tests.

## Scope

DPA owns the desktop shell, cluster governance, employee profiles, project records, appearance and extension center. DSH runtime and plugin behavior should be reported upstream when the issue reproduces without DPA.