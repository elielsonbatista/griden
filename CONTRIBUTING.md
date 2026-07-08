# Contribuindo com o Griden

Obrigado pelo interesse em contribuir! 🎉

## Ambiente

Pré-requisitos:

- Node 20+ e [pnpm](https://pnpm.io) (`corepack enable`)
- Rust estável + cargo
- Dependências de sistema do Tauri: <https://tauri.app/start/prerequisites/>
  (no Ubuntu/Debian: `webkit2gtk-4.1`, `librsvg2-dev`, `build-essential`, etc.)

```bash
pnpm install
pnpm tauri dev
```

## Layout do projeto

- `src/` — frontend React (Vite + Tailwind + shadcn).
  - `components/` — UI por área (`connections`, `explorer`, `editor`, `results`, `erd`).
  - `stores/` — estado global (Zustand).
  - `lib/ipc.ts` — wrappers tipados sobre os comandos Tauri.
  - `types/` — tipos espelhando os structs Rust.
- `src-tauri/src/` — backend Rust.
  - `drivers/` — `AnyPool` + um arquivo por backend (pg/mysql/sqlite/mssql).
  - `introspection.rs` — metadados de schema e foreign keys por dialeto.
  - `edits.rs` — geração de SQL para edição inline.
  - `connection.rs` — gerenciador de conexões + keychain + túnel SSH.
  - `tunnel.rs` — túnel SSH (port-forwarding via russh) para conexões over SSH.
  - `commands/` — comandos `#[tauri::command]`.

## Antes de abrir um PR

```bash
pnpm lint            # tsc --noEmit
pnpm build           # build do frontend
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo test  --manifest-path src-tauri/Cargo.toml
```

Os testes do backend usam um banco SQLite de exemplo. Gere-o com:

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

## Adicionando suporte a um novo banco

1. Crie `src-tauri/src/drivers/<novo>.rs` com `connect` e `execute` (decode → `serde_json::Value`).
2. Adicione a variante em `AnyPool` (`drivers/mod.rs`) e em `DbKind` (`models.rs`).
3. Implemente as queries de introspecção em `introspection.rs`.
4. Trate o quoting de identificadores em `edits.rs`.
5. Adicione o tipo no frontend (`src/types/index.ts`, `DB_KINDS`).

## Licença

Ao contribuir, você concorda em licenciar sua contribuição sob os termos
MIT OR Apache-2.0 do projeto.
