# Update Policy

DPA follows a staged desktop update flow:

1. Run checks and tests.
2. Build into a temporary directory.
3. Verify the executable, app package, version and source/package timestamps.
4. Move the previous official build into a recoverable backup directory.
5. Replace the single official `dist/win-unpacked` entry and recreate shortcuts.
6. Publish a Git tag and GitHub Release with release notes and checksums.

User data, DSH profiles, employee records, projects and workspaces are not deleted by a desktop update. DSH itself remains an independently versioned dependency; each DPA Release must state the compatible DSH range.