import { create } from "zustand";
import { api, errMessage } from "@/lib/ipc";
import type { ConnConfig, ConnInput } from "@/types";
import { toast } from "sonner";

interface ConnectionsState {
  connections: ConnConfig[];
  /** ids atualmente conectados */
  connected: Set<string>;
  /** id da conexão ativa (foco no explorer/editor) */
  activeId: string | null;
  /** ids com operação em andamento (connect/disconnect) */
  busy: Set<string>;
  loaded: boolean;

  load: () => Promise<void>;
  save: (input: ConnInput) => Promise<ConnConfig | null>;
  remove: (id: string) => Promise<void>;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
}

export const useConnections = create<ConnectionsState>((set, get) => ({
  connections: [],
  connected: new Set(),
  activeId: null,
  busy: new Set(),
  loaded: false,

  async load() {
    try {
      const connections = await api.listConnections();
      set({ connections, loaded: true });
    } catch (e) {
      toast.error("Falha ao carregar conexões", { description: errMessage(e) });
      set({ loaded: true });
    }
  },

  async save(input) {
    try {
      const saved = await api.saveConnection(input);
      await get().load();
      return saved;
    } catch (e) {
      toast.error("Falha ao salvar conexão", { description: errMessage(e) });
      return null;
    }
  },

  async remove(id) {
    try {
      await api.deleteConnection(id);
      set((s) => {
        const connected = new Set(s.connected);
        connected.delete(id);
        return {
          connections: s.connections.filter((c) => c.id !== id),
          connected,
          activeId: s.activeId === id ? null : s.activeId,
        };
      });
    } catch (e) {
      toast.error("Falha ao excluir conexão", { description: errMessage(e) });
    }
  },

  async connect(id) {
    set((s) => ({ busy: new Set(s.busy).add(id) }));
    try {
      await api.connect(id);
      set((s) => ({
        connected: new Set(s.connected).add(id),
        activeId: id,
      }));
    } catch (e) {
      toast.error("Falha ao conectar", { description: errMessage(e) });
    } finally {
      set((s) => {
        const busy = new Set(s.busy);
        busy.delete(id);
        return { busy };
      });
    }
  },

  async disconnect(id) {
    try {
      await api.disconnect(id);
    } finally {
      set((s) => {
        const connected = new Set(s.connected);
        connected.delete(id);
        return {
          connected,
          activeId: s.activeId === id ? null : s.activeId,
        };
      });
    }
  },

  setActive(id) {
    set({ activeId: id });
  },
}));
