import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { keymap, EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { sqlExtension, buildSchemaMap } from "@/lib/sql";
import { splitStatements, statementAtOffset } from "@/lib/sqlStatements";
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

export interface SqlEditorHandle {
  runCurrent: () => void;
  runAll: () => void;
}

export const SqlEditor = forwardRef<
  SqlEditorHandle,
  {
    connId: string;
    kind: DbKind;
    value: string;
    onChange: (v: string) => void;
    onRun: (sql: string) => void;
    onRunAll: (statements: string[]) => void;
  }
>(function SqlEditor({ connId, kind, value, onChange, onRun, onRunAll }, ref) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const [schema, setSchema] = useState<Record<string, string[]> | undefined>();
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const onRunAllRef = useRef(onRunAll);
  onRunAllRef.current = onRunAll;
  // value/kind em ref: o keymap é montado uma vez (via extensions memoizadas) e
  // precisa sempre ler o texto/dialeto atuais, não os do momento em que foi criado.
  const valueRef = useRef(value);
  valueRef.current = value;
  const kindRef = useRef(kind);
  kindRef.current = kind;
  // onChange estável (via ref) para não disparar reconfiguração do editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const handleChange = useCallback((v: string) => onChangeRef.current(v), []);

  const runCurrent = useCallback(() => {
    const view = cmRef.current?.view;
    const selection = view?.state.selection.main;
    const doc = valueRef.current;
    if (selection && !selection.empty) {
      onRunRef.current(doc.slice(selection.from, selection.to));
      return;
    }
    const statements = splitStatements(doc, kindRef.current);
    const statement = statementAtOffset(statements, selection?.head ?? doc.length);
    if (statement) onRunRef.current(statement.text);
  }, []);

  const runAll = useCallback(() => {
    const statements = splitStatements(valueRef.current, kindRef.current);
    if (statements.length) onRunAllRef.current(statements.map((s) => s.text));
  }, []);

  useImperativeHandle(ref, () => ({ runCurrent, runAll }), [runCurrent, runAll]);

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
              runCurrent();
              return true;
            },
          },
          {
            key: "Mod-Shift-Enter",
            preventDefault: true,
            run: () => {
              runAll();
              return true;
            },
          },
        ]),
      ),
      sqlExtension(kind, schema),
      baseTheme,
      EditorView.lineWrapping,
    ],
    [kind, schema, runCurrent, runAll],
  );

  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      onChange={handleChange}
      theme="dark"
      extensions={extensions}
      basicSetup={BASIC_SETUP}
      className="h-full text-sm"
      height="100%"
    />
  );
});
