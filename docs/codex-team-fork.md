# Codex Team Fork Notes

This fork is based on AionUi 2.1.7 and carries the local Codex Team integration
used by the portable Windows build.

## What Is Included

- AionUi 2.1.7 upstream baseline.
- Codex Team runtime inspector and Team workflow fixes.
- Mobile Web UI conversation fork fixes.
- Conversation-scoped MCP and structured agent error handling from upstream
  2.1.7 work.
- Codex `full-access` behavior through the bundled local AionCore build.

## Bundled AionCore

The Windows release asset includes a local AionCore build:

- Source branch: `lixun/full-access-v0.1.16`
- Source commit: `8f1db6d529bd9f5de3d7e8a24adcf3c402d83e2f`
- Binary SHA256:
  `0FE50FCEAC9C0C520F42FCE051568A55CD4EB645846C49B75540E64BB9ADCBD3`

When Codex `full-access` is selected, the runtime should write:

```toml
sandbox_mode = "danger-full-access"
approval_policy = "never"
```

## Download And Run

For another Windows x64 machine, use the GitHub release asset named like:

```text
AionUi-2.1.7-codex-team-win32-x64.zip
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
