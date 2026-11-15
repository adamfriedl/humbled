/**
 * SR-1: user text is data, never instructions. Untrusted strings are length-capped, stripped
 * of the delimiter characters used in prompts, and rendered inside a JSON data block.
 */

const DELIMITER_LOOKALIKES: Record<string, string> = { "<": "‹", ">": "›", "`": "'" };

export function sanitizeUntrusted(text: string, maxLength: number): string {
  // Collapse whitespace (including newlines that could fake prompt structure), drop control
  // characters, replace delimiter characters, and cap length.
  const cleaned = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>`]/g, (c) => DELIMITER_LOOKALIKES[c] ?? c)
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength).trimEnd() : cleaned;
}

/** Render a record of untrusted fields as a delimited, JSON-encoded data block. */
export function dataBlock(tag: string, data: Record<string, unknown>): string {
  return `<${tag}>\n${JSON.stringify(data, null, 2)}\n</${tag}>`;
}
