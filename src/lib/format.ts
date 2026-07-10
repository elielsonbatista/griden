import type { Cell } from "@/types";

/**
 * Converts a cell value into text for display/editing.
 * Objects and arrays (JSON/JSONB columns) are serialized with JSON.stringify
 * instead of becoming "[object Object]".
 */
export function formatCell(value: Cell): string {
  if (value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
