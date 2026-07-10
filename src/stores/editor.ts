import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { api, errMessage } from "@/lib/ipc";
import { useConnections } from "@/stores/connections";
import { splitStatements } from "@/lib/sqlStatements";
import type { ForeignKey, QueryResult } from "@/types";
import type { FilterCondition } from "@/lib/query";

let idSeq = 1;
let queryTitleSeq = 1;

/** Contexto que torna o grid editável (aba aberta a partir de uma tabela). */
export interface EditableSource {
  schema: string;
  table: string;
  pkColumns: string[];
}

export interface QueryTab {
  id: string;
  connId: string;
  connName: string;
  title: string;
  sql: string;
  result: QueryResult | null;
  error: string | null;
  running: boolean;
  editable?: EditableSource;
  /** FKs da tabela de origem (para navegar até registros referenciados). */
  foreignKeys?: ForeignKey[];
  /** Definido quando a aba foi aberta a partir de uma tabela/view (data view). */
  source?: { schema: string; table: string };
  /** Filtros pré-aplicados ao abrir (ex.: navegação por foreign key). */
  initialFilters?: FilterCondition[];
}

export interface HistoryEntry {
  id: string;
  connId: string;
  sql: string;
  ok: boolean;
  elapsedMs: number;
  rows: number;
  at: number;
}

interface EditorState {
  tabs: QueryTab[];
  activeTabId: string | null;
  history: HistoryEntry[];

  openTab: (
    connId: string,
    connName: string,
    sql?: string,
    title?: string,
    editable?: EditableSource,
    foreignKeys?: ForeignKey[],
    source?: { schema: string; table: string },
    initialFilters?: FilterCondition[],
  ) => string;
  closeTab: (id: string) => void;
  /** Reordena: move a aba `draggedId` para a posição de `targetId`. */
  moveTab: (draggedId: string, targetId: string) => void;
  setActiveTab: (id: string) => void;
  setSql: (id: string, sql: string) => void;
  run: (id: string, sqlOverride?: string) => Promise<void>;
  /** Roda cada statement do SQL da aba, em sequência, parando no primeiro erro. */
  runAll: (id: string) => Promise<void>;
}

type PersistedTab = Pick<
  QueryTab,
  | "id"
  | "connId"
  | "connName"
  | "title"
  | "sql"
  | "editable"
  | "foreignKeys"
  | "source"
  | "initialFilters"
>;

interface PersistedEditorState {
  activeTabId: string | null;
  history: HistoryEntry[];
  tabs: PersistedTab[];
}

