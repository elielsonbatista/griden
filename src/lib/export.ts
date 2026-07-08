import type { QueryResult, Cell } from "@/types";
import { formatCell } from "@/lib/format";

/** Escapa um valor para formatos delimitados (CSV). */
function escapeDelimited(value: Cell): string {
  const s = formatCell(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(result: QueryResult): string {
  const header = result.columns.map((c) => escapeDelimited(c.name)).join(",");
  const lines = result.rows.map((row) => row.map(escapeDelimited).join(","));
  return [header, ...lines].join("\n");
}

export function toTsv(result: QueryResult): string {
  // Tab/quebras viram espaço — formato simples para colar em planilhas.
  const clean = (v: Cell) => formatCell(v).replace(/[\t\n\r]+/g, " ");
  const header = result.columns.map((c) => c.name).join("\t");
  const lines = result.rows.map((row) => row.map(clean).join("\t"));
  return [header, ...lines].join("\n");
}

export function toJson(result: QueryResult): string {
  // Cada linha vira um objeto; valores JSON/JSONB permanecem aninhados.
  const rows = result.rows.map((row) => {
    const obj: Record<string, Cell> = {};
    result.columns.forEach((c, i) => {
      obj[c.name] = row[i];
    });
    return obj;
  });
  return JSON.stringify(rows, null, 2);
}

export function toMarkdown(result: QueryResult): string {
  const cell = (v: Cell) => formatCell(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const header = `| ${result.columns.map((c) => cell(c.name)).join(" | ")} |`;
  const sep = `| ${result.columns.map(() => "---").join(" | ")} |`;
  const lines = result.rows.map((row) => `| ${row.map(cell).join(" | ")} |`);
  return [header, sep, ...lines].join("\n");
}
