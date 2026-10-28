# GRIDEN.md

This file is the project's living architecture doc and the memory for coding agents (similar to AGENTS.md / CLAUDE.md). Read it before making changes, and update it when a change invalidates something written here.

## Project

**Griden**: open-source, fast, modern database client inspired by DBeaver, focused on UI/UX and performance. Tauri 2 + Rust backend (sqlx for PostgreSQL/MySQL/SQLite, tiberius for SQL Server, russh for SSH tunnels), React 19 + TypeScript + Vite frontend.

- Bundle id: `dev.griden.app`
- Package manager: **pnpm**
- Platforms: macOS, Linux, Windows
- Frontend checks: `pnpm lint` (`tsc --noEmit`), `pnpm build`
- Rust checks: `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml`

## Quality bar

Production-grade or it does not ship. Every change is judged against all of these, not just "it works":

- **Correctness**: edge cases, failure modes, concurrent access, dropped connections, every supported dialect. No "works for now".
- **Performance**: a lightweight, fast client is the product. For every change ask: how much RAM it costs, whether it adds IPC round-trips or redundant queries against the database, whether it triggers extra re-renders (the results grid can be heavy), whether it pulls a heavy dependency. Heavy features load on demand and cost nothing until used.
- **Security**: credentials never leave the Rust side and never touch disk outside the OS keychain. Validate at every boundary (IPC, fs, network). Identifiers and literals built into SQL are always quoted/escaped per dialect.
- **UI/UX**: polished, professional, premium. Every state (loading, empty, error, cancelled, disconnected) and detail considered.
- **Architecture**: new or changed logic lives in pure, dependency-light functions (functional core); tauri commands and React components stay thin (imperative shell). Keeps it testable without a later rewrite.

Verify before claiming done: run every frontend and Rust check listed above. The Rust tests need the sample SQLite database at `.dev/sample.db` (generation script in `CONTRIBUTING.md`; CI generates it too).

A change to a core subsystem (connection lifecycle, reconnect/cancel, SQL generation for edits, introspection, keychain, SSH tunnel, IPC surface) needs a test that locks the invariant.

## Conventions

- **Comments**: default to none, the code should explain itself. If genuinely needed, 1-2 lines on *why*, never *what*. No AI-generic filler.
- **No em-dash** anywhere: code, comments, commits, docs.
- **No emojis** anywhere.
- **Language**: code, comments, docs, commits and PRs in English. User-facing strings (UI text, toasts, backend error messages) are currently Portuguese; leave them as they are until i18n lands, and do not translate them piecemeal.
- **Imports**: always `@/...` on the frontend, never relative across modules.
- **pnpm only**, never npm/npx/yarn.

## Architecture

### Two-process model

**Rust (`src-tauri/`)** owns all database, network, keychain and filesystem access. The webview never sees passwords and never talks to a database directly; everything goes through `invoke()` calls to commands registered in `src-tauri/src/lib.rs` and implemented as thin wrappers in `commands/mod.rs`:

- Connection configs: `list_connections`, `save_connection`, `delete_connection`, `test_connection`. Configs persist as JSON in `<app_config_dir>/connections.json` (`ConnConfig`, no secrets). `ConnInput` may carry passwords in plain text; they are moved to the keychain and never written to the config file.
- Live connections: `connect`, `disconnect`, `is_connected`.
- Execution: `run_query`, `cancel_query`, `apply_edits`.
- Introspection: `get_schemas`, `get_tables`, `get_columns`, `get_schema_columns`, `get_foreign_keys`.
- `save_file`: native "save as" dialog (`tauri-plugin-dialog`) that writes exported results. Downloading through an `<a>` element does not work in the webview.

Backend modules:

- `connection.rs`: `ConnectionManager` (Tauri managed state). Persists configs, reads/writes secrets in the OS keychain (service `dev.griden.app`; accounts `<id>`, `<id>#ssh-password`, `<id>#ssh-passphrase`), opens the optional SSH tunnel and keeps a registry of `LiveConnection`s.
- `drivers/`: `AnyPool` enum over each backend (`PgPool`, `MySqlPool`, `SqlitePool`, `Arc<Mutex<MssqlClient>>`) with per-variant dispatch, plus one file per backend with `connect` and `execute`. Every cell is decoded to `serde_json::Value`, keeping `QueryResult` free of static driver types.
- `introspection.rs`: schemas, tables/views, columns (with PK flag) and foreign keys, with one query set per dialect.
- `edits.rs`: SQL generation for inline editing (UPDATE/INSERT/DELETE) with per-dialect identifier quoting and literal escaping. Literals are inlined, not parameterized; acceptable for now, parameterization is a possible future step.
- `tunnel.rs`: SSH port forwarding via russh (password or private key auth). The tunnel is torn down on `Drop`.
- `error.rs`: `AppError`, serialized as a plain string across IPC. `is_connection_lost()` classifies dropped connections by message substring (sqlx has no dedicated variant).
- `models.rs`: serde types shared with the frontend, mirrored in `src/types/index.ts`. Keep both sides in sync (camelCase on the wire).

