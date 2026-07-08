import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Database, Network, History, Settings, Grid3x3 } from "lucide-react";
import type { ActivityView } from "@/App";

const ITEMS: { id: ActivityView; label: string; icon: typeof Database }[] = [
  { id: "connections", label: "Conexões", icon: Database },
  { id: "erd", label: "Diagramas ER", icon: Network },
  { id: "history", label: "Histórico", icon: History },
];

export function ActivityBar({
  view,
  onChange,
}: {
  view: ActivityView;
  onChange: (v: ActivityView) => void;
}) {
  return (
    <div className="flex w-12 flex-col items-center border-r bg-sidebar py-2">
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-md text-primary">
        <Grid3x3 className="h-5 w-5" />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        {ITEMS.map((item) => (
          <ActivityButton
            key={item.id}
            active={view === item.id}
            label={item.label}
            icon={item.icon}
            onClick={() => onChange(item.id)}
          />
        ))}
      </div>
      <ActivityButton
        active={view === "settings"}
        label="Configurações"
        icon={Settings}
        onClick={() => onChange("settings")}
      />
    </div>
  );
}

function ActivityButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: typeof Database;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={label}
          className={cn(
            "relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            active && "bg-accent text-foreground",
          )}
        >
          {active && (
            <span className="absolute left-[-6px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
          )}
          <Icon className="h-5 w-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
