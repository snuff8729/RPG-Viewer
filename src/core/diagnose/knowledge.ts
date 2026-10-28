import { KNOWN_NOTICE_APIS } from "../addons/notices";
import { PLUGIN_NAME } from "../live/installer";
import type { DiagnoseArea, UnknownPlugin } from "./types";

/**
 * 뷰어가 이미 아는(처리하거나 처리할 필요가 없는) 플러그인. 진단은 여기 없는 플러그인 중 그리기·알림·전투·화면·세이브를
 * 건드리는 것만 "모르는 플러그인"으로 보인다. 새 어댑터의 match.plugins도 아는 것으로 친다.
 */
export const KNOWN_PLUGINS: Readonly<Record<string, string>> = {
  TemplateEvent: "템플릿 이벤트를 풀어서 읽어요",
  EventReSpawn: "게임 중에 만든 이벤트의 원본을 기록해요(기록 플러그인 1.16.0+)",
  MenuCommonEvent: "메뉴 화면 커먼 이벤트를 알아봐요",
  CommonEventBeforeAfterMenu: "메뉴를 닫은 뒤 커먼 이벤트를 알아봐요",
  BY_PictureClassify: "그림 하위 폴더 규칙을 따라가요",
  SavePathRelocation: "바뀐 세이브 폴더를 따라가요",
  CharacterPictureManager: "스탠딩 어댑터가 있어요",
  YEP_CoreEngine: "화면 크기를 읽어요",
  Community_Basic: "화면 크기를 읽어요",
  YEP_BattleEngineCore: "전투 로그를 기술 이름으로 기록해요",
  CallStand: "어댑터가 있어요",
  CallCutin: "어댑터가 있어요",
  BYWorkElement: "어댑터가 있어요",
  BY_Cosplay: "어댑터가 있어요",
  BY_Scenes: "어댑터가 있어요",
  MadeWithMv: "시작 로고만 보여줘요",
  YEP_MessageCore: "대사 창 꾸미기",
};

/** 알림 문구 기록이 알아서 감싸는 플러그인 */
export const NOTICE_PLUGIN_NAMES: readonly string[] = [...new Set(KNOWN_NOTICE_APIS.flatMap(a => a.plugins))];

/** 이 플러그인 이름을 아는가(대소문자 무시). extra: 어댑터가 아는 이름 */
export function isKnownPlugin(name: string, extra: readonly string[] = []): boolean {
  const n = String(name ?? "").trim().toLowerCase();
  if (n === "") return true;
  if (n === PLUGIN_NAME.toLowerCase() || n.startsWith(`${PLUGIN_NAME.toLowerCase()}_`)) return true;
  if (Object.keys(KNOWN_PLUGINS).some(k => k.toLowerCase() === n)) return true;
  if (NOTICE_PLUGIN_NAMES.some(k => k.toLowerCase() === n)) return true;
  return extra.some(k => String(k).toLowerCase() === n);
}

/** 엔진에 원래 있는 화면(이것 말고 Scene_*을 만들면 게임만의 화면) */
export const STANDARD_SCENES: ReadonlySet<string> = new Set([
  "Scene_Base", "Scene_Boot", "Scene_Splash", "Scene_Title", "Scene_Map", "Scene_Message", "Scene_MenuBase", "Scene_Menu",
  "Scene_ItemBase", "Scene_Item", "Scene_Skill", "Scene_Equip", "Scene_Status", "Scene_Options", "Scene_File", "Scene_Save",
  "Scene_Load", "Scene_GameEnd", "Scene_Shop", "Scene_Name", "Scene_Debug", "Scene_Battle", "Scene_Gameover",
]);

