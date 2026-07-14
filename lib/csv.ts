export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value.length > 0 || row.length > 0) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export interface CsvTable {
  headers: string[];
  positions: Map<string, number[]>;
  rows: string[][];
}

export function toCsvTable(text: string): CsvTable {
  const parsed = parseCsv(text.replace(/^\uFEFF/, ""));
  const headers = parsed[0] ?? [];
  const positions = new Map<string, number[]>();
  headers.forEach((header, index) => {
    const key = header.trim();
    positions.set(key, [...(positions.get(key) ?? []), index]);
  });
  return { headers, positions, rows: parsed.slice(1) };
}

export function firstValue(
  row: string[],
  positions: Map<string, number[]>,
  candidates: string[],
): string | undefined {
  for (const candidate of candidates) {
    for (const position of positions.get(candidate) ?? []) {
      const value = row[position]?.trim();
      if (value !== undefined && value !== "") return value;
    }
  }
  return undefined;
}
