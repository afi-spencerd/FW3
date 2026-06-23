/**
 * Minimal RFC-4180-ish CSV parsing for the browser (no dependency). Handles
 * quoted fields, escaped quotes (""), commas and newlines inside quotes, and
 * CRLF/LF line endings. The first non-empty line is treated as the header.
 */

/** Split CSV text into rows of string cells. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = (): void => {
    row.push(field);
    field = "";
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      pushField();
      i++;
    } else if (ch === "\r") {
      i++; // handled by the following \n (or treat lone \r as line end)
      if (text[i] !== "\n") pushRow();
    } else if (ch === "\n") {
      pushRow();
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  // Flush the trailing field/row unless the input ended on a clean newline.
  if (field.length > 0 || row.length > 0) pushRow();
  // Drop fully blank rows (e.g. a trailing newline produced an empty row).
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface CsvParseResult<T> {
  rows: T[];
  /** Header names that were required but missing (empty = OK). */
  missingHeaders: string[];
}

/**
 * Parse CSV text into objects keyed by header name (lower-cased + trimmed), then
 * mapped through `map`. `required` headers that are absent are reported back.
 */
export function parseCsvObjects<T>(
  text: string,
  required: string[],
  map: (get: (key: string) => string) => T,
): CsvParseResult<T> {
  const raw = parseCsvRows(text);
  if (raw.length === 0) return { rows: [], missingHeaders: required };
  const headers = raw[0]!.map((h) => h.trim().toLowerCase());
  const missingHeaders = required.filter(
    (r) => !headers.includes(r.toLowerCase()),
  );
  if (missingHeaders.length) return { rows: [], missingHeaders };
  const rows = raw.slice(1).map((cells) => {
    const get = (key: string): string => {
      const idx = headers.indexOf(key.toLowerCase());
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };
    return map(get);
  });
  return { rows, missingHeaders: [] };
}
