import { describe, expect, it } from "vitest";
import { menuCommonEventIdsFromPlugins, menuCommonEventsOf, withoutMenuRecords } from "./menuScenes";
import { picturesBySeq } from "../addons/screenPictures";
import type { LogRecord } from "./types";
import type { CommonEvent } from "../types";

const base = { v: 1, run: 1, branch: 1, t: 0 } as const;
const mapSrc = { source: "map", mapId: 1, eventId: 2, page: 0 } as const;
const ce = (id: number) => ({ source: "common", commonEventId: id }) as const;
const pic = (seq: number, src: unknown, name: string, scene?: string): LogRecord =>
  ({ ...base, seq, type: "picture", src, cmd: 0, pictureId: 1, name, ...(scene ? { scene } : {}) }) as LogRecord;
const erase = (seq: number, src: unknown, scene?: string): LogRecord =>
  ({ ...base, seq, type: "picture", src, cmd: 0, pictureId: 1, name: "", op: "erase", ...(scene ? { scene } : {}) }) as LogRecord;
const msg = (seq: number, src: unknown, extra: Record<string, unknown> = {}): LogRecord =>
  ({ ...base, seq, type: "message", src, cmd: 0, face: "", faceIndex: 0, speaker: "", text: `t${seq}`, ...extra }) as LogRecord;
const STAND = [1, "stand_a", 0, 300, 100, 100, 100, 255, 0, 0, 0, 200, 400];
const MENU_STAND = [1, "stand_menu", 0, 300, 100, 100, 100, 255, 0, 0, 0, 200, 400];

describe("MenuCommonEvent plugin parameters", () => {
  const plugins = (params: Record<string, string>, status = true) =>
    `var $plugins = [${JSON.stringify({ name: "MenuCommonEvent", status, description: "", parameters: params })}];`;
  const info = JSON.stringify([
    JSON.stringify({ CommonEventId: "805", SceneName: "Scene_Menu" }),
    JSON.stringify({ CommonEventId: "806", SceneName: "Scene_Status" }),
    JSON.stringify({ CommonEventId: "x", SceneName: "Scene_Item" }),
  ]);
  it("reads CommonEventInfo and the Japanese parameter name", () => {
    expect(menuCommonEventIdsFromPlugins(plugins({ CommonEventInfo: info }))).toEqual([805, 806]);
    expect(menuCommonEventIdsFromPlugins(plugins({ "コモンイベント情報": info }))).toEqual([805, 806]);
  });
  it("ignores disabled plugins and garbage", () => {
    expect(menuCommonEventIdsFromPlugins(plugins({ CommonEventInfo: info }, false))).toEqual([]);
    expect(menuCommonEventIdsFromPlugins("nope")).toEqual([]);
    expect(menuCommonEventIdsFromPlugins(null)).toEqual([]);
    expect(menuCommonEventIdsFromPlugins(plugins({ CommonEventInfo: "[broken" }))).toEqual([]);
  });
  it("follows common event calls", () => {
    const ces: (CommonEvent | null)[] = [];
    ces[805] = { id: 805, name: "メニュー", trigger: 0, switchId: 1, list: [{ code: 117, indent: 0, parameters: [202] }] };
    ces[202] = { id: 202, name: "主人公立ち絵消去", trigger: 0, switchId: 1, list: [{ code: 117, indent: 0, parameters: [805] }] };
    const m = menuCommonEventsOf([805], ces)!;
    expect([...m.direct]).toEqual([805]);
    expect([...m.called].sort()).toEqual([202, 805]);
    expect(menuCommonEventsOf([], ces)).toBeNull();
  });
});

describe("menu pictures are left out of the reader", () => {
  it("tagged (1.17.0) menu records: pictures dropped, text kept, map stack continues", () => {
    const path = [
      msg(1, mapSrc, { pics: [STAND] }),
      erase(2, ce(202), "menu"),
      pic(3, ce(805), "stand_menu", "menu"),
      msg(4, ce(805), { scene: "menu", pics: [MENU_STAND] }),
      { ...base, seq: 5, type: "screen", scene: "menu", pics: [MENU_STAND] } as LogRecord,
      msg(6, mapSrc, { picsSame: true }),
    ];
    const out = withoutMenuRecords(path, false, null);
    expect(out.map(r => r.seq)).toEqual([1, 4, 6]);
    expect(out[1]).toMatchObject({ type: "message", text: "t4", picsSame: true });
    expect(out[1]).not.toHaveProperty("pics");
    const pics = picturesBySeq(out);
    expect(pics.get(6)?.map(p => p.name)).toEqual(["stand_a"]);
    expect(withoutMenuRecords(path, true, null)).toBe(path);
  });

  it("old logs: pictures from menu common events (and what they call) are menu pictures", () => {
    const ces: (CommonEvent | null)[] = [];
    ces[805] = { id: 805, name: "メニュー", trigger: 0, switchId: 1, list: [{ code: 117, indent: 0, parameters: [202] }] };
    const menu = menuCommonEventsOf([805, 806], ces);
    const path = [
      pic(1, mapSrc, "stand_a"),
      pic(2, ce(805), "stand_menu"),
      erase(3, ce(202)),
      pic(4, mapSrc, "stand_b"),
      erase(5, ce(202)), // 맵에서 부른 202는 메뉴가 아니다
    ];
    expect(withoutMenuRecords(path, false, menu).map(r => r.seq)).toEqual([1, 4, 5]);
    expect(withoutMenuRecords(path, false, null).map(r => r.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns the same array when nothing is a menu record", () => {
    const path = [pic(1, mapSrc, "a"), msg(2, mapSrc)];
    expect(withoutMenuRecords(path, false, null)).toBe(path);
  });
});
