import { describe, expect, it } from "vitest";
import { MemoryFolder } from "../fs/folder";
import { formatPluginsJs, type PluginEntry } from "../live/installer";
import type { LogRecord } from "../live/types";
import { parseManifest, type AdapterManifest } from "../adapters/manifest";
import type { CommonEvent, EventCommand, EventPage, GameData, MapData, PageConditions } from "../types";
import {
  attentionCount, diagnoseGame, gatherDiagnosisInput, parseLogText, pictureWants, pictureWantsText, recommendedActions, reportMarkdown, scanPluginSource,
  settingsOfAddonFile, type DiagnosisReport,
} from "./index";

const c = (code: number, parameters: any[] = [], indent = 0): EventCommand => ({ code, indent, parameters });
const noCond: PageConditions = {
  switch1Valid: false, switch1Id: 1, switch2Valid: false, switch2Id: 1, variableValid: false, variableId: 1, variableValue: 0,
  selfSwitchValid: false, selfSwitchCh: "A", itemValid: false, itemId: 1, actorValid: false, actorId: 1,
};
const page = (list: EventCommand[]): EventPage => ({ conditions: noCond, trigger: 0, list: [...list, c(0)] });
const msg = (text: string) => [c(101, ["", 0, 0, 2]), c(401, [text])];
/** Show Picture: [id, name, origin, designation, x, y, scaleX, scaleY, opacity, blend] */
const pic = (id: number, name: string, x = 0, y = 0) => c(231, [id, name, 0, 0, x, y, 100, 100, 255, 0]);
const plugin = (name: string, parameters: Record<string, string> = {}, status = true): PluginEntry =>
  ({ name, status, description: "", parameters });

function game(o: Partial<GameData> & { maps?: Map<number, MapData>; commonEvents?: (CommonEvent | null)[] } = {}): GameData {
  return {
    engine: "MV", dataRoot: "www/data", imgRoot: "www/img",
    system: { gameTitle: "합성 게임", currencyUnit: "G", switches: [], variables: [] },
    mapInfos: [null], maps: new Map(), commonEvents: [null], troops: [null], actors: [null], items: [null], weapons: [null], armors: [null],
    errors: [], ...o,
  };
}

/** DOP 같은 게임: 겹친 스탠딩, 컷인, 하위 폴더 그림, 세이브 폴더, 메뉴 커먼 이벤트, 공용 전투 커먼 이벤트, 알림, 모르는 플러그인 */
function dopLike() {
  const town: MapData = {
    displayName: "마을", width: 10, height: 10, encounterList: [{ troopId: 1, weight: 1, regionSet: [] }], encounterStep: 30,
    events: [null,
      { id: 1, name: "소녀", x: 1, y: 1, pages: [page([
        pic(10, "body_01"), pic(11, "face_smile"), pic(12, "cloth_a"), ...msg("안녕"),
        pic(10, "body_01"), pic(11, "face_angry"), pic(12, "cloth_b"), ...msg("뭐야"),
      ])] },
      { id: 2, name: "적", x: 2, y: 2, pages: [page([c(117, [3])])] },
      { id: 3, name: "적2", x: 3, y: 2, pages: [page([c(117, [3]), pic(30, "missing_one")])] },
      { id: 4, name: "컷인", x: 4, y: 2, pages: [page([pic(50, "Actor1_CutIn"), c(230, [30]), c(235, [50]), ...msg("필살!")])] },
    ],
  };
  const commonEvents: (CommonEvent | null)[] = [null,
    { id: 1, name: "메뉴 그림", trigger: 0, switchId: 1, list: [pic(80, "menu_bg"), c(0)] },
    null,
    { id: 3, name: "전투 시작", trigger: 0, switchId: 1, list: [c(301, [0, 1, false, false]), c(0)] },
    { id: 4, name: "CG", trigger: 0, switchId: 1, list: [pic(60, "cg_09_0_06"), c(0)] },
  ];
  const data = game({ maps: new Map([[1, town]]), commonEvents, templateMapId: undefined, troops: [null, { id: 1, name: "슬라임", pages: [] }] });
  const plugins = formatPluginsJs([
    plugin("YEP_CoreEngine", { "Screen Width": "1280", "Screen Height": "720" }),
    plugin("YEP_BattleEngineCore"),
    plugin("BY_PictureClassify", { switch: "true", tokens: JSON.stringify([JSON.stringify({ token: "cg_09", floderToken: "cg_09" })]) }),
    plugin("SavePathRelocation", { BaseAt: "www", RelatedName: "save2" }),
    plugin("MenuCommonEvent", { CommonEventInfo: JSON.stringify([JSON.stringify({ SceneName: "Scene_Menu", CommonEventId: "1" })]) }),
    plugin("Ticker"),
    plugin("EventReSpawn"),
    plugin("CharacterPictureManager"),
    plugin("MysteryHud"),
    plugin("HtmlPopup"),
    plugin("QuietMath"),
    plugin("DisabledThing", {}, false),
  ]);
  const pluginSources: Record<string, string> = {
    MysteryHud: [
      "var Scene_Gallery = function() {};",
      "Sprite_Hud.prototype.refresh = function() { this.bitmap = ImageManager.loadPicture('hud_frame'); var s = new Sprite(); s.bitmap.blt(a,0,0,1,1,0,0); };",
      "BattleManager.startBattle = function() {};",
    ].join("\n"),
    HtmlPopup: "Popup.show = function(t) { var el = document.createElement('div'); document.body.appendChild(el); };",
    QuietMath: "Math.clampX = function(a) { return a; };",
  };
  const files = { pictures: ["body_01", "face_smile", "face_angry", "cloth_a", "cloth_b", "Actor1_CutIn", "menu_bg", "cg_09/cg_09_0_06"] };
  const adapters = [parseManifest({
    id: "character-picture-manager", label: "CPM 스탠딩", description: "배우별 스탠딩",
    match: { plugins: ["CharacterPictureManager"] }, defaults: { addons: { screenPictures: true } },
  }), parseManifest({ id: "other-game", label: "다른 게임", description: "", match: { plugins: ["Nope"] } })]
    .filter((m): m is AdapterManifest => m !== null);
  return { data, plugins, pluginSources, files, adapters };
}

