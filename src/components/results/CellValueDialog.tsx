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

/** Decide a representação inicial do valor e se é JSON (objeto/array). */
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
        /* não é JSON válido */
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
  /** Aplica a alteração pendente (sem rodar query). Para JSON, recebe já minificado. */
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
      toast.error("JSON inválido");
    }
  }

  function handleApply() {
    if (analyzed.isJson) {
      try {
        onApply(JSON.stringify(JSON.parse(text))); // minifica antes de aplicar
      } catch {
        toast.error("JSON inválido");
        return;
      }
    } else {
      onApply(text);
    }
    onOpenChange(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
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
            <Button variant="outline" onClick={copy}>
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
