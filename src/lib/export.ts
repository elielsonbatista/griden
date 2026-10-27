import type { QueryResult, Cell } from "@/types";
import { formatCell } from "@/lib/format";

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
  // TSV has no quoting, so tabs and line breaks would split cells when pasted into a spreadsheet.
  const clean = (v: Cell) => formatCell(v).replace(/[\t\n\r]+/g, " ");
  const header = result.columns.map((c) => c.name).join("\t");
  const lines = result.rows.map((row) => row.map(clean).join("\t"));
  return [header, ...lines].join("\n");
}

export function toJson(result: QueryResult): string {
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

export const EXPORT_FORMATS: {
  label: string;
  ext: string;
  build: (r: QueryResult) => string;
}[] = [
  { label: "CSV", ext: "csv", build: toCsv },
  { label: "JSON", ext: "json", build: toJson },
  { label: "TSV", ext: "tsv", build: toTsv },
  { label: "Markdown", ext: "md", build: toMarkdown },
];
