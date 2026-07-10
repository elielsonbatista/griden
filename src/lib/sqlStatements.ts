import type { DbKind } from "@/types";

export interface Statement {
  text: string;
  start: number;
  end: number;
}

type ScanState =
  | "normal"
  | "singleQuote"
  | "doubleQuote"
  | "backtick"
  | "lineComment"
  | "blockComment";

export function splitStatements(doc: string, kind: DbKind): Statement[] {
  const statements: Statement[] = [];
  let state: ScanState = "normal";
  let stmtStart = 0;

  const push = (end: number) => {
    if (doc.slice(stmtStart, end).trim()) {
      statements.push({ text: doc.slice(stmtStart, end).trim(), start: stmtStart, end });
    }
  };

  for (let i = 0; i < doc.length; i++) {
    const c = doc[i];
    const next = doc[i + 1];

    switch (state) {
      case "normal":
        if (c === "'") {
          state = "singleQuote";
        } else if (c === '"') {
          state = "doubleQuote";
        } else if (c === "`") {
          state = "backtick";
        } else if (c === "-" && next === "-") {
          state = "lineComment";
          i++;
        } else if (kind === "mysql" && c === "#") {
          state = "lineComment";
        } else if (c === "/" && next === "*") {
          state = "blockComment";
          i++;
        } else if (c === ";") {
          push(i);
          stmtStart = i + 1;
        }
        break;

      case "singleQuote":
        if (c === "'" && next === "'") i++;
        else if (c === "'") state = "normal";
        break;

      case "doubleQuote":
        if (c === '"' && next === '"') i++;
        else if (c === '"') state = "normal";
        break;

      case "backtick":
        if (c === "`") state = "normal";
        break;

      case "lineComment":
        if (c === "\n") state = "normal";
        break;

      case "blockComment":
        if (c === "*" && next === "/") {
          state = "normal";
          i++;
        }
        break;
    }
  }

  push(doc.length);
  return statements;
}

export function statementAtOffset(
  statements: Statement[],
  offset: number,
): Statement | undefined {
  return statements.find((s) => offset <= s.end) ?? statements[statements.length - 1];
}
