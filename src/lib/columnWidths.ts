export const DEFAULT_COL_WIDTH = 200;
export const MIN_COL_WIDTH = 60;
export const MAX_COL_WIDTH = 1200;

/** Column name -> width in px. Absent columns use the default. */
export type ColumnWidths = Record<string, number>;

export function clampColumnWidth(width: number): number {
  return Math.round(Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, width)));
}

export function columnWidth(widths: ColumnWidths | undefined, column: string): number {
  return widths?.[column] ?? DEFAULT_COL_WIDTH;
}

export function gridWidth(
  columns: string[],
  widths: ColumnWidths | undefined,
  leading: number,
): number {
  return columns.reduce((sum, c) => sum + columnWidth(widths, c), leading);
}

export function columnVar(index: number): string {
  return `--col-${index}`;
}

/** `null` resets the column to the default width. */
export function withColumnWidth(
  widths: ColumnWidths | undefined,
  column: string,
  width: number | null,
): ColumnWidths {
  const next = { ...widths };
  if (width === null || clampColumnWidth(width) === DEFAULT_COL_WIDTH) delete next[column];
  else next[column] = clampColumnWidth(width);
  return next;
}
