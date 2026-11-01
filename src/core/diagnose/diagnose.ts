// 게임 자동 진단: 데이터·plugins.js·플러그인 본문(글)·그림 목록·플레이 기록을 훑어 이 게임에서 특별한 것과 뷰어가 할 일을 찾는다.
// 순수 함수, 예외를 던지지 않는다. 게임 코드는 실행하지 않고 글로만 읽는다.
import type { AddonId } from "../addons/registry";
import { noticePluginsOf } from "../addons/notices";
import { DEFAULT_SCREEN, parsePics, screenSizeMarks, screenSizeOf, spriteKeyOf, type PictureRole } from "../addons/screenPictures";
import { enabledPluginsOf, matchingAdapters, roleDefaultsOf, spritePatternMatches, type AdapterManifest } from "../adapters/manifest";
import { classifiedName, pictureFolderRulesFromPlugins, type FolderRule } from "../assets/pictureFolders";
import { pluginStartsBattle } from "../live/enemies";
import { parsePluginsJs, type PluginEntry } from "../live/installer";
import { commonEventCallCount } from "../live/mapScan";
import { afterMenuCommonEventFromPlugins, menuCommonEventIdsFromPlugins } from "../live/menuScenes";
import { hasLayeredPictures, LAYERED_RUN } from "../live/pictureStack";
import type { LogRecord } from "../live/types";
import { templateMapIdFromPlugins } from "../loader/templateEvent";
import type { EventCommand, GameData } from "../types";
import { isKnownPlugin, scanPluginSource, unknownPluginsOf, type PluginScan } from "./knowledge";
import {
  DIAGNOSE_AREAS, type DiagnoseArea, type DiagnoseExtra, type DiagnoseFinding, type DiagnosisReport, type ImageListing,
} from "./types";

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const EVIDENCE_MAX = 12;
const cap = (list: string[], max = EVIDENCE_MAX): string[] =>
  list.length > max ? [...list.slice(0, max), `…외 ${list.length - max}개`] : list;

/** 명령 목록 하나와 그 위치(근거에 쓴다) */
interface ListAt { label: string; list: EventCommand[] }

function* allLists(data: GameData): Generator<ListAt> {
  if (data.maps instanceof Map) {
    for (const [mapId, map] of data.maps) {
      for (const ev of arr<any>(map?.events)) {
        if (!isObj(ev)) continue;
        const who = `맵 ${mapId} 이벤트 ${ev.id}${typeof ev.name === "string" && ev.name ? `(${ev.name})` : ""}`;
        for (const [i, pg] of arr<any>(ev.pages).entries()) if (isObj(pg)) yield { label: `${who} p${i + 1}`, list: arr(pg.list) };
        for (const [i, pg] of arr<any>(ev.originalPages).entries()) if (isObj(pg)) yield { label: `${who} 원래 p${i + 1}`, list: arr(pg.list) };
      }
    }
  }
  for (const ce of arr<any>(data.commonEvents)) {
    if (isObj(ce)) yield { label: `커먼 이벤트 ${ce.id}${typeof ce.name === "string" && ce.name ? `(${ce.name})` : ""}`, list: arr(ce.list) };
  }
  for (const tr of arr<any>(data.troops)) {
    if (!isObj(tr)) continue;
    for (const [i, pg] of arr<any>(tr.pages).entries()) if (isObj(pg)) yield { label: `적 그룹 ${tr.id} p${i + 1}`, list: arr(pg.list) };
  }
}

const CUTIN_NAME = /cut-?in|finish_?blow|カットイン|컷인/i;

/** 데이터의 명령을 한 번 훑은 결과 */
interface StaticScan {
  /** Show Picture(231) 그림 이름 → 처음 나온 위치 */
  pictureRefs: Map<string, string>;
  /** 대사 하나 사이에 그림 LAYERED_RUN장 이상을 띄우는 곳 */
  layeredSpots: string[];
  /** 화면 전체(0,0 왼쪽 위, 100%)에 띄우는 그림 표시 수 */
  fullCanvas: number;
  /** 컷인 같은 이름의 그림 */
  cutinNames: Set<string>;
  /** 대사 없이 띄웠다 지우는 그림(컷인 모양)이 있는 곳 */
  showEraseSpots: string[];
  /** 전투 처리(301) 수 */
  battles: number;
  /** 전투를 시작하는 커먼 이벤트 id */
  battleCommons: Set<number>;
}

