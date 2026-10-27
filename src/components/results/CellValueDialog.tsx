import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { json } from "@codemirror/lang-json";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatCell } from "@/lib/format";
import { copyText } from "@/lib/clipboard";
import type { Cell } from "@/types";

const BASIC_SETUP = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: true,
  bracketMatching: true,
  autocompletion: false,
};

const editorTheme = EditorView.theme({
  "&": { fontSize: "12px", backgroundColor: "transparent" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  "&.cm-focused": { outline: "none" },
});

/** Strings holding a JSON object or array are treated as JSON too. */
function analyze(value: Cell): { text: string; isJson: boolean } {
  if (value !== null && typeof value === "object") {
    return { text: JSON.stringify(value, null, 2), isJson: true };
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object") {
          return { text: JSON.stringify(parsed, null, 2), isJson: true };
        }
      } catch {
        // Looked like JSON but is not; show it as plain text.
      }
    }
    return { text: value, isJson: false };
  }
  return { text: formatCell(value), isJson: false };
}

export function CellValueDialog({
  open,
  onOpenChange,
  column,
  value,
  editable,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  column: string;
  value: Cell;
  editable: boolean;
  /** Stages the change without running a query. JSON arrives minified. */
  onApply: (next: string) => void;
}) {
  const analyzed = useMemo(() => analyze(value), [value]);
  const [text, setText] = useState(analyzed.text);

  useEffect(() => {
    if (open) setText(analyzed.text);
  }, [open, analyzed.text]);

  const extensions = useMemo(
    () => [editorTheme, EditorView.lineWrapping, ...(analyzed.isJson ? [json()] : [])],
    [analyzed.isJson],
  );

  function handleFormat() {
    try {
      setText(JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      toast.error("JSON inválido", { duration: Infinity });
    }
  }

  function handleApply() {
    if (analyzed.isJson) {
      try {
        onApply(JSON.stringify(JSON.parse(text)));
      } catch {
        toast.error("JSON inválido", { duration: Infinity });
        return;
      }
    } else {
      onApply(text);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-sm">
            {column}
            {analyzed.isJson && (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                JSON
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="h-[55vh] overflow-hidden rounded-md border bg-muted/30">
          <CodeMirror
            value={text}
            onChange={setText}
            theme="dark"
            editable={editable}
            readOnly={!editable}
            extensions={extensions}
            basicSetup={BASIC_SETUP}
            height="55vh"
            className="h-full text-xs"
          />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => copyText(text)}>
              Copiar
            </Button>
            {analyzed.isJson && (
              <Button variant="outline" onClick={handleFormat}>
                Formatar
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            {editable && (
              <Button onClick={handleApply}>
                Aplicar{analyzed.isJson ? " (minificar)" : ""}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