### Connection lifecycle

Each live connection holds **two pools** over the same (optional) SSH tunnel:

- `pool`: shared pool (10 connections, 5 for SQLite) used by introspection.
- `exec_pool`: a **single-connection** pool used by `run_query` and `apply_edits`. Statements run in sequence (Run all, or separate executions in the same tab) must share one database session, otherwise temporary tables, session variables and similar session-scoped state are lost. Do not raise `EXEC_POOL_SIZE`.

Reconnect:

- `AnyPool::execute`/`execute_tx` retry once on a stale pooled connection (a transaction that died before commit applied nothing, so the retry is safe).
- `with_reconnect` / `with_reconnect_exec` in `commands/mod.rs` do a full `reconnect` (disconnect + connect) when the error is still a lost connection, because a dead SSH tunnel or MSSQL's single client does not self-heal. A second failure surfaces a generic "Connection lost".
- Pools use `test_before_acquire(false)` (avoids a round-trip per query over SSH) with `max_lifetime`/`idle_timeout` recycling; the retry covers what slips through. Connecting first runs a single probe connection with a 10 s timeout so an unreachable host fails fast instead of waiting for the pool's acquire timeout.

Cancellation:

- On connect, `exec_session_id` is captured from the exec connection (`pg_backend_pid()`, `connection_id()` decoded as `u64`, `@@SPID`). `cancel_exec` issues the cancel through the **shared** pool, since the exec connection is busy running the statement.
- PostgreSQL uses `pg_cancel_backend`, MySQL `KILL QUERY`, SQL Server `KILL` (ends the whole session; the reconnect path reopens it). SQLite has no cancel; the Stop button is hidden for it.
- `cancel_exec` sets a `cancelled` flag that `with_reconnect_exec` checks **before** `is_connection_lost()`, so a user cancel that surfaces as a dropped connection becomes `AppError::Cancelled` and is never retried. The flag is cleared before each execution so a stale cancel cannot misfire.

### Frontend (`src/`)

Single-window React app. Path alias `@/*` -> `src/*`. `App.tsx` is a coordinator (activity bar, explorer panel, workspace, status bar); keep it thin and put features in their area.

- `components/<area>/`: UI by area.
  - `connections/`: `ConnectionDialog` (create/edit/test, SSH settings).
  - `explorer/`: `ConnectionTree` (connections, schemas, tables/views, columns; context actions).
  - `editor/`: `SqlEditor` on CodeMirror 6 with schema-aware autocomplete. Run statement at cursor/selection, Run all.
  - `results/`: `ResultsGrid` (TanStack Virtual, inline edit/insert/delete with a pending changeset, context menu, FK navigation), `FilterBar`, `CellValueDialog` (long values / JSON).
  - `erd/`: React Flow + elkjs diagram. Lazy-loaded from `Workspace.tsx`; never import it eagerly.
  - `history/`, `layout/` (`ActivityBar`, `ExplorerPanel`, `Workspace`, `StatusBar`).
  - `ui/`: shadcn primitives.
- `stores/` (Zustand):
  - `connections.ts`: configs, connected ids, active id, busy ids.
  - `editor.ts`: tabs, active tab, history, `run`/`runAll`/`cancel`. Persisted to `localStorage` (`griden-editor`): tab definitions and history only, never `result`/`error`/`running`. On restore, `idSeq`/`queryTitleSeq` are bumped past the highest restored numbers so new tabs do not collide.
- `lib/`: pure helpers. `ipc.ts` (typed `invoke` wrappers + `errMessage`), `query.ts` (quoting, literals, filter query builder, default `SELECT ... LIMIT/TOP 100`, `relatedTarget` for FK navigation), `edits.ts` (grid changeset: pending cell edits, `buildRowEdits` for `apply_edits`), `sqlStatements.ts` (dialect-aware statement splitting), `tableTab.ts` (opens a table data view with PK and FKs loaded), `export.ts` (CSV/TSV/JSON/Markdown + `EXPORT_FORMATS`), `clipboard.ts` (`copyText` with toasts), `format.ts`, `platform.ts` (OS-aware shortcut labels).
- Feature-local pure logic lives next to its feature, e.g. `components/erd/graph.ts` (nodes, edges and elk input for the ERD).
- `types/index.ts`: TS mirror of `models.rs` plus `DB_KINDS`.

