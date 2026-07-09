import type { ActivityView } from "@/App";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Grid3x3,
  Play,
  Plus,
  X,
  Loader2,
  FileCode,
  Download,
  ChevronDown,
  Filter,
  Copy,
} from "lucide-react";
import { toCsv, toJson, toTsv, toMarkdown } from "@/lib/export";
import { FilterBar, emptyFilterRow, type FilterRow } from "@/components/results/FilterBar";
import { buildTableQuery, type FilterCondition } from "@/lib/query";
import { listen } from "@tauri-apps/api/event";
import { api, errMessage } from "@/lib/ipc";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Cell, QueryResult } from "@/types";
import { openTableTab } from "@/lib/tableTab";
import { shortcutLabel } from "@/lib/platform";

const DOWNLOAD_FORMATS: {
  label: string;
  ext: string;
  build: (r: QueryResult) => string;
}[] = [
  { label: "CSV", ext: "csv", build: toCsv },
  { label: "JSON", ext: "json", build: toJson },
  { label: "TSV", ext: "tsv", build: toTsv },
  { label: "Markdown", ext: "md", build: toMarkdown },
];
import { useConnections } from "@/stores/connections";
import { useEditor } from "@/stores/editor";
import { SqlEditor, type SqlEditorHandle } from "@/components/editor/SqlEditor";
import { ResultsGrid } from "@/components/results/ResultsGrid";
import { HistoryPanel } from "@/components/history/HistoryPanel";
import { lazy, Suspense, memo, useMemo, useEffect, useRef, useState } from "react";

// ERD carrega react-flow + elkjs (pesados) só quando aberto.
const ErdView = lazy(() =>
  import("@/components/erd/ErdView").then((m) => ({ default: m.ErdView })),
);
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DbKind } from "@/types";

export function Workspace({ view }: { view: ActivityView }) {
  if (view === "erd") {
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Carregando diagrama…
          </div>
        }
      >
        <ErdView />
      </Suspense>
    );
  }
  if (view === "settings") {
    return <Placeholder title="Configurações" subtitle="Em breve." />;
  }
  if (view === "history") {
    return <HistoryPanel />;
  }
  return <EditorWorkspace />;
}

