// Fonts for next/og share cards: Source Serif 4 (SIL OFL, assets/fonts/OFL.txt), matching the
// site's serif identity. Read once per server process. next.config traces assets/fonts into
// the standalone build; the standalone server runs with apps/web as its working directory.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const FILES = [
  { weight: 400, file: "SourceSerif4-400.woff" },
  { weight: 600, file: "SourceSerif4-600.woff" },
  { weight: 700, file: "SourceSerif4-700.woff" },
] as const;

let loaded:
  | Promise<{ name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" }[]>
  | undefined;

export function cardFonts() {
  loaded ??= Promise.all(
    FILES.map(async ({ weight, file }) => {
      const buf = await readFile(join(process.cwd(), "assets/fonts", file));
      const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      return { name: "Serif", data, weight, style: "normal" as const };
    }),
  );
  return loaded;
}
