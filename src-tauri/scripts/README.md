# macOS dev codesigning

Every `cargo build` produces a fresh unsigned binary; macOS derives an ad-hoc
identity from it on first run, so the Keychain "Always Allow" you grant for
saved connection passwords doesn't survive the next rebuild — you get
re-prompted every time.

`macos-dev-runner.sh` (wired up as the cargo `runner` for macOS in
`.cargo/config.toml`) signs `target/debug/griden` with a stable local
identity before running it, so the same identity is reused across rebuilds
and the Keychain stops re-prompting.

## One-time setup

Run `sh src-tauri/scripts/setup-dev-cert.sh` and approve the system trust
prompt it triggers (macOS requires that confirmation for any code-signing
identity; the script can't skip it). Done — `pnpm tauri dev` / `cargo run`
will sign with it automatically from now on.

Prefer doing it by hand? Open **Keychain Access** → menu **Keychain Access →
Certificate Assistant → Create a Certificate…**. Name: `Griden Dev` (or set
`GRIDEN_CODESIGN_IDENTITY` to whatever name you pick). Identity Type: **Self
Signed Root**. Certificate Type: **Code Signing**.

Without this certificate the runner just runs the binary unsigned, same as
today — nothing breaks if you skip this step.