function scanCommands(data: GameData): StaticScan {
  const s: StaticScan = {
    pictureRefs: new Map(), layeredSpots: [], fullCanvas: 0, cutinNames: new Set(), showEraseSpots: [], battles: 0, battleCommons: new Set(),
  };
  try {
    for (const { label, list } of allLists(data)) {
      let run = 0;
      let showEraseHere = false;
      const shown = new Set<number>();
      for (const c of list) {
        if (!isObj(c)) continue;
        const p = arr<unknown>(c.parameters);
        if (c.code === 101 || c.code === 102 || c.code === 105) { run = 0; shown.clear(); continue; }
        if (c.code === 231) {
          const name = typeof p[1] === "string" ? p[1] : "";
          if (name === "") continue;
          if (!s.pictureRefs.has(name)) s.pictureRefs.set(name, label);
          if (CUTIN_NAME.test(name)) s.cutinNames.add(name);
          if (++run === LAYERED_RUN) s.layeredSpots.push(label);
          if (p[2] === 0 && p[3] === 0 && p[4] === 0 && p[5] === 0 && p[6] === 100 && p[7] === 100) s.fullCanvas++;
          if (typeof p[0] === "number") shown.add(p[0]);
        } else if (c.code === 235) {
          if (typeof p[0] === "number" && shown.has(p[0])) { showEraseHere = true; shown.delete(p[0]); }
        } else if (c.code === 301 || ((c.code === 356 || c.code === 357) && pluginStartsBattle(c as EventCommand))) {
          s.battles++;
          const m = /^커먼 이벤트 (\d+)/.exec(label);
          if (m) s.battleCommons.add(Number(m[1]));
        }
      }
      if (showEraseHere) s.showEraseSpots.push(label);
    }
  } catch { /* 본 데까지 */ }
  return s;
}

/** 그림 이름이 그림 목록(names)에 있는가(BY_PictureClassify 하위 폴더 규칙 포함, 대소문자 무시) */
function pictureResolver(names: unknown, rules: readonly FolderRule[]): (name: string) => boolean {
  const have = new Set(arr<string>(names).map(n => String(n).toLowerCase()));
  return (name: string) => {
    const n = name.toLowerCase();
    if (have.has(n)) return true;
    const moved = classifiedName(name, rules);
    return moved !== null && have.has(moved.toLowerCase());
  };
}

/** 게임 폴더에 파일이 없는 그림을 기록 플러그인이 복사해 두기 시작한 버전(rpg-viewer/pictures/<이름>.png) */
export const PICTURE_COPY_MIN_VERSION = "1.31.0";

/** 플레이 기록에서 게임이 띄운 그림 이름 → 횟수(그림 기록과 화면 그림, 플러그인 그림은 빼고) */
function drawnPictureNames(records: readonly unknown[]): Map<string, number> {
  const names = new Map<string, number>();
  const add = (n: string) => names.set(n, (names.get(n) ?? 0) + 1);
  for (const r of records) {
    if (!isObj(r)) continue;
    if (r.type === "picture" && r.op === undefined && typeof r.name === "string" && r.name) add(r.name);
    const pics = (r as { pics?: unknown }).pics;
    if (pics !== undefined) for (const p of parsePics(pics) ?? []) if (p.kind !== "sprite") add(p.name);
  }
  return names;
}


/**
 * 그림 이름(폴더 뺀 끝 이름)이 img/ 어디에도 없는가(pictures 하위 폴더 포함, 대소문자 무시).
 * 다른 폴더 목록(others)을 보지 않았으면 null — 판단하지 않는다.
 */
function absentFromGame(files: ImageListing): ((name: string) => boolean) | null {
  if (!Array.isArray(files.others)) return null;
  const base = (n: string) => n.slice(n.lastIndexOf("/") + 1).toLowerCase();
  const have = new Set([...arr<string>(files.pictures), ...files.others].map(n => base(String(n))));
  return (name: string) => !have.has(base(name));
}

/** 플러그인 명령 기록의 이름 열쇠(MZ: 플러그인:명령, MV: 첫 낱말) */
function pluginCommandKey(r: Extract<LogRecord, { type: "plugin" }>): { key: string; plugin: string | null } {
  if (typeof r.plugin === "string" && r.plugin) return { key: `${r.plugin}:${r.name ?? ""}`, plugin: r.plugin };
  const name = typeof r.name === "string" && r.name ? r.name : (typeof r.text === "string" ? r.text.trim().split(/\s+/)[0] ?? "" : "");
  return { key: name, plugin: null };
}

/** 뷰어가 아는 MV 플러그인 명령 첫 낱말 */
const KNOWN_COMMANDS = new Set(["te固有イベント呼び出し", "te_call_origin_event", "te_call_map_event", "callstand", "callcutin", "ticker"]);

/** 이름으로 짐작한 플러그인 그림 구분 */
function guessSpriteRole(name: string): PictureRole | null {
  if (/cut-?in|tachie|stand|bust|立ち絵|스탠딩|portrait/i.test(name)) return "stand";
  if (/\bhud\b|gauge|icon|frame|window|cursor|button|ui_|_ui\b/i.test(name)) return "hud";
  return null;
}

/** 이 플러그인 이름들을 켰는가(대소문자 무시) */
const hasPlugin = (enabled: readonly string[], name: string): boolean => enabled.some(p => p.toLowerCase() === name.toLowerCase());