Tabs: a query tab shows `EditorPane` + `ResultArea`; a tab with `source` (opened from a table) shows `FilterBar` + grid, with a toggle to SQL mode. Use granular store selectors (see `ResultArea`) so editor keystrokes never re-render the grid.

Grid column widths live per tab (`QueryTab.columnWidths`, persisted, pure helpers in `lib/columnWidths.ts`). Cells read their width from CSS variables (`--col-N`, `--grid-width`) on the grid container; a drag writes only those variables and commits to the store on release. Do not turn the drag into React state: it would re-render every visible cell per pointer move.

### UI conventions

- **shadcn/ui** is configured (`components.json`, style `new-york`, base `neutral`, icon lib **lucide**). Primitives in `src/components/ui/`: don't hand-edit; re-run `pnpm dlx shadcn add` to upgrade. Composition wrappers belong in the feature area.
- **Tailwind v4**: no `tailwind.config.*`, config and theme tokens live in `src/index.css`. Use `cn()` from `@/lib/utils`.
- Theme: dark by default (`main.tsx` adds the `dark` class).
- Resizable layout: `react-resizable-panels`. Toasts: `sonner`; error toasts use `duration: Infinity` so the user can read and copy them.
- The webview's native context menu is blocked globally in `main.tsx`; app context menus are Radix.
- Heavy dependencies load lazily (`React.lazy` + dynamic `import()`), as the ERD does.

### Window styling

- Linux: on Wayland, tao draws its own `GtkHeaderBar` with a fixed button layout. `lib.rs` mirrors GNOME's `org.gnome.desktop.wm.preferences button-layout` onto it at setup. On X11 there is no HeaderBar and this is a no-op.
- macOS/Windows: native decorations, untouched.

### Tauri capabilities

`src-tauri/capabilities/default.json` is the allowlist for plugin APIs available to the webview (currently `core:default`, `opener:default`). Plugins used only from Rust (the dialog in `save_file`) need no webview permission. New plugins typically need:
1. `Cargo.toml` dependency
2. `.plugin(...)` call in `lib.rs` `run()`
3. capability entry in `default.json`, if the webview calls it directly

### Adding a database

1. `src-tauri/src/drivers/<new>.rs` with `connect` and `execute` (decode to `serde_json::Value`).
2. Variant in `AnyPool` (`drivers/mod.rs`, including `ping`, `execute_tx`, `session_id`, `cancel_session`, `close`) and in `DbKind` (`models.rs`).
3. Introspection queries in `introspection.rs`.
4. Identifier quoting and literals in `edits.rs` and `src/lib/query.ts`.
5. Default port in `connection.rs`, `DB_KINDS` and the type in `src/types/index.ts`, statement splitting rules in `sqlStatements.ts`.

### Cross-platform conventions

- Platform-specific Rust lives behind `#[cfg(target_os = "...")]`; keychain backends are per target in `Cargo.toml` (`sync-secret-service` on Linux, `apple-native`, `windows-native`).
- Keyboard shortcuts: `metaKey || ctrlKey`; labels come from `lib/platform.ts` (`shortcutLabel`).

### Known gotchas

- **Ctrl+W on Linux**: WebKitGTK consumes it before JS sees it. `lib.rs` intercepts it at the GTK window and emits `close-tab`, which `Workspace.tsx` listens to. The JS keydown handler covers macOS/Windows. Keep both paths.
- **SQL Server is a single client** behind a `Mutex`; it has no pool, so both `pool` and `exec_pool` are separate clients. `KILL` drops the session, which the reconnect path must handle.
- **MySQL `CONNECTION_ID()`** is `BIGINT UNSIGNED`; decode as `u64`. Decoding as `i64` fails silently and disables cancellation.
- **PostgreSQL TLS**: SSL unchecked means `PgSslMode::Disable` (not `Prefer`), otherwise plaintext servers behind an SSH tunnel fail with `HandshakeFailure`. `error.rs` appends a hint for that message.
- **React 19 strict mode** double-mounts `useEffect` in dev; effects must be idempotent and clean up (listeners, `listen()` unsubscribes).
- **macOS dev keychain prompts**: unsigned dev builds get a new identity per build. `src-tauri/scripts/` signs dev builds with a stable local identity (see its README).
