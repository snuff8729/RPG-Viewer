import { beforeAll, describe, expect, it } from "vitest";
import type { GameData } from "@/core/types";
import { loadGame } from "@/core/loader/loadGame";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { AssetStore } from "./assets";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const head = async (b: Blob | null) => [...new Uint8Array(await b!.arrayBuffer()).slice(0, 8)];

async function open(name: "sample-mz" | "sample-mv") {
  const folder = loadFixtureFolder(name);
  const r = await loadGame(folder);
  if (!r.ok) throw new Error("load failed");
  return { folder, data: r.data as GameData };
}

describe("AssetStore", () => {
  let store: AssetStore;
  beforeAll(async () => {
    const { folder, data } = await open("sample-mz");
    store = new AssetStore(folder, data);
  });

  it("decrypts MZ face to a valid PNG", async () => {
    const blob = await store.load("faces", "People1");
    expect(blob!.type).toBe("image/png");
    expect(await head(blob)).toEqual(PNG_SIG);
  });
  it("finds plain file with different case", async () => expect(await store.load("faces", "Actor1")).not.toBeNull());
  it("decrypts MV .rpgmvp", async () => {
    const { folder, data } = await open("sample-mv");
    expect(await head(await new AssetStore(folder, data).load("faces", "Actor1"))).toEqual(PNG_SIG);
  });
  it("returns null for missing", async () => expect(await store.load("pictures", "nope")).toBeNull());
  it("returns null for empty name", async () => expect(await store.load("faces", "")).toBeNull());
  it("returns null for encrypted file without key", async () => {
    const { folder, data } = await open("sample-mz");
    const noKey = { ...data, system: { ...data.system, encryptionKey: undefined } } as GameData;
    expect(await new AssetStore(folder, noKey).load("faces", "People1")).toBeNull();
  });
  it("caches", () => expect(store.load("faces", "People1")).toBe(store.load("faces", "People1")));
});