/** 플러그인 파라미터에서 화면 크기를 정한 플러그인 이름 */
function screenSource(data: GameData, entries: PluginEntry[]): string | null {
  const adv = data.system?.advanced;
  if (isObj(adv) && typeof adv.screenWidth === "number") return "System.json(advanced)";
  for (const e of entries) {
    if (!isObj(e) || e.status !== true || !isObj(e.parameters)) continue;
    const keys = Object.keys(e.parameters).map(k => k.replace(/[\s_]/g, "").toLowerCase());
    if (keys.includes("screenwidth") && keys.includes("screenheight")) return `plugins.js ${e.name}`;
  }
  return null;
}

/**
 * 게임을 진단한다. pluginsText: js/plugins.js 본문(없으면 null), files: img/ 그림 목록(없으면 그림 파일 확인을 건너뜀),
 * log: 플레이 기록(없으면 기록 확인을 건너뜀), extra: 플러그인 본문·어댑터·지금 설정. 예외를 던지지 않는다.
 */
export function diagnoseGame(
  data: GameData, pluginsText: string | null | undefined, files?: ImageListing | null, log?: readonly LogRecord[] | null,
  extra?: DiagnoseExtra | null,
): DiagnosisReport {
  try {
    return run(data, pluginsText, files, log, extra ?? {});
  } catch {
    return {
      v: 1, gameTitle: String(data?.system?.gameTitle ?? ""), engine: String(data?.engine ?? ""), findings: [], unknownPlugins: [],
      used: { log: false, files: false, pluginSources: false, logRecords: 0 },
    };
  }
}