const find = (r: DiagnosisReport, id: string) => r.findings.find(f => f.id === id);

describe("diagnoseGame on a DOP-like synthetic game", () => {
  const g = dopLike();
  const report = diagnoseGame(g.data, g.plugins, g.files, null, { pluginSources: g.pluginSources, adapters: g.adapters });

  it("reads engine, screen size from plugins, folder rules and save path", () => {
    expect(find(report, "engine")?.status).toBe("ok");
    expect(find(report, "screen-size")).toMatchObject({ status: "auto-fixed", area: "화면" });
    expect(find(report, "screen-size")?.evidence[0]).toBe("1280×720 (plugins.js YEP_CoreEngine)");
    expect(find(report, "picture-folders")?.evidence).toEqual(["cg_09 → pictures/cg_09/"]);
    expect(find(report, "save-path")).toMatchObject({ status: "auto-fixed", evidence: ["BaseAt www", "RelatedName save2"] });
    expect(find(report, "menu-common-events")?.evidence).toEqual(["메뉴: 커먼 이벤트 1(메뉴 그림)"]);
    expect(find(report, "spawned-events")?.evidence).toEqual(["EventReSpawn"]);
    expect(find(report, "battle-log")?.status).toBe("auto-fixed");
  });

  it("finds missing picture files but resolves classified sub-folders", () => {
    const f = find(report, "missing-pictures");
    expect(f?.status).toBe("unknown");
    expect(f?.evidence).toEqual(["missing_one (맵 1 이벤트 3(적2) p1)"]);
  });

  it("a picture missing from the whole game (all img/ folders) is only reported as ok", () => {
    const nowhere = diagnoseGame(g.data, g.plugins, { ...g.files, others: ["Actor1"] }, null, { pluginSources: g.pluginSources, adapters: g.adapters });
    expect(find(nowhere, "missing-pictures")).toMatchObject({
      status: "ok", title: "게임 폴더에 없는 그림 1개",
      evidence: ["missing_one (맵 1 이벤트 3(적2) p1)"],
    });
    // the same name in another img/ folder (or a pictures sub-folder) may be read from there by a plugin
    const elsewhere = diagnoseGame(g.data, g.plugins, { ...g.files, others: ["missing_one"] }, null, { pluginSources: g.pluginSources, adapters: g.adapters });
    expect(find(elsewhere, "missing-pictures")?.status).toBe("unknown");
    const sub = diagnoseGame(g.data, g.plugins, { pictures: [...g.files.pictures, "x/missing_one"], others: [] }, null, { pluginSources: g.pluginSources, adapters: g.adapters });
    expect(find(sub, "missing-pictures")?.status).toBe("unknown");
  });

  it("recommends add-ons and the matching adapter (not other adapters)", () => {
    expect(find(report, "layered-stands")).toMatchObject({ status: "needs-addon", action: { kind: "enable-addon", addon: "screenPictures" } });
    expect(find(report, "cutins")?.evidence).toContain("그림 Actor1_CutIn");
    expect(find(report, "notices")).toMatchObject({ area: "알림", status: "needs-addon", evidence: ["Ticker"] });
    expect(find(report, "html-overlay")?.evidence).toEqual(["HtmlPopup"]);
    expect(find(report, "plugin-sprites")?.evidence).toEqual(["MysteryHud"]);
    expect(find(report, "adapter:character-picture-manager")).toMatchObject({ status: "needs-addon", action: { kind: "enable-adapter", adapter: "character-picture-manager" } });
    expect(find(report, "adapter:other-game")).toBeUndefined();
    expect(recommendedActions(report)).toEqual([
      { kind: "enable-adapter", adapter: "character-picture-manager" },
      { kind: "enable-addon", addon: "screenPictures" },
      { kind: "enable-addon", addon: "notices" },
    ]);
  });

  it("finds battles through shared common events and random encounters", () => {
    expect(find(report, "battle-common")?.evidence).toEqual(["커먼 이벤트 3(전투 시작) — 2곳에서 부름"]);
    expect(find(report, "random-encounters")?.status).toBe("ok");
  });

  it("lists unknown plugins with keywords and functions, skipping quiet and disabled ones", () => {
    expect(report.unknownPlugins.map(p => p.name)).toEqual(["MysteryHud", "HtmlPopup"]);
    const hud = report.unknownPlugins[0];
    expect(hud.keywords).toEqual(expect.arrayContaining(["ImageManager.loadPicture", "new Sprite", "blt", "Scene_", "BattleManager"]));
    expect(hud.functions).toEqual(expect.arrayContaining(["Sprite_Hud.prototype.refresh", "BattleManager.startBattle"]));
    expect(find(report, "custom-scenes")?.evidence).toEqual(["MysteryHud: Scene_Gallery"]);
    expect(find(report, "battle-plugins")?.evidence).toEqual(["MysteryHud"]);
    expect(find(report, "unknown-plugins")?.status).toBe("unknown");
  });

  it("does not recommend what is already on", () => {
    const on = diagnoseGame(g.data, g.plugins, g.files, null, {
      pluginSources: g.pluginSources, adapters: g.adapters,
      settings: { addons: { screenPictures: true, notices: true }, adapters: { "character-picture-manager": true } },
    });
    expect(recommendedActions(on)).toEqual([]);
    expect(find(on, "layered-stands")?.status).toBe("auto-fixed");
    expect(find(on, "adapter:character-picture-manager")?.status).toBe("auto-fixed");
    expect(attentionCount(on)).toBeLessThan(attentionCount(report));
  });

  it("orders findings by area and renders a stable markdown report", () => {
    const areas = report.findings.map(f => f.area);
    expect(areas.indexOf("그림")).toBeLessThan(areas.indexOf("기타"));
    expect(reportMarkdown(report)).toMatchSnapshot();
  });
});

