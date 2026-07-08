import type { Cell } from "@/types";

/**
 * Converte um valor de célula em texto para exibição/edição.
 * Objetos e arrays (colunas JSON/JSONB) são serializados com JSON.stringify
 * em vez de virarem "[object Object]".
 */
export function formatCell(value: Cell): string {
  if (value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
