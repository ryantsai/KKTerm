export type ExtraHeaderRow = {
  name: string;
  value: string;
};

/**
 * Converts the legacy comma-separated key=value setting into rows for the
 * Settings editor. Commas inside quoted names or values stay in the entry.
 */
export function parseExtraHeaders(value: string): ExtraHeaderRow[] {
  return splitHeaderEntries(value)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex < 0) {
        return {
          name: unwrapQuotedValue(entry.trim()),
          value: "",
        };
      }
      return {
        name: unwrapQuotedValue(entry.slice(0, separatorIndex).trim()),
        value: unwrapQuotedValue(entry.slice(separatorIndex + 1).trim()),
      };
    });
}

/** Keeps the durable format compatible with the Rust request-header parser. */
export function serializeExtraHeaders(rows: ExtraHeaderRow[]): string {
  return rows
    .map(({ name, value }) => `${quoteCommaValue(name)}=${quoteCommaValue(value)}`)
    .join(", ");
}

export function isSensitiveExtraHeader({ name, value }: ExtraHeaderRow): boolean {
  const normalizedName = name.trim().toLowerCase();
  return (
    /(?:^|[-_])(?:authorization|auth|api[-_]?key|token|secret|password|credential|proxy[-_]?key)(?:$|[-_])/.test(
      normalizedName,
    ) ||
    /^(?:bearer|basic)\s+\S/i.test(value.trim())
  );
}

function splitHeaderEntries(value: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\"") {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      const entry = value.slice(start, index).trim();
      if (entry) entries.push(entry);
      start = index + 1;
    }
  }

  const finalEntry = value.slice(start).trim();
  if (finalEntry) entries.push(finalEntry);
  return entries;
}

function unwrapQuotedValue(value: string): string {
  return value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")
    ? value.slice(1, -1)
    : value;
}

function quoteCommaValue(value: string): string {
  return value.includes(",") ? `"${value}"` : value;
}
