import { Circle } from "lucide-react";
import { useConnections } from "@/stores/connections";

export function StatusBar() {
  const connections = useConnections((s) => s.connections);
  const connected = useConnections((s) => s.connected);
  const activeId = useConnections((s) => s.activeId);

  const active = connections.find((c) => c.id === activeId && connected.has(c.id));
  const onlineCount = connected.size;

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t bg-sidebar px-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <Circle
          className={
            active
              ? "h-2 w-2 fill-emerald-500 text-emerald-500"
              : "h-2 w-2 fill-muted-foreground/50 text-muted-foreground/50"
          }
        />
        <span>
          {active
            ? `${active.name}`
            : onlineCount > 0
              ? `${onlineCount} conexão(ões) ativa(s)`
              : "Desconectado"}
        </span>
      </div>
      <span className="font-medium">Griden</span>
    </div>
  );
}