function EditorWorkspace() {
  const connections = useConnections((s) => s.connections);
  const connected = useConnections((s) => s.connected);
  const activeConnId = useConnections((s) => s.activeId);
  const { tabs, activeTabId, openTab, closeTab, setActiveTab, moveTab } = useEditor();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const connKind = (id: string): DbKind =>
    connections.find((c) => c.id === id)?.kind ?? "postgres";

  function newTab() {
    if (!activeConnId) return;
    const c = connections.find((x) => x.id === activeConnId);
    if (c) openTab(c.id, c.name);
  }

  const canOpen = !!activeConnId && connected.has(activeConnId);

  // Ctrl+W (Cmd+W no macOS) fecha a aba ativa, como nos navegadores.
  // Em fase de captura para rodar antes do CodeMirror/inputs poderem consumir o evento.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        const { activeTabId: id, closeTab: close } = useEditor.getState();
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          close(id);
        }
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // No Linux o WebKitGTK consome Ctrl+W antes do JS; o backend intercepta e
  // emite "close-tab". (Em mac/Windows o listener de teclado acima já resolve.)
  useEffect(() => {
    const unlisten = listen("close-tab", () => {
      const { activeTabId: id, closeTab: close } = useEditor.getState();
      if (id) close(id);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex h-9 items-center border-b bg-sidebar">
        <div className="flex h-full flex-1 items-stretch overflow-x-auto">
          {tabs.map((t) => (
            <div
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              // Clique do meio (scroll button) fecha a aba, como nos navegadores.
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault(); // evita o autoscroll do meio
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(t.id);
                }
              }}
              // Arrastar para reordenar as abas (como nos navegadores).
              draggable
              onDragStart={(e) => {
                setDraggingId(t.id);
                e.dataTransfer.effectAllowed = "move";
                // Necessário para o webkit (webview do Tauri) tratar o drag como
                // válido e disparar dragenter/dragover/drop.
                e.dataTransfer.setData("text/plain", t.id);
              }}
              onDragEnter={() => {
                if (draggingId && draggingId !== t.id) moveTab(draggingId, t.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const dragged = draggingId ?? e.dataTransfer.getData("text/plain");
                if (dragged && dragged !== t.id) moveTab(dragged, t.id);
                setDraggingId(null);
              }}
              onDragEnd={() => setDraggingId(null)}
              className={cn(
                "group/tab flex h-full min-w-0 cursor-pointer items-center gap-2 border-r px-3 text-sm",
                t.id === activeTabId
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-accent/50",
                draggingId === t.id && "opacity-50",
              )}
            >
              <FileCode className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[140px] truncate">{t.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                className="opacity-0 group-hover/tab:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="mx-1 h-7 w-7"
          disabled={!canOpen}
          title={canOpen ? "Nova query" : "Conecte-se a um banco"}
          onClick={newTab}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {activeTab ? (
        <TabContent
          key={activeTab.id}
          tabId={activeTab.id}
          kind={connKind(activeTab.connId)}
        />
      ) : (
        <Placeholder
          title="Editor SQL"
          subtitle={
            canOpen
              ? "Clique em + para abrir uma query, ou dê duplo-clique numa tabela."
              : "Conecte-se a um banco no painel à esquerda para começar."
          }
        />
      )}
    </div>
  );
}

function TabContent({ tabId, kind }: { tabId: string; kind: DbKind }) {
  const isTable = useEditor((s) => !!s.tabs.find((t) => t.id === tabId)?.source);
  if (isTable) return <TableTabContent tabId={tabId} kind={kind} />;

  return (
    <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
      <ResizablePanel defaultSize="30%" minSize="15%">
        <EditorPane tabId={tabId} kind={kind} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="70%" minSize="15%">
        <ResultArea tabId={tabId} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/** Barra "Executar" + editor SQL. `leading` permite injetar um botão à esquerda. */
function EditorPane({
  tabId,
  kind,
  leading,
}: {
  tabId: string;
  kind: DbKind;
  leading?: React.ReactNode;
}) {
  const sql = useEditor((s) => s.tabs.find((t) => t.id === tabId)?.sql ?? "");
  const running = useEditor((s) => s.tabs.find((t) => t.id === tabId)?.running ?? false);
  const connId = useEditor((s) => s.tabs.find((t) => t.id === tabId)?.connId ?? "");
  const connName = useEditor((s) => s.tabs.find((t) => t.id === tabId)?.connName ?? "");
  const setSql = useEditor((s) => s.setSql);
  const run = useEditor((s) => s.run);
  const runAll = useEditor((s) => s.runAll);
  const sqlEditorRef = useRef<SqlEditorHandle>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        {leading}
        <div className="flex h-7 items-stretch">
          <Button
            size="sm"
            className="h-7 gap-1 rounded-r-none"
            disabled={running || !sql.trim()}
            onClick={() => sqlEditorRef.current?.runCurrent()}
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Executar
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                className="h-7 w-6 rounded-l-none border-l px-0"
                disabled={running || !sql.trim()}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => sqlEditorRef.current?.runAll()}>
                Executar tudo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <span className="text-xs text-muted-foreground">
          {connName} · {shortcutLabel("Enter")} · {shortcutLabel("Shift", "Enter")} (Executar tudo)
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <SqlEditor
          ref={sqlEditorRef}
          connId={connId}
          kind={kind}
          value={sql}
          onChange={(v) => setSql(tabId, v)}
          onRun={(stmt) => run(tabId, stmt)}
          onRunAll={() => runAll(tabId)}
        />
      </div>
    </div>
  );
}

/** Aba aberta a partir de uma tabela: barra de filtros + grid (com toggle p/ SQL). */
function TableTabContent({ tabId, kind }: { tabId: string; kind: DbKind }) {
  const [mode, setMode] = useState<"filter" | "sql">("filter");
  // Condições mantidas aqui (não na FilterBar) para sobreviverem ao toggle SQL.
  const [filterRows, setFilterRows] = useState<FilterRow[]>(() => {
    const init = useEditor.getState().tabs.find((t) => t.id === tabId)?.initialFilters;
    return init && init.length
      ? init.map((c) => ({ ...emptyFilterRow(), ...c }))
      : [emptyFilterRow()];
  });
  const source = useEditor((s) => s.tabs.find((t) => t.id === tabId)?.source);
  const result = useEditor((s) => s.tabs.find((t) => t.id === tabId)?.result ?? null);
  const setSql = useEditor((s) => s.setSql);
  const run = useEditor((s) => s.run);

  const columns = useMemo(() => result?.columns.map((c) => c.name) ?? [], [result]);

  function applyFilter() {
    if (!source) return;
    const conditions = filterRows.map(({ column, op, value }) => ({ column, op, value }));
    setSql(tabId, buildTableQuery(kind, source.schema, source.table, conditions));
    run(tabId);
  }

  if (mode === "sql") {
    return (
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="30%" minSize="15%">
          <EditorPane
            tabId={tabId}
            kind={kind}
            leading={
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Voltar aos filtros"
                onClick={() => setMode("filter")}
              >
                <Filter className="h-4 w-4" />
              </Button>
            }
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="70%" minSize="15%">
          <ResultArea tabId={tabId} />
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterBar
        columns={columns}
        rows={filterRows}
        setRows={setFilterRows}
        onApply={applyFilter}
        onToggleSql={() => setMode("sql")}
      />
      <div className="min-h-0 flex-1">
        <ResultArea tabId={tabId} />
      </div>
    </div>
  );
}

// Memoizado e com seletores granulares: re-renderiza só quando o RESULTADO muda,
// não a cada tecla digitada no editor (o grid pode ser pesado).
const ResultArea = memo(function ResultArea({ tabId }: { tabId: string }) {
  const result = useEditor((s) => s.tabs.find((t) => t.id === tabId)?.result ?? null);
  const error = useEditor((s) => s.tabs.find((t) => t.id === tabId)?.error ?? null);
  const editableSrc = useEditor((s) => s.tabs.find((t) => t.id === tabId)?.editable);
  const connId = useEditor((s) => s.tabs.find((t) => t.id === tabId)?.connId ?? "");
  const connName = useEditor((s) => s.tabs.find((t) => t.id === tabId)?.connName ?? "");
  const title = useEditor((s) => s.tabs.find((t) => t.id === tabId)?.title ?? "query");
  const foreignKeys = useEditor((s) => s.tabs.find((t) => t.id === tabId)?.foreignKeys);
  const run = useEditor((s) => s.run);
  const kind = useConnections(
    (s) => s.connections.find((c) => c.id === connId)?.kind ?? "postgres",
  );

  const hasGrid = !!result && result.columns.length > 0;
  const editable = useMemo(
    () => (editableSrc && hasGrid ? { connId, ...editableSrc } : undefined),
    [editableSrc, connId, hasGrid],
  );

  // Abre os registros referenciados por uma FK como data view (barra de filtros),
  // com a(s) condição(ões) da FK já pré-aplicada(s).
  const onOpenRelated = useMemo(
    () =>
      (target: {
        schema: string;
        table: string;
        conditions: { col: string; value: Cell }[];
      }) => {
        const filters: FilterCondition[] = target.conditions.map((c) =>
          c.value === null
            ? { column: c.col, op: "isnull", value: "" }
            : { column: c.col, op: "=", value: String(c.value) },
        );
        void openTableTab({
          connId,
          connName,
          kind,
          schema: target.schema,
          table: target.table,
          filters,
        });
      },
    [kind, connId, connName],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between border-b px-3 text-xs text-muted-foreground">
        <span>Resultados</span>
        <div className="flex items-center gap-3">
          {hasGrid && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1 hover:text-foreground"
                  title="Baixar resultado"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {DOWNLOAD_FORMATS.map((fmt) => (
                  <DropdownMenuItem
                    key={fmt.ext}
                    onSelect={async () => {
                      try {
                        const saved = await api.saveFile(
                          `${title}.${fmt.ext}`,
                          fmt.build(result!),
                        );
                        if (saved) toast.success(`Exportado (${fmt.label})`);
                      } catch (e) {
                        toast.error("Falha ao exportar", { description: errMessage(e) });
                      }
                    }}
                  >
                    {fmt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {result && (
            <span className="tabular-nums">
              {result.columns.length > 0
                ? `${result.rows.length} linha(s)`
                : `${result.rowsAffected} afetada(s)`}{" "}
              · {result.elapsedMs} ms
            </span>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="relative m-3 overflow-auto rounded-md bg-destructive/10 p-3 pr-9 text-xs text-destructive">
            <button
              className="absolute top-2 right-2 text-destructive/70 hover:text-destructive"
              title="Copiar erro"
              onClick={async () => {
                await navigator.clipboard.writeText(error);
                toast.success("Erro copiado");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <pre className="break-words whitespace-pre-wrap">{error}</pre>
          </div>
        ) : hasGrid ? (
          <ResultsGrid
            result={result!}
            editable={editable}
            onSaved={() => run(tabId)}
            foreignKeys={foreignKeys}
            onOpenRelated={onOpenRelated}
          />
        ) : result ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Comando executado — {result.rowsAffected} linha(s) afetada(s).
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Execute uma query para ver os dados.
          </div>
        )}
      </div>
    </div>
  );
});

function Placeholder({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <Grid3x3 className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