describe("diagnoseGame with a play log", () => {
  const g = dopLike();
  const base = { v: 1 as const, t: 0, run: 1, branch: 1 };
  let seq = 0;
  const rec = (r: Record<string, unknown>) => ({ ...base, seq: ++seq, ...r }) as LogRecord;
  const log: LogRecord[] = [
    rec({ type: "message", src: null, cmd: 0, face: "", faceIndex: 0, speaker: "", text: "a", sw: 1280, sh: 720,
      pics: [[1000, "actor01_cutin_A_0001", 0, 0, 0, 100, 100, 255, 0, null, 0, 0, 0, "sprite"], [1001, "mystery_layer", 0, 0, 0, 100, 100, 255, 0, null, 0, 0, 0, "sprite"]] }),
    rec({ type: "picture", src: null, cmd: 0, pictureId: 5, name: "ghost_pic" }),
    ...Array.from({ length: 6 }, () => rec({ type: "plugin", src: null, cmd: 0, code: 356, text: "WeirdCmd on", name: "WeirdCmd" })),
    rec({ type: "plugin", src: null, cmd: 0, code: 356, text: "CallStand 1", name: "CallStand" }),
    rec({ type: "battle", phase: "start", troopId: 1 }),
    rec({ type: "battle", phase: "end", troopId: 1, result: "win" }),
  ];
  const report = diagnoseGame(g.data, g.plugins, g.files, log, { pluginSources: g.pluginSources, adapters: g.adapters });

  it("counts the runs a 1.24.0+ plugin left out of a frequent plugin command (skipped)", () => {
    const freq: LogRecord[] = [
      rec({ type: "plugin", src: null, cmd: 0, code: 356, text: "CulPartLV 1102", name: "CulPartLV" }),
      rec({ type: "plugin", src: null, cmd: 0, code: 356, text: "CulPartLV 1102", name: "CulPartLV", skipped: 40 }),
      rec({ type: "plugin", src: null, cmd: 0, code: 356, text: "Rare 1", name: "Rare", skipped: "x" }),
    ];
    const r = diagnoseGame(g.data, g.plugins, g.files, freq, { pluginSources: g.pluginSources, adapters: g.adapters });
    expect(find(r, "log-plugin-commands")?.evidence).toEqual(["CulPartLV ×42"]);
  });

  it("checks log pictures, plugin commands, sprite roles and battle lines", () => {
    expect(find(report, "log-missing-pictures")).toMatchObject({ status: "needs-addon", action: { kind: "none" }, evidence: ["ghost_pic ×1"] });
    expect(find(report, "log-plugin-commands")?.evidence).toEqual(["WeirdCmd ×6"]);
    expect(find(report, "log-sprite-roles:stand")).toMatchObject({
      status: "needs-addon", action: { kind: "set-role", target: "sprite", keys: ["actor01_cutin_A"], role: "stand" },
    });
    expect(find(report, "log-sprite-unknown")?.evidence).toEqual(["mystery_layer"]);
    expect(find(report, "log-no-battle-lines")?.status).toBe("unknown");
    expect(report.used).toEqual({ log: true, files: true, pluginSources: true, logRecords: log.length });
  });

  it("pictures drawn in play whose file is missing are packed in the game; copies made by the plugin show them", () => {
    const packed: LogRecord[] = [
      rec({ type: "screen", scene: "map", pics: [[71, "missing_one", 1, 270, 300, 100, 100, 255, 0, 0, 0, 575, 375]] }),
      rec({ type: "picture", src: null, cmd: 0, pictureId: 5, name: "ghost_pic" }),
    ];
    const files = { ...g.files, others: ["Actor1"] };
    const opts = { pluginSources: g.pluginSources, adapters: g.adapters };
    // no copies yet: the new plugin copies them once they are shown again
    const old = diagnoseGame(g.data, g.plugins, files, packed, opts);
    expect(find(old, "log-missing-pictures")).toMatchObject({
      status: "needs-addon", action: { kind: "none" }, title: "게임 안에 묶인 그림 2개 — 아직 읽기에서 안 보여요",
      evidence: ["missing_one ×1", "ghost_pic ×1"],
    });
    expect(find(old, "log-missing-pictures")?.detail).toContain("1.31.0 이상");
    expect(find(old, "log-missing-pictures")?.detail).toContain("다음에 게임을 켤 때");
    expect(recommendedActions(old).some(a => a.kind === "none")).toBe(false);
    // the static rule no longer says the game lacks it; it points at the ones seen in play
    const stat = find(old, "missing-pictures")!;
    expect(stat).toMatchObject({ status: "ok", title: "게임 폴더에 없는 그림 1개" });
    expect(stat.detail).not.toContain("고칠 것은 없어요");
    expect(stat.evidence[0]).toBe("플레이 중에 보인 그림 1개 — 게임 안에 묶여 있어요");
    // one copied (names match case-insensitively): only the other is left
    const newer = diagnoseGame(g.data, g.plugins, { ...files, copies: ["MISSING_ONE"] }, packed, opts);
    expect(find(newer, "log-missing-pictures")).toMatchObject({ status: "needs-addon", evidence: ["ghost_pic ×1"] });
    expect(find(newer, "log-missing-pictures")?.detail).toContain("1개는 이미 복사해 뒀어요");
    expect(find(newer, "missing-pictures")).toMatchObject({ status: "ok", title: "이벤트 그림을 모두 찾았어요" });
    // every one copied: handled
    const all = diagnoseGame(g.data, g.plugins, { ...files, copies: ["missing_one", "ghost_pic"] }, packed, opts);
    expect(find(all, "log-missing-pictures")).toMatchObject({
      status: "auto-fixed", title: "게임 안에 묶인 그림 2개", detail: "게임 안에 묶인 그림을 기록 플러그인이 복사해 둬서 보여줘요.",
    });
  });

  it("pictureWants lists event and play-log pictures missing from the folder, minus copies", () => {
    const data = { ...g.data, pictureFolders: [{ token: "cg_09", folder: "cg_09" }] };
    const drawn = [rec({ type: "picture", src: null, cmd: 0, pictureId: 5, name: "ghost_pic" })];
    expect(pictureWants(data, g.files, drawn)).toEqual(["ghost_pic", "missing_one"]);
    expect(pictureWants(data, { ...g.files, copies: ["Missing_One"] }, drawn)).toEqual(["ghost_pic"]);
    expect(pictureWants(data, null, drawn)).toEqual([]);
    expect(pictureWantsText(["a"])).toBe('{"v":1,"pictures":["a"]}\n');
  });

  it("gathers the plugin's picture copies from rpg-viewer/pictures", async () => {
    const folder = new MemoryFolder({
      "www/data/System.json": "{}",
      "www/img/pictures/a.png": new Uint8Array(0),
      "www/rpg-viewer/pictures/cut.png": new Uint8Array(0),
      "www/rpg-viewer/pictures/sub/b.png": new Uint8Array(0),
      "www/rpg-viewer/pictures/note.txt": "x",
    });
    const input = await gatherDiagnosisInput(folder, g.data);
    expect(input.files?.copies?.sort()).toEqual(["cut", "sub/b"]);
  });

  it("reports missing battles only after enough play", () => {
    const many: LogRecord[] = [
      ...Array.from({ length: 400 }, (_, i) => rec({ type: "state", src: null, cmd: null, changes: [{ kind: "switch", id: i, value: true }] })),
      ...Array.from({ length: 3 }, () => rec({ type: "transfer", mapId: 1, x: 0, y: 0 })),
    ];
    expect(find(diagnoseGame(g.data, g.plugins, g.files, many), "log-no-battles")?.status).toBe("unknown");
    expect(find(diagnoseGame(g.data, g.plugins, g.files, many.slice(0, 10)), "log-no-battles")).toBeUndefined();
  });
});

