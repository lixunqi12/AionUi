# Codex Team Fork Notes

This fork is based on AionUi 2.1.8 and carries the local Codex Team integration
used by the portable Windows build.

## What Is Included

- AionUi 2.1.8 upstream baseline.
- Codex Team runtime inspector and Team workflow fixes.
- Mobile Web UI conversation fork fixes.
- Conversation-scoped MCP, structured agent error handling, and backend startup
  diagnostics from upstream 2.1.7/2.1.8 work.
- Codex `full-access` behavior through the bundled local AionCore build.

## Bundled AionCore

The Windows release asset includes a local AionCore build:

- Source branch: `lixun/full-access-v0.1.17`
- Source commit: `00b57c3596edc9bdf381f34beb2fc15d1a6b280f`
- Binary SHA256:
  `4F00FAD0542299846A2BA7A71F278ACFFC482C4B354A55FB025E8A01550FC55B`

When Codex `full-access` is selected, the runtime should write:

```toml
sandbox_mode = "danger-full-access"
approval_policy = "never"
```

## Download And Run

For another Windows x64 machine, use the GitHub release asset named like:

```text
AionUi-2.1.8-codex-team-win32-x64.zip
```

Unzip it and run:

```text
AionUi.exe
```

The source checkout is useful for rebuilding, but the release ZIP is the
directly runnable build.

## Validation

The portable build was smoke tested with:

- Real Codex Team E2E: leader called `aionui-team/team_members`, then
  `aionui-team/team_send_message`, and Worker replied
  `E2E-CODEX-WORKER-OK.`
- Real Solo Codex parity: Solo replied `E2E-CODEX-SOLO-OK`.
- `bunx tsc --noEmit`.
