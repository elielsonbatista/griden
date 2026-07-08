import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { keymap, EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sqlExtension, buildSchemaMap } from "@/lib/sql";
import type { DbKind } from "@/types";

const baseTheme = EditorView.theme({
  "&": { fontSize: "13px", height: "100%", backgroundColor: "transparent" },
  ".cm-scroller": {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none" },
});

// Referência ESTÁVEL: o @uiw/react-codemirror reconfigura todas as extensões
// quando `basicSetup` (ou `onChange`) mudam de referência. Mantê-los estáveis
// evita reconstruir o editor (e a extensão SQL) a cada tecla digitada.
const BASIC_SETUP = {
  lineNumbers: true,
  foldGutter: false,
  highlightActiveLine: true,
  autocompletion: true,
  bracketMatching: true,
};

export function SqlEditor({
  connId,
  kind,
  value,
  onChange,
  onRun,
}: {
  connId: string;
  kind: DbKind;
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
}) {
  const ref = useRef<ReactCodeMirrorRef>(null);
  const [schema, setSchema] = useState<Record<string, string[]> | undefined>();
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  // onChange estável (via ref) para não disparar reconfiguração do editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handleChange = useCallback((v: string) => onChangeRef.current(v), []);

  useEffect(() => {
    let alive = true;
    buildSchemaMap(connId).then((m) => alive && setSchema(m));
    return () => {
      alive = false;
    };
  }, [connId]);

  const extensions = useMemo(
    () => [
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            preventDefault: true,
            run: () => {
              onRunRef.current();
              return true;
            },
          },
        ]),
      ),
      sqlExtension(kind, schema),
      baseTheme,
      EditorView.lineWrapping,
    ],
    [kind, schema],
  );

  return (
    <CodeMirror
      ref={ref}
      value={value}
      onChange={handleChange}
      theme="dark"
      extensions={extensions}
      basicSetup={BASIC_SETUP}
      className="h-full text-sm"
      height="100%"
    />
  );
}
