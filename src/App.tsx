import { ActivityBar } from "@/components/layout/ActivityBar";
import { StatusBar } from "@/components/layout/StatusBar";
import { ExplorerPanel } from "@/components/layout/ExplorerPanel";
import { Workspace } from "@/components/layout/Workspace";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState } from "react";

export type ActivityView = "connections" | "erd" | "history" | "settings";

function App() {
  const [view, setView] = useState<ActivityView>("connections");

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <div className="flex min-h-0 flex-1">
          <ActivityBar view={view} onChange={setView} />
          <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
            <ResizablePanel defaultSize="22%" minSize="14%" maxSize="40%">
              <ExplorerPanel view={view} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="78%" minSize="40%">
              <Workspace view={view} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        <StatusBar />
      </div>
    </TooltipProvider>
  );
}

export default App;
