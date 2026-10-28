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
  it("keeps message escape codes intact in the MZ fixture", async () => {
    const r = await loadGame(loadFixtureFolder("sample-mz"));
    if (!r.ok) throw new Error("load failed");
    const list = r.data.maps.get(2)!.events[1]!.pages[0].list;
    expect(list).toHaveLength(37);
    expect(list[1].parameters[0]).toBe(String.raw`왔구나, \N[1].`);
    expect(list[9].code).toBe(401);
    expect(list[9].parameters[0]).toBe(String.raw`도와주겠나? \C[2]보상\C[0]은 \V[1]만큼.`);
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

  it("does not keep map tile data", async () => {
    const r = await loadGame(new MemoryFolder({
      "data/System.json": JSON.stringify({ gameTitle: "t", currencyUnit: "G", switches: [], variables: [] }),
      "data/MapInfos.json": JSON.stringify([null, { id: 1, name: "a", parentId: 0, order: 1 }]),
      "data/Map001.json": JSON.stringify({ displayName: "들판", data: [1, 2, 3, 4], tilesetId: 1, events: [null] }),
    }));
    if (!r.ok) throw new Error();
    const m = r.data.maps.get(1)!;
    expect(m).toEqual({ displayName: "들판", events: [null] });
    expect("data" in m).toBe(false);
  });
  it("loads maps with bounded parallelism and stable error order", async () => {
    const N = 20;
    const files: Record<string, string> = {
      "data/System.json": JSON.stringify({ gameTitle: "t", currencyUnit: "G", switches: [], variables: [] }),
      "data/MapInfos.json": JSON.stringify([null, ...Array.from({ length: N }, (_, i) => ({ id: i + 1, name: "m" + (i + 1), parentId: 0, order: i + 1 }))]),
    };
    for (let i = 1; i <= N; i++) if (i % 3 !== 0) files[`data/Map${String(i).padStart(3, "0")}.json`] = JSON.stringify({ displayName: "", events: [] });
    let inFlight = 0, peak = 0;
    class SlowFolder extends MemoryFolder {
      async readText(path: string) {
        inFlight++; peak = Math.max(peak, inFlight);
        // 뒤쪽 맵이 먼저 끝나도록 지연을 역순으로 준다
        const m = /Map(d+)/.exec(path);
        await new Promise(res => setTimeout(res, m ? (N - Number(m[1])) : 0));
        try { return await super.readText(path); } finally { inFlight--; }
      }
    }
    const r = await loadGame(new SlowFolder(files));
    if (!r.ok) throw new Error();
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(r.data.maps.size).toBe(N - Math.floor(N / 3));
    expect(r.data.errors.filter(e => e.mapId !== undefined).map(e => e.mapId)).toEqual([3, 6, 9, 12, 15, 18]);
  });
});
