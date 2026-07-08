# Griden

> Um cliente de banco de dados rápido e moderno — open-source, inspirado no DBeaver, com foco em UI/UX e performance.

Griden é construído com [Tauri](https://tauri.app) (backend nativo em Rust) e
[React](https://react.dev) + [Vite](https://vite.dev) + [Tailwind](https://tailwindcss.com) +
[shadcn/ui](https://ui.shadcn.com) no frontend. As queries são executadas no backend Rust,
mantendo as credenciais fora do webview.

## Funcionalidades (em desenvolvimento)

- 🔌 **Conexões** — PostgreSQL, MySQL/MariaDB, SQLite e MS SQL Server
- 🌳 **Schema browser** — navegação por bancos, schemas, tabelas, views e colunas
- ⌨️ **Editor SQL** — syntax highlight e autocomplete ciente do schema (CodeMirror 6)
- 📊 **Grid de resultados** — virtualizado, pronto para datasets grandes
- ✏️ **Edição inline** — editar células e gerar UPDATE/INSERT/DELETE transacional
- 🔗 **Diagramas ER** — visualização de relações por foreign keys
- 🔐 **Túnel SSH** — conexão via bastion/jump host (auth por senha ou chave privada)

## Stack

| Camada    | Tecnologia |
| --------- | ---------- |
| Shell     | Tauri v2 |
| Frontend  | React 19, Vite, TailwindCSS v4, shadcn/ui, Zustand |
| Editor    | CodeMirror 6 |
| Grid      | TanStack Table + TanStack Virtual |
| ER        | React Flow + elkjs |
| Backend   | Rust, sqlx (pg/mysql/sqlite), tiberius (mssql), russh (túnel SSH) |

## Desenvolvimento

Pré-requisitos: Node 20+, pnpm, Rust + cargo e as
[dependências de sistema do Tauri](https://tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm tauri dev      # roda o app em modo desenvolvimento
pnpm tauri build    # gera o bundle de produção
```

## Licença

Distribuído sob os termos da licença MIT **ou** Apache 2.0, a seu critério.
