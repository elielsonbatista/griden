# Contributing to Griden

Thanks for your interest in contributing!

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

## Architecture and conventions

Read [`GRIDEN.md`](GRIDEN.md) before making changes. It is the living architecture doc:
project layout, connection lifecycle, coding conventions, the quality bar and known gotchas.

## Before opening a PR

```bash
pnpm lint            # tsc --noEmit
pnpm build           # frontend build
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
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

See "Adding a database" in [`GRIDEN.md`](GRIDEN.md).

## License

By contributing, you agree to license your contribution under the project's
MIT OR Apache-2.0 terms.