/** 플러그인 본문에서 찾는 열쇠말과 그것이 가리키는 곳 */
const KEYWORDS: readonly { label: string; re: RegExp; area: DiagnoseArea }[] = [
  { label: "showPicture", re: /\bshowPicture\b/, area: "그림" },
  { label: "ImageManager.loadPicture", re: /ImageManager\.loadPicture\b/, area: "그림" },
  { label: "ImageManager.loadNormalBitmap", re: /ImageManager\.loadNormalBitmap\b/, area: "그림" },
  { label: "new Sprite", re: /new\s+Sprite(?:_\w+)?\s*\(/, area: "그림" },
  { label: "Bitmap", re: /new\s+Bitmap\s*\(|\bBitmap\.prototype\b/, area: "그림" },
  { label: "blt", re: /\.blt\s*\(/, area: "그림" },
  { label: "Scene_", re: /\bScene_\w+/, area: "화면" },
  { label: "jQuery/$", re: /\bjQuery\b|\$\(\s*['"<]|\$\.\w+\(/, area: "알림" },
  { label: "document.", re: /\bdocument\.(createElement|body|getElementById|querySelector)/, area: "알림" },
  { label: "StorageManager", re: /\bStorageManager\.\w+/, area: "세이브" },
  { label: "BattleManager", re: /\bBattleManager\.\w+/, area: "전투" },
  { label: "Window_", re: /\bWindow_\w+/, area: "화면" },
];

const FN_RE = /([A-Za-z_$][\w$]*(?:\.prototype)?\.[A-Za-z_$][\w$]*)\s*=\s*function\b/g;
const SCENE_DEF_RE = /(?:function\s+|class\s+|\bvar\s+|\blet\s+|\bconst\s+|(?:window|globalThis)\.)(Scene_\w+)\b/g;
/** 본문은 이만큼까지만 본다 */
export const SOURCE_SCAN_MAX = 2_000_000;

/** 플러그인 본문 하나를 살핀 것 */
export interface PluginScan {
  keywords: string[];
  areas: DiagnoseArea[];
  functions: string[];
  /** 그림을 직접 읽어 스프라이트로 그린다(ImageManager.loadPicture 등 + new Sprite / blt) */
  drawsSprites: boolean;
  /** 게임 화면 위에 HTML을 띄운다(jQuery, document.createElement 등) */
  html: boolean;
  /** 엔진에 없는 Scene_* 화면 */
  customScenes: string[];
  /** 세이브 위치·방식을 바꾼다 */
  save: boolean;
  /** 전투 진행을 바꾼다 */
  battle: boolean;
}

/** 플러그인 본문(글)을 열쇠말로 훑는다. 실행하지 않는다. 예외를 던지지 않는다. */
export function scanPluginSource(text: string | null | undefined): PluginScan {
  const out: PluginScan = { keywords: [], areas: [], functions: [], drawsSprites: false, html: false, customScenes: [], save: false, battle: false };
  try {
    if (typeof text !== "string" || text === "") return out;
    const src = text.length > SOURCE_SCAN_MAX ? text.slice(0, SOURCE_SCAN_MAX) : text;
    for (const k of KEYWORDS) {
      if (!k.re.test(src)) continue;
      out.keywords.push(k.label);
      if (!out.areas.includes(k.area)) out.areas.push(k.area);
    }
    const fns = new Set<string>();
    for (const m of src.matchAll(FN_RE)) {
      fns.add(m[1]);
      if (fns.size >= 12) break;
    }
    out.functions = [...fns];
    const loads = /ImageManager\.(loadPicture|loadNormalBitmap|loadBitmap)\b/.test(src);
    out.drawsSprites = loads && /new\s+Sprite(?:_\w+)?\s*\(|\.blt\s*\(/.test(src);
    out.html = /\bjQuery\b|\$\(\s*['"<]|\bdocument\.(createElement|body)/.test(src);
    const scenes = new Set<string>();
    for (const m of src.matchAll(SCENE_DEF_RE)) if (!STANDARD_SCENES.has(m[1])) scenes.add(m[1]);
    out.customScenes = [...scenes].slice(0, 10);
    out.save = /\bStorageManager\.(\w+)\s*=\s*function|localFileDirectoryPath|fileDirectoryPath/.test(src);
    out.battle = /\bBattleManager\.(\w+)\s*=\s*function/.test(src);
  } catch { /* 본 데까지 */ }
  return out;
}

/** 모르는 플러그인 목록(이름 순서는 plugins.js 순서) */
export function unknownPluginsOf(
  enabled: readonly string[], sources: Record<string, string> | undefined, knownExtra: readonly string[],
): UnknownPlugin[] {
  const out: UnknownPlugin[] = [];
  try {
    for (const name of enabled) {
      if (isKnownPlugin(name, knownExtra)) continue;
      const text = sources?.[name];
      if (typeof text !== "string") continue;
      const s = scanPluginSource(text);
      if (s.keywords.length === 0) continue;
      out.push({ name, areas: s.areas, keywords: s.keywords, functions: s.functions.slice(0, 8) });
    }
  } catch { /* 모은 데까지 */ }
  return out;
}
