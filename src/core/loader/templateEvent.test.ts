import { describe, expect, it } from "vitest";
import { MemoryFolder } from "@/core/fs/folder";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { loadGame } from "./loadGame";
import { parseTemplateNote, templateKeepEventIdFromPlugins, templateMapIdFromPlugins } from "./templateEvent";

async function load(edit?: (files: Record<string, string | Uint8Array>) => void) {
  const base = loadFixtureFolder("sample-te");
  const files: Record<string, string | Uint8Array> = {};
  for (const p of ["www/data/System.json", "www/data/MapInfos.json", "www/data/Map001.json", "www/data/Map002.json",
    "www/data/CommonEvents.json", "www/data/Troops.json", "www/data/Actors.json", "www/data/Items.json",
    "www/data/Weapons.json", "www/data/Armors.json", "www/js/plugins.js"]) {
    const t = await base.readText(p);
    if (t !== null) files[p] = t;
  }
  edit?.(files);
  const r = await loadGame(new MemoryFolder(files));
  if (!r.ok) throw new Error("load failed");
  return r.data;
}

describe("parseTemplateNote", () => {
  it("reads <TE:...> and <TemplateEvent:...>, trimmed", () => {
    expect(parseTemplateNote("<TE:말하는 사람>")).toBe("말하는 사람");
    expect(parseTemplateNote("메모 <TE: 3 > 끝")).toBe("3");
    expect(parseTemplateNote("<TemplateEvent:문지기>")).toBe("문지기");
    expect(parseTemplateNote("")).toBeNull();
    expect(parseTemplateNote(undefined)).toBeNull();
    expect(parseTemplateNote("<TE:>")).toBeNull();
  });
});

describe("templateKeepEventIdFromPlugins", () => {
  const js = (status: boolean, keep: unknown) =>
    `var $plugins =\n[\n${JSON.stringify({ name: "TemplateEvent", status, description: "", parameters: { TemplateMapId: "2", KeepEventId: keep } })}\n];\n`;
  it("is true only for a true value of an enabled TemplateEvent", () => {
    expect(templateKeepEventIdFromPlugins(js(true, "true"))).toBe(true);
    expect(templateKeepEventIdFromPlugins(js(true, true))).toBe(true);
    expect(templateKeepEventIdFromPlugins(js(true, "false"))).toBe(false);
    expect(templateKeepEventIdFromPlugins(js(false, "true"))).toBe(false);
    expect(templateKeepEventIdFromPlugins(js(true, undefined))).toBe(false);
    expect(templateKeepEventIdFromPlugins(null)).toBe(false);
    expect(templateKeepEventIdFromPlugins("garbage")).toBe(false);
  });
});

describe("templateMapIdFromPlugins", () => {
  it("reads TemplateMapId only when TemplateEvent is on", () => {
    const js = (status: boolean, id: string) =>
      `var $plugins =\n[\n${JSON.stringify({ name: "TemplateEvent", status, description: "", parameters: { TemplateMapId: id } })}\n];\n`;
    expect(templateMapIdFromPlugins(js(true, "2"))).toBe(2);
    expect(templateMapIdFromPlugins(js(false, "2"))).toBeNull();
    expect(templateMapIdFromPlugins(js(true, "abc"))).toBeNull();
    expect(templateMapIdFromPlugins(js(true, "0"))).toBeNull();
    expect(templateMapIdFromPlugins(null)).toBeNull();
    expect(templateMapIdFromPlugins("garbage")).toBeNull();
  });
});

describe("loadGame + TemplateEvent", () => {
  it("replaces pages of <TE:...> events with the template's pages", async () => {
    const data = await load();
    const tpl = data.maps.get(2)!.events;
    const m1 = data.maps.get(1)!.events;
    expect(data.templateMapId).toBe(2);
    // 이름으로: 같은 이름 중 첫 번째(id 2)
    expect(m1[1]!.pages).toEqual(tpl[2]!.pages);
    expect(m1[1]!.pages).toHaveLength(2);
    // 번호로(공백 trim)
    expect(m1[2]!.pages).toEqual(tpl[3]!.pages);
    // 원본 id·이름·좌표 유지, 원래 페이지는 originalPages에
    expect(m1[1]).toMatchObject({ id: 1, name: "주민A", x: 1, y: 1 });
    expect(Array.isArray(m1[1]!.originalPages)).toBe(true);
    expect(m1[1]!.originalPages).not.toBe(m1[1]!.pages);
    expect(m1[2]).toMatchObject({ id: 2, name: "상인 자리" });
    // 일반 이벤트는 그대로
    expect(m1[4]!.pages[0].list[1].parameters[0]).toBe("마을에 오신 걸 환영합니다.");
    // 템플릿 맵 자체는 그대로
    expect(tpl[2]!.name).toBe("말하는 사람");
  });
  it("reports unresolved templates without changing the event", async () => {
    const data = await load();
    expect(data.errors).toEqual([
      { file: "www/data/Map001.json", message: "템플릿 이벤트를 찾을 수 없어요: 없는것", mapId: 1 },
    ]);
    expect(data.maps.get(1)!.events[3]!.pages[0].list).toEqual([{ code: 0, indent: 0, parameters: [] }]);
  });
  it("does nothing when TemplateEvent is off", async () => {
    const data = await load(f => { f["www/js/plugins.js"] = String(f["www/js/plugins.js"]).replace('"TemplateEvent","status":true', '"TemplateEvent","status":false'); });
    expect(data.templateMapId).toBeUndefined();
    expect(data.maps.get(1)!.events[1]!.pages[0].list).toHaveLength(1);
    expect(data.errors).toEqual([]);
  });
  it("does nothing without plugins.js", async () => {
    const data = await load(f => { delete f["www/js/plugins.js"]; });
    expect(data.templateMapId).toBeUndefined();
    expect(data.maps.get(1)!.events[1]!.pages[0].list).toHaveLength(1);
    expect(data.errors).toEqual([]);
  });
  it("does nothing with malformed plugins.js", async () => {
    const data = await load(f => { f["www/js/plugins.js"] = "var $plugins = [ {oops ];"; });
    expect(data.templateMapId).toBeUndefined();
    expect(data.errors).toEqual([]);
  });
  it("reads the template map from file even when it is not in MapInfos", async () => {
    const data = await load(f => {
      f["www/data/MapInfos.json"] = JSON.stringify([null, { id: 1, name: "마을", parentId: 0, order: 1 }]);
    });
    expect(data.templateMapId).toBe(2);
    expect(data.maps.has(2)).toBe(false);
    expect(data.maps.get(1)!.events[1]!.pages).toHaveLength(2);
  });
  it("missing template map file → no expansion, no throw", async () => {
    const data = await load(f => {
      f["www/data/MapInfos.json"] = JSON.stringify([null, { id: 1, name: "마을", parentId: 0, order: 1 }]);
      delete f["www/data/Map002.json"];
    });
    expect(data.templateMapId).toBeUndefined();
    expect(data.maps.get(1)!.events[1]!.pages[0].list).toHaveLength(1);
  });
  it("works for MZ layout (data/ at root)", async () => {
    const data = await load(f => {
      for (const k of Object.keys(f)) { f[k.replace(/^www\//, "")] = f[k]; delete f[k]; }
    });
    expect(data.dataRoot).toBe("data");
    expect(data.templateMapId).toBe(2);
    expect(data.maps.get(1)!.events[2]!.pages).toEqual(data.maps.get(2)!.events[3]!.pages);
  });
});
