# Griden

> A fast, modern database client — open-source, inspired by DBeaver, with a focus on UI/UX and performance.

Griden is built with [Tauri](https://tauri.app) (native Rust backend) and
[React](https://react.dev) + [Vite](https://vite.dev) + [Tailwind](https://tailwindcss.com) +
[shadcn/ui](https://ui.shadcn.com) on the frontend. Queries run on the Rust backend,
keeping credentials out of the webview.

## Features (in development)

- 🔌 **Connections** — PostgreSQL, MySQL/MariaDB, SQLite, and MS SQL Server
- 🌳 **Schema browser** — browse databases, schemas, tables, views, and columns
- ⌨️ **SQL editor** — syntax highlighting and schema-aware autocomplete (CodeMirror 6)
- 📊 **Results grid** — virtualized, ready for large datasets
- ✏️ **Inline editing** — edit cells and generate transactional UPDATE/INSERT/DELETE
- 🔗 **ER diagrams** — visualize relationships through foreign keys
- 🔐 **SSH tunnel** — connect through a bastion/jump host (password or private-key auth)

## Stack

| Layer     | Technology |
| --------- | ---------- |
| Shell     | Tauri v2 |
| Frontend  | React 19, Vite, TailwindCSS v4, shadcn/ui, Zustand |
| Editor    | CodeMirror 6 |
| Grid      | TanStack Table + TanStack Virtual |
| ER        | React Flow + elkjs |
| Backend   | Rust, sqlx (pg/mysql/sqlite), tiberius (mssql), russh (SSH tunnel) |

## Development

Prerequisites: Node 20+, pnpm, Rust + cargo, and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm tauri dev      # run the app in development mode
pnpm tauri build    # build the production bundle
```

## License

Distributed under the terms of the MIT **or** Apache 2.0 license, at your option.
