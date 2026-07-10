# Contributing to Griden

Thanks for your interest in contributing! 🎉

## Environment

Prerequisites:

- Node 20+ and [pnpm](https://pnpm.io) (`corepack enable`)
- Stable Rust + cargo
- Tauri system dependencies: <https://tauri.app/start/prerequisites/>
  (on Ubuntu/Debian: `webkit2gtk-4.1`, `librsvg2-dev`, `build-essential`, etc.)

```bash
pnpm install
pnpm tauri dev
```

## Project layout

- `src/` — React frontend (Vite + Tailwind + shadcn).
  - `components/` — UI by area (`connections`, `explorer`, `editor`, `results`, `erd`).
  - `stores/` — global state (Zustand).
  - `lib/ipc.ts` — typed wrappers over the Tauri commands.
  - `types/` — types mirroring the Rust structs.
- `src-tauri/src/` — Rust backend.
  - `drivers/` — `AnyPool` + one file per backend (pg/mysql/sqlite/mssql).
  - `introspection.rs` — schema metadata and foreign keys per dialect.
  - `edits.rs` — SQL generation for inline editing.
  - `connection.rs` — connection manager + keychain + SSH tunnel.
  - `tunnel.rs` — SSH tunnel (port-forwarding via russh) for connections over SSH.
  - `commands/` — `#[tauri::command]` commands.

## Before opening a PR

```bash
pnpm lint            # tsc --noEmit
pnpm build           # frontend build
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo test  --manifest-path src-tauri/Cargo.toml
```

The backend tests use a sample SQLite database. Generate it with:

```bash
python3 - <<'PY'
import sqlite3, os
os.makedirs(".dev", exist_ok=True)
c = sqlite3.connect(".dev/sample.db")
c.executescript("""
CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, born INTEGER);
CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT NOT NULL,
  author_id INTEGER REFERENCES authors(id), price REAL, published DATE);
INSERT INTO authors (name, born) VALUES ('Ada Lovelace', 1815), ('Alan Turing', 1912);
INSERT INTO books (title, author_id, price, published) VALUES
  ('Notes on the Analytical Engine', 1, 42.50, '1843-10-01'),
  ('Computing Machinery', 2, 19.99, '1950-10-01');
""")
c.commit(); c.close()
PY
```

## Adding support for a new database

1. Create `src-tauri/src/drivers/<new>.rs` with `connect` and `execute` (decode → `serde_json::Value`).
2. Add the variant to `AnyPool` (`drivers/mod.rs`) and to `DbKind` (`models.rs`).
3. Implement the introspection queries in `introspection.rs`.
4. Handle identifier quoting in `edits.rs`.
5. Add the type on the frontend (`src/types/index.ts`, `DB_KINDS`).

## License

By contributing, you agree to license your contribution under the project's
MIT OR Apache-2.0 terms.
