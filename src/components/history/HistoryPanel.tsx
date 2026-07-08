import { useEditor } from "@/stores/editor";
import { CheckCircle2, XCircle, History } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export function HistoryPanel() {
  const history = useEditor((s) => s.history);

  if (history.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <History className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">Histórico de queries</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          As queries executadas nesta sessão aparecerão aqui.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="divide-y">
        {history.map((h) => (
          <div key={h.id} className="flex items-start gap-2 px-4 py-2">
            {h.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            )}
            <div className="min-w-0 flex-1">
              <pre className="truncate font-mono text-xs">{h.sql}</pre>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {new Date(h.at).toLocaleTimeString()}
                {h.ok && ` · ${h.rows} linha(s) · ${h.elapsedMs} ms`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
