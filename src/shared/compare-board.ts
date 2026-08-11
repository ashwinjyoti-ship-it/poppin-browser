/**
 * Structured Diff/Compare board: parse markdown comparison tables into a
 * matrix the UI can render without freeform prose. Columns are options;
 * rows are attributes. The first column is treated as the attribute label.
 */

export interface CompareMatrix {
  /** Option / candidate names (table header cells after the label column). */
  options: string[];
  /** Attribute rows: label + one cell per option. */
  rows: Array<{ label: string; cells: string[] }>;
}

const TABLE_ROW = /^\s*\|(.+)\|\s*$/u;
const SEPARATOR_CELL = /^\s*:?-+:?\s*$/u;

/**
 * Finds the first GFM pipe table in markdown and returns it as a compare
 * matrix when it has at least two option columns. Returns null when no
 * usable table is present.
 */
export function parseCompareMatrix(markdown: string): CompareMatrix | null {
  if (!markdown.trim()) return null;
  const lines = markdown.replace(/\r\n/gu, '\n').split('\n');
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index]!;
    const separatorLine = lines[index + 1]!;
    if (!TABLE_ROW.test(headerLine) || !TABLE_ROW.test(separatorLine)) continue;
    const headerCells = splitRow(headerLine);
    const separatorCells = splitRow(separatorLine);
    if (headerCells.length < 3 || separatorCells.length < 3) continue;
    if (!separatorCells.every((cell) => SEPARATOR_CELL.test(cell))) continue;

    const options = headerCells.slice(1).map(cleanCell).filter(Boolean);
    if (options.length < 2) continue;

    const rows: CompareMatrix['rows'] = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex]!;
      if (!TABLE_ROW.test(line)) break;
      const cells = splitRow(line).map(cleanCell);
      if (cells.length < 2) continue;
      const label = cells[0] ?? '';
      const values = cells.slice(1);
      while (values.length < options.length) values.push('');
      rows.push({ label, cells: values.slice(0, options.length) });
    }
    if (rows.length === 0) continue;
    return { options, rows };
  }
  return null;
}

function splitRow(line: string): string[] {
  const match = line.match(TABLE_ROW);
  if (!match?.[1]) return [];
  return match[1].split('|').map((cell) => cell.trim());
}

function cleanCell(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}
