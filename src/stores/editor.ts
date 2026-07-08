import { create } from "zustand";
import { api, errMessage } from "@/lib/ipc";
import type { ForeignKey, QueryResult } from "@/types";
import type { FilterCondition } from "@/lib/query";

let seq = 1;

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
  run: (id: string) => Promise<void>;
}

export const useEditor = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  history: [],

  openTab(connId, connName, sql = "", title, editable, foreignKeys, source, initialFilters) {
    const id = `tab-${seq++}`;
    const tab: QueryTab = {
      id,
      connId,
      connName,
      title: title ?? `Query ${seq - 1}`,
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

  async run(id) {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || tab.running || !tab.sql.trim()) return;

    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, running: true, error: null } : t)),
    }));

    try {
      const result = await api.runQuery(tab.connId, tab.sql);
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, result, running: false } : t)),
        history: [
          {
            id: `h-${seq++}`,
            connId: tab.connId,
            sql: tab.sql,
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
            id: `h-${seq++}`,
            connId: tab.connId,
            sql: tab.sql,
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
}));