export const useEditor = create<EditorState>()(
  persist<EditorState, [], [], PersistedEditorState>(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      history: [],

      openTab(connId, connName, sql = "", title, editable, foreignKeys, source, initialFilters) {
        const id = `tab-${idSeq++}`;
        const tab: QueryTab = {
          id,
          connId,
          connName,
          title: title ?? `Query ${queryTitleSeq++}`,
          sql,
          result: null,
          error: null,
          running: false,
          editable,
          foreignKeys,
          source,
          initialFilters,
        };
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
        return id;
      },

      closeTab(id) {
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.id === id);
          const tabs = s.tabs.filter((t) => t.id !== id);
          let activeTabId = s.activeTabId;
          if (s.activeTabId === id) {
            activeTabId = tabs[Math.max(0, idx - 1)]?.id ?? null;
          }
          return { tabs, activeTabId };
        });
      },

      moveTab(draggedId, targetId) {
        if (draggedId === targetId) return;
        set((s) => {
          const tabs = [...s.tabs];
          const from = tabs.findIndex((t) => t.id === draggedId);
          const to = tabs.findIndex((t) => t.id === targetId);
          if (from === -1 || to === -1) return {};
          const [moved] = tabs.splice(from, 1);
          tabs.splice(to, 0, moved);
          return { tabs };
        });
      },

      setActiveTab(id) {
        set({ activeTabId: id });
      },

      setSql(id, sql) {
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql } : t)),
        }));
      },

      async run(id, sqlOverride) {
        const tab = get().tabs.find((t) => t.id === id);
        const sql = sqlOverride ?? tab?.sql ?? "";
        if (!tab || tab.running || !sql.trim()) return;

        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, running: true, error: null } : t)),
        }));

        try {
          const result = await api.runQuery(tab.connId, sql);
          set((s) => ({
            tabs: s.tabs.map((t) => (t.id === id ? { ...t, result, running: false } : t)),
            history: [
              {
                id: crypto.randomUUID(),
                connId: tab.connId,
                sql,
                ok: true,
                elapsedMs: result.elapsedMs,
                rows: result.rows.length,
                at: Date.now(),
              },
              ...s.history,
            ].slice(0, 200),
          }));
        } catch (e) {
          const error = errMessage(e);
          set((s) => ({
            tabs: s.tabs.map((t) => (t.id === id ? { ...t, error, running: false } : t)),
            history: [
              {
                id: crypto.randomUUID(),
                connId: tab.connId,
                sql,
                ok: false,
                elapsedMs: 0,
                rows: 0,
                at: Date.now(),
              },
              ...s.history,
            ].slice(0, 200),
          }));
        }
      },

      async runAll(id) {
        const tab = get().tabs.find((t) => t.id === id);
        if (!tab || tab.running) return;
        const kind =
          useConnections.getState().connections.find((c) => c.id === tab.connId)?.kind ??
          "postgres";
        const statements = splitStatements(tab.sql, kind);
        if (!statements.length) return;

        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, running: true, error: null } : t)),
        }));

        const newHistory: HistoryEntry[] = [];
        let lastResult: QueryResult | null = null;
        let failure: { index: number; message: string } | null = null;

        for (let i = 0; i < statements.length; i++) {
          const stmt = statements[i];
          try {
            const result = await api.runQuery(tab.connId, stmt.text);
            lastResult = result;
            newHistory.unshift({
              id: crypto.randomUUID(),
              connId: tab.connId,
              sql: stmt.text,
              ok: true,
              elapsedMs: result.elapsedMs,
              rows: result.rows.length,
              at: Date.now(),
            });
          } catch (e) {
            newHistory.unshift({
              id: crypto.randomUUID(),
              connId: tab.connId,
              sql: stmt.text,
              ok: false,
              elapsedMs: 0,
              rows: 0,
              at: Date.now(),
            });
            failure = { index: i, message: errMessage(e) };
            break;
          }
        }

        const error = failure
          ? `statement ${failure.index + 1}/${statements.length} falhou: ${failure.message}`
          : null;

        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id ? { ...t, result: error ? null : lastResult, error, running: false } : t,
          ),
          history: [...newHistory, ...s.history].slice(0, 200),
        }));
      },
    }),
    {
      name: "griden-editor",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeTabId: state.activeTabId,
        history: state.history,
        tabs: state.tabs.map(
          ({
            id,
            connId,
            connName,
            title,
            sql,
            editable,
            foreignKeys,
            source,
            initialFilters,
          }) => ({ id, connId, connName, title, sql, editable, foreignKeys, source, initialFilters }),
        ),
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as PersistedEditorState | undefined;
        if (!persisted) return currentState;

        const tabs: QueryTab[] = persisted.tabs.map((t) => ({
          ...t,
          result: null,
          error: null,
          running: false,
        }));

        // Restored ids collide with idSeq/queryTitleSeq after a reload; bump both past the highest restored number.
        let maxIdSeq = 0;
        let maxTitleSeq = 0;
        for (const t of tabs) {
          const idMatch = /^tab-(\d+)$/.exec(t.id);
          if (idMatch) maxIdSeq = Math.max(maxIdSeq, Number(idMatch[1]));
          const titleMatch = /^Query (\d+)$/.exec(t.title);
          if (titleMatch) maxTitleSeq = Math.max(maxTitleSeq, Number(titleMatch[1]));
        }
        idSeq = Math.max(idSeq, maxIdSeq + 1);
        queryTitleSeq = Math.max(queryTitleSeq, maxTitleSeq + 1);

        const activeTabId = tabs.some((t) => t.id === persisted.activeTabId)
          ? persisted.activeTabId
          : (tabs[0]?.id ?? null);

        return { ...currentState, tabs, activeTabId, history: persisted.history };
      },
    },
  ),
);