describe("plain games and bad input", () => {
  it("a plain MZ game has nothing to check", () => {
    const data = game({ engine: "MZ", dataRoot: "data", imgRoot: "img", system: {
      gameTitle: "평범", currencyUnit: "G", switches: [], variables: [], advanced: { screenWidth: 816, screenHeight: 624 },
    } });
    const r = diagnoseGame(data, formatPluginsJs([]), { pictures: [] }, null, {});
    expect(attentionCount(r)).toBe(0);
    expect(find(r, "screen-size")?.status).toBe("ok");
  });

  it("never throws", () => {
    expect(() => diagnoseGame(null as unknown as GameData, null)).not.toThrow();
    expect(diagnoseGame({} as GameData, "garbage", { pictures: null as unknown as string[] }, [null as unknown as LogRecord]).v).toBe(1);
    expect(reportMarkdown({} as DiagnosisReport)).toContain("게임 진단");
    expect(recommendedActions(null)).toEqual([]);
    expect(scanPluginSource(null).keywords).toEqual([]);
  });
});

describe("gatherDiagnosisInput", () => {
  it("reads plugins.js, enabled plugin sources, pictures (with sub-folders), the log and settings — read-only", async () => {
    const folder = new MemoryFolder({
      "www/data/System.json": "{}",
      "www/js/plugins.js": formatPluginsJs([plugin("A"), plugin("B", {}, false), plugin("RPGViewerBridge")]),
      "www/js/plugins/A.js": "var x = new Sprite();",
      "www/js/plugins/B.js": "nope",
      "www/img/pictures/one.png": "x",
      "www/img/pictures/two.rpgmvp": "x",
      "www/img/pictures/cg_09/three.png_": "x",
      "www/img/faces/Actor1.png": "x",
      "www/img/system/deep/Window.png": "x",
      "www/rpg-viewer/log.jsonl": '{"v":1,"seq":1,"t":0,"run":1,"branch":1,"type":"save","slot":1}\nbroken\n',
      "www/rpg-viewer/addons.json": JSON.stringify({ v: 1, enabled: { notices: true }, adapters: { "x-y": true } }),
    });
    const before = JSON.stringify(await folder.list("www"));
    const g = await gatherDiagnosisInput(folder, game(), { readLog: true });
    expect(Object.keys(g.pluginSources)).toEqual(["A"]);
    expect(g.files?.pictures.sort()).toEqual(["cg_09/three", "one", "two"]);
    expect(g.files?.others?.sort()).toEqual(["Actor1", "Window"]);
    expect(g.log).toHaveLength(1);
    expect(settingsOfAddonFile(g.addonFile)).toEqual({ addons: { notices: true }, adapters: { "x-y": true } });
    expect(JSON.stringify(await folder.list("www"))).toBe(before);
    expect(parseLogText(null)).toEqual([]);
  });
});
