import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryFolder } from "../../src/core/fs/folder";

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "..", "fixtures");

function walk(dir: string, prefix: string, out: Record<string, string | Uint8Array>): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) walk(full, rel, out);
    else out[rel] = name.toLowerCase().endsWith(".json") ? readFileSync(full, "utf8") : new Uint8Array(readFileSync(full));
  }
}

export function loadFixtureFolder(name: "sample-mz" | "sample-mv"): MemoryFolder {
  const files: Record<string, string | Uint8Array> = {};
  walk(join(FIXTURES, name), "", files);
  return new MemoryFolder(files);
}