function run(
  data: GameData, pluginsText: string | null | undefined, files: ImageListing | null | undefined, log: readonly LogRecord[] | null | undefined,
  extra: DiagnoseExtra,
): DiagnosisReport {
  const findings: DiagnoseFinding[] = [];
  const report: DiagnosisReport = {
    v: 1, gameTitle: String(data?.system?.gameTitle ?? ""), engine: String(data?.engine ?? ""), findings, unknownPlugins: [],
    used: { log: Array.isArray(log), files: !!files, pluginSources: Object.keys(extra.pluginSources ?? {}).length > 0, logRecords: Array.isArray(log) ? log.length : 0 },
  };
  const push = (f: DiagnoseFinding) => { if (!findings.some(x => x.id === f.id)) findings.push(f); };
  const settings = extra.settings ?? {};
  const addonOn = (id: AddonId) => settings.addons?.[id] === true;
  /** 부가 기능을 켜면 되는 것: 이미 켰으면 자동 처리 */
  const addonFinding = (f: Omit<DiagnoseFinding, "status" | "action">, addon: AddonId): DiagnoseFinding =>
    addonOn(addon) ? { ...f, status: "auto-fixed" } : { ...f, status: "needs-addon", action: { kind: "enable-addon", addon } };
  const step = (fn: () => void) => { try { fn(); } catch { /* 이 확인만 건너뛴다 */ } };

  const text = typeof pluginsText === "string" ? pluginsText : null;
  const entries = text !== null ? parsePluginsJs(text) ?? [] : [];
  const enabled = text !== null ? enabledPluginsOf(text) : arr<string>(data?.enabledPlugins);
  const sources = extra.pluginSources ?? {};
  const scans = new Map<string, PluginScan>();
  for (const name of enabled) if (typeof sources[name] === "string") scans.set(name, scanPluginSource(sources[name]));
  const allAdapters: readonly AdapterManifest[] = Array.isArray(extra.adapters) ? extra.adapters : [];
  const adapterPlugins = allAdapters.flatMap(a => a?.match?.plugins ?? []);
  const matched = matchingAdapters(allAdapters, { plugins: enabled, gameTitle: data?.system?.gameTitle });
  const scan = scanCommands(data);
  const records = Array.isArray(log) ? log : [];

  // ---- 기타: 엔진 ----
  step(() => push({
    id: "engine", area: "기타", status: "ok", title: `${report.engine || "알 수 없는"} 게임`,
    detail: `RPG Maker ${report.engine} 게임이에요. 데이터는 ${data.dataRoot}, 그림은 ${data.imgRoot}에서 읽어요.`,
    evidence: [`데이터 ${data.dataRoot}`, `그림 ${data.imgRoot}`, `켜진 플러그인 ${enabled.length}개`],
  }));

  // ---- 화면 크기 ----
  step(() => {
    const size = text !== null ? screenSizeOf(data.system, text) : (data.screenSize ?? DEFAULT_SCREEN);
    const src = screenSource(data, entries);
    const marks = screenSizeMarks(records as LogRecord[]);
    const last = marks.length > 0 ? marks[marks.length - 1].size : null;
    const evidence = [`${size.width}×${size.height}${src ? ` (${src})` : " (기본)"}`];
    if (last) evidence.push(`게임이 알려준 크기 ${last.width}×${last.height}`);
    const odd = size.width !== DEFAULT_SCREEN.width || size.height !== DEFAULT_SCREEN.height;
    const differs = !!last && (last.width !== size.width || last.height !== size.height);
    push({
      id: "screen-size", area: "화면", status: odd || differs ? "auto-fixed" : "ok",
      title: differs ? "게임 화면 크기가 설정과 달라요" : odd ? `화면 크기 ${size.width}×${size.height}` : "기본 화면 크기",
      detail: differs
        ? "게임이 실행 중에 알려준 실제 크기로 그림 위치를 맞춰요."
        : odd ? "게임 화면이 기본(816×624)과 달라서, 그 크기에 맞춰 그림을 그려요." : "게임 화면이 기본 크기(816×624)예요.",
      evidence,
    });
  });

  // ---- 그림: 암호화 ----
  step(() => {
    if (data.system?.hasEncryptedImages) push({
      id: "encrypted-images", area: "그림", status: "auto-fixed", title: "그림이 암호화돼 있어요",
      detail: "게임 그림 파일이 잠겨 있지만, 뷰어가 풀어서 보여줘요.", evidence: ["System.json hasEncryptedImages"],
    });
  });

  // ---- 그림: 하위 폴더 규칙 ----
  const rules: FolderRule[] = text !== null ? pictureFolderRulesFromPlugins(text) : arr<FolderRule>(data?.pictureFolders);
  step(() => {
    if (rules.length > 0) push({
      id: "picture-folders", area: "그림", status: "auto-fixed", title: "그림을 하위 폴더에 나눠 둬요",
      detail: "그림 이름에 든 글자로 하위 폴더를 고르는 플러그인(BY_PictureClassify)을 따라 그림을 찾아요.",
      evidence: cap(rules.map(r => `${r.token} → pictures/${r.folder}/`)),
    });
  });

  // ---- 그림: 이벤트가 부르는 그림 파일 ----
  const resolves = files ? pictureResolver(files.pictures, rules) : null;
  // 기록 플러그인(1.31.0)이 복사해 둔 그림(rpg-viewer/pictures): 게임 실행 파일 안에 묶여 폴더에 없는 그림
  const copied = pictureResolver(files?.copies, rules);
  const drawn = drawnPictureNames(records);
  step(() => {
    if (!resolves || scan.pictureRefs.size === 0) return;
    const notOnDisk = [...scan.pictureRefs].filter(([name]) => !resolves(name));
    const missing = notOnDisk.filter(([name]) => !copied(name));
    const copiedNote = notOnDisk.length > missing.length ? ` 그중 ${notOnDisk.length - missing.length}개는 기록 플러그인이 복사해 둔 그림으로 보여줘요.` : "";
    const nowhere = files ? absentFromGame(files) : null;
    const shownLower = new Set([...drawn.keys()].map(n => n.toLowerCase()));
    const shown = missing.filter(([name]) => shownLower.has(name.toLowerCase())).length;
    push(missing.length === 0
      ? {
        id: "missing-pictures", area: "그림", status: "ok", title: "이벤트 그림을 모두 찾았어요",
        detail: `이벤트가 띄우는 그림 ${scan.pictureRefs.size}개를 모두 찾았어요.${copiedNote}`, evidence: [],
      }
      : nowhere && missing.every(([name]) => nowhere(name))
      ? {
        // img/ 어디에도 같은 이름이 없음: 게임에서 뺀 장면이거나 게임 실행 파일 안에 묶인 그림 — 알려주기만
        // (플레이 중에 보인 것은 아래 기록 항목이 따로 다룬다)
        id: "missing-pictures", area: "그림", status: "ok",
        title: `게임 폴더에 없는 그림 ${missing.length}개`,
        detail: "이벤트가 띄우는 그림인데 게임 폴더(img/ 아래 모든 폴더)에 같은 이름의 파일이 없어요. 게임에서 뺀 장면이거나, 게임 실행 파일 안에 묶여 있는 그림일 수 있어요. " +
          `묶인 그림은 게임에서 한 번 보이면 기록 플러그인(${PICTURE_COPY_MIN_VERSION} 이상)이 복사해 둬서 읽기에서도 보여요.${copiedNote}`,
        evidence: [
          ...(shown > 0 ? [`플레이 중에 보인 그림 ${shown}개 — 게임 안에 묶여 있어요`] : []),
          ...cap(missing.map(([name, at]) => `${name} (${at})`)),
        ],
      }
      : {
        id: "missing-pictures", area: "그림", status: "unknown", title: `이벤트 그림 ${missing.length}개를 찾지 못했어요`,
        detail: "이벤트가 띄우는 그림이 img/pictures에 없어요. 게임에서 빠진 파일이거나, 플러그인이 다른 폴더에서 읽는 것일 수 있어요.",
        evidence: cap(missing.map(([name, at]) => `${name} (${at})`)),
      });
  });

  // ---- 세이브 ----
  step(() => {
    const spr = entries.find(e => isObj(e) && e.status === true && e.name === "SavePathRelocation");
    if (spr) {
      const params = isObj(spr.parameters) ? spr.parameters : {};
      push({
        id: "save-path", area: "세이브", status: "auto-fixed", title: "세이브 폴더를 옮겨요",
        detail: "SavePathRelocation이 세이브 파일을 다른 폴더에 둬요. 세이브 백업이 그 폴더를 따라가요.",
        evidence: [`BaseAt ${String(params.BaseAt ?? "exe")}`, `RelatedName ${String(params.RelatedName ?? "save")}`],
      });
    }
    const others = [...scans].filter(([n, s]) => s.save && !isKnownPlugin(n, adapterPlugins)).map(([n]) => n);
    if (others.length > 0) push({
      id: "save-plugins", area: "세이브", status: "unknown", title: "세이브 방식을 바꾸는 플러그인",
      detail: "세이브 위치나 방식을 바꾸는 것 같은 플러그인이 있어요. 세이브 백업이 맞는 폴더를 찾는지 확인이 필요해요.",
      evidence: cap(others),
    });
  });

  // ---- 이벤트: 템플릿 이벤트·만든 이벤트 ----
  step(() => {
    const tpl = text !== null ? templateMapIdFromPlugins(text) : (data.templateMapId ?? null);
    if (tpl === null) return;
    push(data.templateMapId !== undefined
      ? {
        id: "template-event", area: "이벤트", status: "auto-fixed", title: "템플릿 이벤트를 써요",
        detail: "TemplateEvent가 다른 맵의 이벤트를 본떠 쓰는 것을 풀어서, 원래 대사와 조건을 보여줘요.",
        evidence: [`템플릿 맵 ${data.templateMapId}`],
      }
      : {
        id: "template-event", area: "이벤트", status: "unknown", title: "템플릿 맵을 읽지 못했어요",
        detail: "TemplateEvent가 켜져 있는데 템플릿 맵을 찾지 못했어요. 템플릿을 쓰는 이벤트가 비어 보일 수 있어요.",
        evidence: [`템플릿 맵 ${tpl}`],
      });
  });
  step(() => {
    const spawners = enabled.filter(n => /respawn|spawn|prefab|copy_?event|event_?copy|dynamic_?event/i.test(n));
    if (spawners.length > 0) push({
      id: "spawned-events", area: "이벤트", status: "auto-fixed", title: "게임 중에 이벤트를 만들어요",
      detail: "플레이 중에 새로 생기는 이벤트의 원본을 기록 플러그인(1.16.0 이상)이 알려줘서, 그 이벤트의 대사도 보여줘요.",
      evidence: spawners,
    });
  });

  // ---- 메뉴 ----
  step(() => {
    const menu = text !== null ? menuCommonEventIdsFromPlugins(text) : arr<number>(data.menuCommonEvents);
    const after = text !== null ? afterMenuCommonEventFromPlugins(text) : (data.afterMenuCommonEvent ?? null);
    if (menu.length === 0 && after === null) return;
    const ceName = (id: number) => {
      const ce = arr<any>(data.commonEvents)[id];
      return isObj(ce) && typeof ce.name === "string" && ce.name ? `커먼 이벤트 ${id}(${ce.name})` : `커먼 이벤트 ${id}`;
    };
    push({
      id: "menu-common-events", area: "메뉴", status: "auto-fixed", title: "메뉴 화면에서 커먼 이벤트를 돌려요",
      detail: "메뉴를 열었을 때 도는 커먼 이벤트의 그림·대사를 이야기와 섞지 않고 따로 다뤄요.",
      evidence: [...menu.map(id => `메뉴: ${ceName(id)}`), ...(after !== null ? [`메뉴 닫은 뒤: ${ceName(after)}`] : [])],
    });
  });
  step(() => {
    const scenes: string[] = [];
    for (const [n, s] of scans) if (!isKnownPlugin(n, adapterPlugins)) for (const sc of s.customScenes) scenes.push(`${n}: ${sc}`);
    if (scenes.length > 0) push({
      id: "custom-scenes", area: "메뉴", status: "unknown", title: "게임만의 화면이 있어요",
      detail: "엔진에 없는 화면(도감·회상·옷 갈아입기 등)을 플러그인이 만들어요. 그 화면의 그림·글은 아직 따로 기록하지 않을 수 있어요.",
      evidence: cap(scenes),
    });
  });

  // ---- 게임 전용 어댑터 ----
  step(() => {
    for (const m of matched) {
      const on = settings.adapters?.[m.id] === true;
      const addons = m.defaults?.addons ?? {};
      const area: DiagnoseArea = addons.notices && !addons.screenPictures ? "알림" : addons.screenPictures || m.defaults?.spriteRoles ? "스탠딩" : "기타";
      push({
        id: `adapter:${m.id}`, area, status: on ? "auto-fixed" : "needs-addon",
        title: on ? `이 게임 전용 설정 켜짐: ${m.label}` : `이 게임 전용 설정이 있어요: ${m.label}`,
        detail: m.description || "이 게임에 맞춘 설정이에요.",
        evidence: [...(m.match.plugins ?? []).map(p => `플러그인 ${p}`), ...(m.match.gameTitle ?? []).map(t => `제목 ${t}`)],
        ...(on ? {} : { action: { kind: "enable-adapter", adapter: m.id } as const }),
      });
    }
  });

  // ---- 알림 ----
  step(() => {
    const notice = text !== null ? noticePluginsOf(text) : arr<string>(data.noticePlugins);
    if (notice.length > 0) push(addonFinding({
      id: "notices", area: "알림", title: "화면에 잠깐 뜨는 알림이 있어요",
      detail: "티커·코멘트·토스트·업적 같은 알림 문구를 기록하면 읽기와 전투 기록에 같이 보여줘요.", evidence: notice,
    }, "notices"));
    const html = [...scans].filter(([n, s]) => s.html && !hasPlugin(notice, n)).map(([n]) => n);
    if (html.length > 0) push(addonFinding({
      id: "html-overlay", area: "알림", title: "게임 화면 위에 HTML 글을 띄워요",
      detail: "플러그인이 게임 위에 웹 글자를 띄워요. 알림 문구 기록(기록 플러그인 1.19.0 이상)이 그 글도 모아요.", evidence: cap(html),
    }, "notices"));
  });

  // ---- 전투 ----
  step(() => {
    if (hasPlugin(enabled, "YEP_BattleEngineCore")) push({
      id: "battle-log", area: "전투", status: "auto-fixed", title: "전투 로그 플러그인(YEP)",
      detail: "YEP_BattleEngineCore가 전투 로그를 기술 이름만 보이게 바꿔요. 기록 플러그인이 누가 무엇을 썼는지 따로 남겨요.",
      evidence: ["YEP_BattleEngineCore"],
    });
    const battleSys = [...scans].filter(([n, s]) => s.battle && !isKnownPlugin(n, adapterPlugins)).map(([n]) => n);
    if (battleSys.length > 0) push({
      id: "battle-plugins", area: "전투", status: "unknown", title: "전투 진행을 바꾸는 플러그인",
      detail: "전투 방식을 바꾸는 플러그인이 있어요. 전투 기록(시작·끝·로그)이 제대로 남는지 플레이 뒤 다시 진단해 보세요.",
      evidence: cap(battleSys),
    });
    const shared = [...scan.battleCommons].map(id => ({ id, n: commonEventCallCount(data, id) })).filter(x => x.n >= 2);
    if (shared.length > 0) push({
      id: "battle-common", area: "전투", status: "auto-fixed", title: "커먼 이벤트로 전투를 시작해요",
      detail: "여러 이벤트가 같은 커먼 이벤트를 불러 전투를 걸어요. 뷰어가 커먼 이벤트 안까지 따라가 적을 찾아요.",
      evidence: cap(shared.map(x => {
        const ce = arr<any>(data.commonEvents)[x.id];
        return `커먼 이벤트 ${x.id}${isObj(ce) && ce.name ? `(${ce.name})` : ""} — ${x.n}곳에서 부름`;
      })),
    });
    const encounterMaps = data.maps instanceof Map ? [...data.maps].filter(([, m]) => (m?.encounterList?.length ?? 0) > 0) : [];
    if (encounterMaps.length > 0) push({
      id: "random-encounters", area: "전투", status: "ok", title: `랜덤 인카운트 맵 ${encounterMaps.length}개`,
      detail: "걸어 다니면 적이 나오는 맵이에요. 이 맵 화면에서 나오는 적을 보여줘요.",
      evidence: cap(encounterMaps.map(([id, m]) => `맵 ${id}${m.displayName ? `(${m.displayName})` : ""}`)),
    });
  });

  // ---- 스탠딩: 그림 겹치기 ----
  step(() => {
    const fromLog = records.length > 0 && hasLayeredPictures(records as LogRecord[]);
    if (scan.layeredSpots.length < 2 && !fromLog) return;
    push(addonFinding({
      id: "layered-stands", area: "스탠딩", title: "그림 여러 장을 겹쳐 캐릭터를 그려요",
      detail: "대사 하나 사이에 그림을 여러 장(몸·표정·옷) 띄워 캐릭터를 만들어요. 화면 그림 따라 그리기를 켜면 읽기에서 그 모습 그대로 보여줘요.",
      evidence: [
        ...cap([...new Set(scan.layeredSpots)], 8),
        ...(scan.fullCanvas > 0 ? [`화면 전체 크기로 겹치는 그림 표시 ${scan.fullCanvas}번`] : []),
        ...(fromLog ? ["플레이 기록에서도 겹친 그림을 봤어요"] : []),
      ],
    }, "screenPictures"));
  });

  // ---- 컷인 ----
  step(() => {
    const cutinPlugin = enabled.filter(n => /cut-?in/i.test(n));
    if (scan.cutinNames.size === 0 && scan.showEraseSpots.length < 3 && cutinPlugin.length === 0) return;
    push(addonFinding({
      id: "cutins", area: "컷인", title: "컷인이 있어요",
      detail: "대사 사이에 잠깐 띄웠다 지우는 그림(컷인)이 있어요. 화면 그림 따라 그리기를 켜면 읽기에 그 장면이 남아요.",
      evidence: [
        ...cutinPlugin.map(n => `플러그인 ${n}`),
        ...cap([...scan.cutinNames], 6).map(n => `그림 ${n}`),
        ...(scan.showEraseSpots.length > 0 ? [`대사 없이 띄웠다 지우는 곳 ${scan.showEraseSpots.length}곳 (예: ${scan.showEraseSpots[0]})`] : []),
      ],
    }, "screenPictures"));
  });

  // ---- 스탠딩: 플러그인이 직접 그리는 그림 ----
  step(() => {
    const drawers = [...scans].filter(([, s]) => s.drawsSprites).map(([n]) => n);
    if (drawers.length > 0) push(addonFinding({
      id: "plugin-sprites", area: "스탠딩", title: "플러그인이 그림을 직접 그려요",
      detail: "이벤트 명령이 아니라 플러그인이 그림을 읽어 화면에 그려요. 화면 그림 따라 그리기를 켜면 기록 플러그인(1.10.0 이상)이 그 그림도 기록해요.",
      evidence: cap(drawers),
    }, "screenPictures"));
  });

  // ---- 플레이 기록 ----
  if (records.length > 0) {
    step(() => {
      if (!resolves) return;
      // 파일이 게임 폴더에 없는데 게임은 띄운 그림: 게임 실행 파일 안에 묶여 있다(가상 파일 시스템 등)
      const bad = [...drawn].filter(([n]) => !resolves(n)).sort((a, b) => b[1] - a[1]);
      if (bad.length === 0) return;
      const waiting = bad.filter(([n]) => !copied(n));
      const list = (l: [string, number][]) => cap(l.map(([n, c]) => `${n} ×${c}`));
      if (waiting.length === 0) {
        push({
          id: "log-missing-pictures", area: "그림", status: "auto-fixed", title: `게임 안에 묶인 그림 ${bad.length}개`,
          detail: "게임 안에 묶인 그림을 기록 플러그인이 복사해 둬서 보여줘요.",
          evidence: list(bad),
        });
        return;
      }
      // 기록에는 플러그인 버전이 없다: 새 버전으로 바꾸는 것과 다시 보는 것을 함께 안내한다
      const done = bad.length - waiting.length;
      push({
        id: "log-missing-pictures", area: "그림", status: "needs-addon", action: { kind: "none" },
        title: `게임 안에 묶인 그림 ${waiting.length}개 — 아직 읽기에서 안 보여요`,
        detail: "게임이 화면에 띄운 그림인데 게임 폴더에 파일이 없어요(게임 실행 파일 안에 묶여 있어요). " +
          `기록 플러그인이 새 버전(${PICTURE_COPY_MIN_VERSION} 이상)이면 게임에서 그 그림이 다시 보일 때 복사해 둬서 읽기에서도 보여요.` +
          (done > 0 ? ` ${done}개는 이미 복사해 뒀어요.` : ""),
        evidence: list(waiting),
      });
    });
    step(() => {
      const counts = new Map<string, number>();
      for (const r of records) {
        if (!isObj(r) || r.type !== "plugin") continue;
        const { key, plugin } = pluginCommandKey(r as Extract<LogRecord, { type: "plugin" }>);
        if (!key) continue;
        if (plugin ? isKnownPlugin(plugin, adapterPlugins) : KNOWN_COMMANDS.has(key.toLowerCase()) || isKnownPlugin(key, adapterPlugins)) continue;
        // 1.24.0: 잦은 명령은 1분에 한 번만 남고 빠진 실행 수(skipped)를 싣는다
        const skipped = (r as { skipped?: unknown }).skipped;
        const n = 1 + (typeof skipped === "number" && Number.isFinite(skipped) && skipped > 0 ? Math.floor(skipped) : 0);
        counts.set(key, (counts.get(key) ?? 0) + n);
      }
      const top = [...counts].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]).slice(0, 10);
      if (top.length > 0) push({
        id: "log-plugin-commands", area: "기타", status: "unknown", title: "자주 쓰는 모르는 플러그인 명령",
        detail: "이벤트가 자주 부르는 플러그인 명령인데 뷰어가 뜻을 몰라요. 대사·그림·전투와 관계있으면 어댑터가 필요할 수 있어요.",
        evidence: top.map(([k, n]) => `${k} ×${n}`),
      });
    });
    step(() => {
      const defaults = roleDefaultsOf(matched.filter(m => settings.adapters?.[m.id] === true));
      const unknownKeys = new Map<string, string>();
      for (const r of records) {
        if (!isObj(r) || (r.type !== "screen" && r.type !== "message" && r.type !== "battle" && r.type !== "battlelog" && r.type !== "choices")) continue;
        const pics = (r as { pics?: unknown }).pics;
        if (pics === undefined) continue;
        for (const p of parsePics(pics) ?? []) {
          if (p.kind !== "sprite" || p.tag?.role) continue;
          const key = spriteKeyOf(p.name);
          if (settings.spriteRoles?.[key] || unknownKeys.has(key)) continue;
          if (defaults.spriteRoles.some(rule => spritePatternMatches(rule.pattern, p.name))) continue;
          unknownKeys.set(key, p.name);
        }
      }
      if (unknownKeys.size === 0) return;
      const byRole = new Map<PictureRole, string[]>();
      const rest: string[] = [];
      for (const [key, name] of unknownKeys) {
        const role = guessSpriteRole(name);
        if (role) byRole.set(role, [...(byRole.get(role) ?? []), key]);
        else rest.push(key);
      }
      for (const [role, keys] of byRole) push({
        id: `log-sprite-roles:${role}`, area: "스탠딩", status: "needs-addon",
        title: role === "stand" ? "플러그인 그림을 스탠딩으로 보면 좋아요" : "플러그인 그림을 화면 장식으로 보면 좋아요",
        detail: "플러그인이 띄운 그림의 이름을 보고 구분을 짐작했어요. 적용하면 읽기에서 그 구분으로 보여요(게임 설정에서 바꿀 수 있어요).",
        evidence: cap(keys), action: { kind: "set-role", target: "sprite", keys: keys.slice(0, 100), role },
      });
      if (rest.length > 0) push({
        id: "log-sprite-unknown", area: "스탠딩", status: "unknown", title: `구분을 모르는 플러그인 그림 ${rest.length}개`,
        detail: "플러그인이 띄운 그림인데 스탠딩인지 장식인지 이름만으로는 모르겠어요. 게임 설정의 그림 구분에서 직접 고를 수 있어요.",
        evidence: cap(rest),
      });
    });
    step(() => {
      let battles = 0, lines = 0, transfers = 0;
      for (const r of records) {
        if (!isObj(r)) continue;
        if (r.type === "battle") battles++;
        else if (r.type === "battlelog") lines++;
        else if (r.type === "transfer") transfers++;
      }
      if (scan.battles > 0 && battles === 0 && records.length >= 300 && transfers >= 3) push({
        id: "log-no-battles", area: "전투", status: "unknown", title: "전투가 기록되지 않았어요",
        detail: "게임에 전투 명령이 있고 꽤 플레이했는데 전투 기록이 하나도 없어요. 아직 전투를 안 했거나, 플러그인이 전투를 다른 방식으로 해서 기록이 빠졌을 수 있어요.",
        evidence: [`전투 명령 ${scan.battles}개`, `기록 ${records.length}줄`, `장소 이동 ${transfers}번`],
      });
      else if (battles > 0 && lines === 0) push({
        id: "log-no-battle-lines", area: "전투", status: "unknown", title: "전투 로그가 남지 않았어요",
        detail: "전투 시작·끝은 기록됐는데 전투 중 글(누가 무엇을 썼는지)이 없어요. 전투 화면을 바꾸는 플러그인이 로그 창을 쓰지 않는 것일 수 있어요.",
        evidence: [`전투 ${battles}번`],
      });
    });
  }

  // ---- 모르는 플러그인 ----
  step(() => {
    report.unknownPlugins = unknownPluginsOf(enabled, extra.pluginSources, adapterPlugins);
    if (report.unknownPlugins.length > 0) push({
      id: "unknown-plugins", area: "기타", status: "unknown", title: `뷰어가 모르는 플러그인 ${report.unknownPlugins.length}개`,
      detail: "그림·알림·전투·화면·세이브를 건드리는 것 같은데 뷰어가 아직 모르는 플러그인이에요. 개발용 보고서를 복사해 Claude Code에 붙이면 어댑터를 만들 수 있어요.",
      evidence: cap(report.unknownPlugins.map(p => `${p.name} (${p.keywords.join(", ")})`)),
    });
  });

  // 묶음 순서대로(같은 묶음 안은 찾은 순서)
  const order = (a: DiagnoseArea) => DIAGNOSE_AREAS.indexOf(a);
  findings.sort((a, b) => order(a.area) - order(b.area));
  return report;
}
