import { describe, expect, it } from "vitest";
import { MemoryFolder } from "@/core/fs/folder";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { loadGame } from "./loadGame";

describe("loadGame", () => {
  it("loads MZ fixture", async () => {
    const r = await loadGame(loadFixtureFolder("sample-mz"));
    if (!r.ok) throw new Error("load failed");
    expect(r.data.engine).toBe("MZ");
    expect(r.data.dataRoot).toBe("data");
    expect(r.data.imgRoot).toBe("img");
    expect(r.data.system.gameTitle).toBe("샘플 게임");
    expect([...r.data.maps.keys()].sort()).toEqual([1, 2, 3]);
    expect(r.data.errors).toEqual([expect.objectContaining({ file: "data/Map004.json", mapId: 4 })]);
    expect(r.data.commonEvents[2]).toBeNull();
  });
  it("loads MV fixture from www/", async () => {
    const r = await loadGame(loadFixtureFolder("sample-mv"));
    if (!r.ok) throw new Error();
    expect(r.data.engine).toBe("MV");
    expect(r.data.dataRoot).toBe("www/data");
    expect(r.data.imgRoot).toBe("www/img");
  });
  it("reports notFound with searched paths", async () => {
    expect(await loadGame(new MemoryFolder({ "readme.txt": "x" }))).toEqual(
      { ok: false, reason: "notFound", searched: ["www/data/System.json", "data/System.json"] });
  });
  it("reports encrypted data", async () => {
    expect(await loadGame(new MemoryFolder({ "data/System.json": "U2FsdGVk..." })))
      .toEqual({ ok: false, reason: "encrypted", file: "data/System.json" });
  });
  it("keeps going when a file is malformed", async () => {
    const r = await loadGame(new MemoryFolder({
      "data/System.json": JSON.stringify({ gameTitle: "t", currencyUnit: "G", switches: [], variables: [] }),
      "data/MapInfos.json": "[null, {\"id\":1,\"name\":\"a\",\"parentId\":0,\"order\":1}]",
      "data/Map001.json": "{ broken",
      "data/CommonEvents.json": "[null]",
    }));
    if (!r.ok) throw new Error();
    expect(r.data.maps.size).toBe(0);
    expect(r.data.errors.map(e => e.file)).toContain("data/Map001.json");
    expect(r.data.errors.map(e => e.file)).toContain("data/Troops.json");
  });
});
