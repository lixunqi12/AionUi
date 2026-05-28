# AionCore Codex Full Access Approval Proposal

This proposal carries the AionCore-side patch needed to make AionUI Codex
`Full Access` match the Codex desktop app behavior.

Patch file:

- `proposals/aioncore/codex-full-access-approval.patch`

What it changes in AionCore:

- Writes `approval_policy = "never"` together with `sandbox_mode = "danger-full-access"`
  for Codex `full-access` and legacy yolo modes.
- Restores interactive approval policy for non-full-access modes.
- Lets running ACP Codex sessions auto-approve pending and future permission
  requests after switching to Full Access.
- Auto-removes already pending confirmation cards after the backend approves them.

Local validation performed:

- `cargo fmt`
- `cargo test -p aionui-ai-agent codex_config --lib`
- `cargo test -p aionui-ai-agent permission_router --lib`
- `cargo test -p aionui-ai-agent mode_normalize --lib`
- `cargo test -p aionui-conversation service_ops --lib`
- `cargo build --release -p aionui-app --bin aioncore`

Install note:

This patch belongs to AionCore, not the Electron frontend. Applying it to an
AionUI installation requires rebuilding `aioncore.exe` and replacing the bundled
binary alongside the frontend `app.asar`.
