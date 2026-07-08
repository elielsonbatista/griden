import { Fragment, useCallback, useState } from "react";
import { useConnections } from "@/stores/connections";
import { useEditor } from "@/stores/editor";
import { api, errMessage } from "@/lib/ipc";
import { defaultSelect } from "@/lib/query";
import { openTableTab } from "@/lib/tableTab";
import type { ColumnMeta, ConnConfig, SchemaInfo, TableInfo } from "@/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ChevronRight,
  Database,
  Table2,
  Eye,
  KeyRound,
  Columns3,
  Loader2,
  MoreHorizontal,
  Plug,
  PlugZap,
  Pencil,
  Trash2,
  Copy,
  RefreshCw,
  FileCode,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const KIND_LABEL: Record<ConnConfig["kind"], string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  mssql: "SQL Server",
};

/** Ação de menu reutilizada pelo dropdown (3 pontos) e pelo menu de contexto. */
interface Action {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
}

async function copyText(text: string, label = "Copiado para a área de transferência") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error("Não foi possível copiar");
  }
}

/** Renderiza uma lista de ações como itens de dropdown ou de menu de contexto. */
function MenuActions({
  actions,
  variant,
}: {
  actions: Action[];
  variant: "dropdown" | "context";
}) {
  return (
    <>
      {actions.map((a) => {
        const inner = (
          <>
            <a.icon className="mr-2 h-4 w-4" />
            {a.label}
          </>
        );
        const cls = cn(a.danger && "text-destructive focus:text-destructive");
        if (variant === "context") {
          return (
            <Fragment key={a.label}>
              {a.separatorBefore && <ContextMenuSeparator />}
              <ContextMenuItem onSelect={a.onSelect} className={cls}>
                {inner}
              </ContextMenuItem>
            </Fragment>
          );
        }
        return (
          <Fragment key={a.label}>
            {a.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={a.onSelect} className={cls}>
              {inner}
            </DropdownMenuItem>
          </Fragment>
        );
      })}
    </>
  );
}

/** Linha genérica da árvore com indentação, chevron, ícone e menu de contexto. */
function Row({
  depth,
  expandable,
  expanded,
  loading,
  icon,
  label,
  trailing,
  active,
  onClick,
  onLabelDoubleClick,
  onToggle,
  menu,
}: {
  depth: number;
  expandable?: boolean;
  expanded?: boolean;
  loading?: boolean;
  icon: React.ReactNode;
  label: React.ReactNode;
  trailing?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  /** Duplo clique no label (ex.: abrir dados da tabela). */
  onLabelDoubleClick?: () => void;
  /** Quando definido, só o chevron expande/colapsa (não a linha inteira). */
  onToggle?: () => void;
  menu?: Action[];
}) {
  const chevron = loading ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : expandable ? (
    <ChevronRight
      className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
    />
  ) : null;

  const row = (
    <div
      onClick={onClick}
      className={cn(
        "group/row flex h-7 items-center gap-1 rounded-sm pr-1 text-sm hover:bg-accent",
        onClick && "cursor-pointer",
        active && "bg-accent",
      )}
      style={{ paddingLeft: depth * 12 + 4 }}
    >
      {onToggle && expandable ? (
        <button
          aria-label={expanded ? "Colapsar" : "Expandir"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent-foreground/10"
        >
          {chevron}
        </button>
      ) : (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
          {chevron}
        </span>
      )}
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span
        className={cn("flex-1 truncate", onLabelDoubleClick && "cursor-pointer")}
        onDoubleClick={onLabelDoubleClick}
      >
        {label}
      </span>
      {trailing}
    </div>
  );

  if (!menu || menu.length === 0) return row;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <MenuActions actions={menu} variant="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ConnectionTree({ onEdit }: { onEdit: (c: ConnConfig) => void }) {
  const connections = useConnections((s) => s.connections);
  return (
    <div className="py-1">
      {connections.map((c) => (
        <ConnectionNode key={c.id} conn={c} onEdit={onEdit} />
      ))}
    </div>
  );
}

function ConnectionNode({
  conn,
  onEdit,
}: {
  conn: ConnConfig;
  onEdit: (c: ConnConfig) => void;
}) {
  const { connected, busy, connect, disconnect, remove, setActive, activeId } =
    useConnections();
  const isConnected = connected.has(conn.id);
  const isBusy = busy.has(conn.id);
  const [expanded, setExpanded] = useState(false);
  const [schemas, setSchemas] = useState<SchemaInfo[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadSchemas = useCallback(async () => {
    setLoading(true);
    try {
      setSchemas(await api.getSchemas(conn.id));
    } catch (e) {
      toast.error("Falha ao listar schemas", { description: errMessage(e) });
    } finally {
      setLoading(false);
    }
  }, [conn.id]);

  async function toggle() {
    setActive(conn.id);
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!isConnected) {
      await connect(conn.id);
      if (!useConnections.getState().connected.has(conn.id)) return; // falhou
    }
    setExpanded(true);
    if (schemas === null) await loadSchemas();
  }

  function disconnectAndCollapse() {
    setExpanded(false);
    setSchemas(null);
    disconnect(conn.id);
  }

  async function refresh() {
    if (!isConnected) {
      await connect(conn.id);
      if (!useConnections.getState().connected.has(conn.id)) return;
    }
    setExpanded(true);
    await loadSchemas();
  }

  // Mesmas ações no dropdown (3 pontos) e no menu de contexto (clique direito).
  const actions: Action[] = [
    isConnected
      ? { label: "Desconectar", icon: PlugZap, onSelect: disconnectAndCollapse }
      : { label: "Conectar", icon: Plug, onSelect: () => connect(conn.id) },
    ...(isConnected
      ? [
          {
            label: "Novo editor SQL",
            icon: FileCode,
            onSelect: () => useEditor.getState().openTab(conn.id, conn.name),
          },
          { label: "Atualizar", icon: RefreshCw, onSelect: refresh },
        ]
      : []),
    { label: "Copiar nome", icon: Copy, onSelect: () => copyText(conn.name) },
    { label: "Editar", icon: Pencil, onSelect: () => onEdit(conn), separatorBefore: true },
    {
      label: "Excluir",
      icon: Trash2,
      danger: true,
      onSelect: () => remove(conn.id),
    },
  ];

  return (
    <div>
      <Row
        depth={0}
        expandable
        expanded={expanded}
        loading={isBusy || loading}
        active={activeId === conn.id}
        icon={
          <Database
            className={cn("h-4 w-4", isConnected ? "text-primary" : "text-muted-foreground")}
          />
        }
        label={
          <span className="flex items-center gap-1.5">
            {conn.name}
            <span className="text-[10px] uppercase text-muted-foreground/60">
              {KIND_LABEL[conn.kind]}
            </span>
          </span>
        }
        onClick={toggle}
        menu={actions}
        trailing={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover/row:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <MenuActions actions={actions} variant="dropdown" />
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      {expanded &&
        schemas?.map((s) => (
          <SchemaNode key={s.name} conn={conn} schema={s.name} depth={1} />
        ))}
    </div>
  );
}

function SchemaNode({
  conn,
  schema,
  depth,
}: {
  conn: ConnConfig;
  schema: string;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTables(await api.getTables(conn.id, schema));
    } catch (e) {
      toast.error("Falha ao listar tabelas", { description: errMessage(e) });
    } finally {
      setLoading(false);
    }
  }, [conn.id, schema]);

  async function toggle() {
    if (expanded) return setExpanded(false);
    setExpanded(true);
    if (tables === null) await load();
  }

  const actions: Action[] = [
    {
      label: "Atualizar",
      icon: RefreshCw,
      onSelect: () => {
        setExpanded(true);
        load();
      },
    },
    {
      label: "Novo editor SQL",
      icon: FileCode,
      onSelect: () => useEditor.getState().openTab(conn.id, conn.name),
    },
    { label: "Copiar nome", icon: Copy, onSelect: () => copyText(schema) },
  ];

  return (
    <div>
      <Row
        depth={depth}
        expandable
        expanded={expanded}
        loading={loading}
        icon={<Columns3 className="h-4 w-4 text-muted-foreground" />}
        label={schema}
        onClick={toggle}
        menu={actions}
      />
      {expanded &&
        tables?.map((t) => (
          <TableNode key={t.name} conn={conn} schema={schema} table={t} depth={depth + 1} />
        ))}
      {expanded && tables?.length === 0 && (
        <EmptyHint depth={depth + 1} text="sem tabelas" />
      )}
    </div>
  );
}

function TableNode({
  conn,
  schema,
  table,
  depth,
}: {
  conn: ConnConfig;
  schema: string;
  table: TableInfo;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [columns, setColumns] = useState<ColumnMeta[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (expanded) return setExpanded(false);
    setExpanded(true);
    if (columns === null) {
      setLoading(true);
      try {
        setColumns(await api.getColumns(conn.id, schema, table.name));
      } catch (e) {
        toast.error("Falha ao listar colunas", { description: errMessage(e) });
      } finally {
        setLoading(false);
      }
    }
  }

  function openData() {
    void openTableTab({
      connId: conn.id,
      connName: conn.name,
      kind: conn.kind,
      schema,
      table: table.name,
    });
  }

  const actions: Action[] = [
    { label: "Abrir dados", icon: Table2, onSelect: openData },
    { label: "Copiar nome", icon: Copy, onSelect: () => copyText(table.name) },
    {
      label: "Copiar SELECT",
      icon: FileCode,
      onSelect: () => copyText(defaultSelect(conn.kind, schema, table.name)),
    },
  ];

  return (
    <div>
      <Row
        depth={depth}
        expandable
        expanded={expanded}
        loading={loading}
        icon={
          table.kind === "view" ? (
            <Eye className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Table2 className="h-4 w-4 text-sky-500/80" />
          )
        }
        label={table.name}
        onToggle={toggle}
        onLabelDoubleClick={openData}
        menu={actions}
      />
      {expanded &&
        columns?.map((col) => (
          <Row
            key={col.name}
            depth={depth + 1}
            icon={
              col.isPrimaryKey ? (
                <KeyRound className="h-3.5 w-3.5 text-amber-500" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
              )
            }
            label={
              <span className="flex items-center gap-2">
                <span className={cn(col.isPrimaryKey && "font-medium")}>{col.name}</span>
                <span className="text-xs text-muted-foreground">{col.dataType}</span>
                {!col.nullable && (
                  <span className="text-[10px] text-muted-foreground/60">NOT NULL</span>
                )}
              </span>
            }
            menu={[
              { label: "Copiar nome", icon: Copy, onSelect: () => copyText(col.name) },
            ]}
          />
        ))}
    </div>
  );
}

function EmptyHint({ depth, text }: { depth: number; text: string }) {
  return (
    <div
      className="flex h-6 items-center text-xs italic text-muted-foreground/60"
      style={{ paddingLeft: depth * 12 + 24 }}
    >
      {text}
    </div>
  );
}
