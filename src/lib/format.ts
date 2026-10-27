import type { Cell } from "@/types";

export function formatCell(value: Cell): string {
  if (value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
