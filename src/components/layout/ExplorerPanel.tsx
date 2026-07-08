import type { ActivityView } from "@/App";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Database, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useConnections } from "@/stores/connections";
import { ConnectionTree } from "@/components/explorer/ConnectionTree";
import { ConnectionDialog } from "@/components/connections/ConnectionDialog";
import type { ConnConfig } from "@/types";

const TITLES: Record<ActivityView, string> = {
  connections: "Conexões",
  erd: "Diagramas ER",
  history: "Histórico",
  settings: "Configurações",
};

export function ExplorerPanel({ view }: { view: ActivityView }) {
  const { connections, loaded, load } = useConnections();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ConnConfig | null>(null);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(c: ConnConfig) {
    setEditing(c);
    setDialogOpen(true);
  }

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-9 items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {TITLES[view]}
        </span>
        {view === "connections" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Nova conexão"
            onClick={openNew}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
      <ScrollArea className="flex-1 bg-sidebar">
        <div className="px-1.5 py-1">
          {view === "connections" ? (
            connections.length === 0 && loaded ? (
              <EmptyConnections onNew={openNew} />
            ) : (
              <ConnectionTree onEdit={openEdit} />
            )
          ) : (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">Em breve.</p>
          )}
        </div>
      </ScrollArea>

      <ConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </div>
  );
}

function EmptyConnections({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-muted-foreground">
        <Database className="h-5 w-5" />
      </div>
      <p className="text-sm text-muted-foreground">Nenhuma conexão ainda.</p>
      <Button size="sm" variant="secondary" onClick={onNew}>
        <Plus className="mr-1 h-4 w-4" /> Nova conexão
      </Button>
    </div>
  );
}
