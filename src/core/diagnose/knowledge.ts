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
  // ---- 세이브가 아님
  MpiGetMapImage: "개발용 맵 스크린샷 도구(테스트 모드 Ctrl+PageUp/Down, output 폴더에 PNG) — 세이브와 상관없어요",
  // ---- 전투: 원래 함수를 이어 부르고 BattleManager.setup/endBattle·Window_BattleLog.addText를 그대로 거쳐 기록에 영향 없음
  YEP_SkillCore: "기술 비용·조건 — 기록에 영향 없어요",
  YEP_X_SkillCooldowns: "기술 재사용 대기 — 전투 끝(endBattle)을 이어 불러요",
  Tachi: "전투·창 조정, 랜덤 전투도 BattleManager.setup으로 시작해요",
  MOG_BossHP: "보스 체력 게이지(화면 장식) — 전투 결과 처리를 이어 불러요",
  MOG_EnemyPoses: "적 자세 그림(전투 연출)",
  MOG_FlashDamage: "피해 깜박임(전투 연출)",
  MOG_BattleHud: "전투 HUD(화면 장식) — 전투 결과 처리를 이어 불러요",
  MOG_BattleHud_DrawStateEx: "전투 HUD 상태 아이콘(화면 장식)",
  MOG_HPGauge: "적 체력 게이지(화면 장식)",
  MOG_BattleResult: "전투 결과 화면 — 보상을 계산하고 endBattle로 끝내요",
  MOG_BattleCommands: "전투 명령 그림(화면 장식)",
  MOG_BattleCursor: "전투 대상 커서(화면 장식)",
  MOG_AuraEffect: "적 오라(전투 연출)",
  MOG_CollapseEffects: "적 쓰러짐 연출",
  MOG_DmgPopupEffects: "피해 숫자 연출",
  MOG_BattlebackEX: "전투 배경 연출",
  MpiMogHpGauge: "체력 게이지(화면 장식)",
  BeforeCommon: "행동 전 커먼 이벤트 — 전투 진행은 그대로예요",
  dsBattleStartMessage: "전투 시작 메시지 꾸미기 — 시작 메시지를 이어 불러요",
  dsShowBattleCommand: "전투 명령 보이기·숨기기",
  dsPassiveSkill: "패시브 기술 능력치",
  FTKR_SkillTreeSystem: "스킬 트리 메뉴 화면(이야기 밖), 전투 보상에 SP를 더해요",
  HIME_EndPhaseTriggers: "전투 이벤트 뒤에 끝 판정 — endBattle은 그대로예요",
  MpiUrmTacticsSystem: "자동 작전 메뉴 — 행동 고르기만 바꿔요",
  MpiUrmVisualizeNextAction: "적 다음 행동 아이콘(화면 장식)",
  BattleKnowledge: "피해 배율 계산 — 기록에 영향 없어요",
  MPP_EncounterEffect: "전투 시작 화면 전환 연출",
  PromptlyPopup: "전투 로그 줄을 바로 띄워요 — addText를 그대로 거쳐요",
  AutoRaise: "자동 부활 — BattleManager.setup을 이어 불러요",
  TroopOcean: "적 추가·보상 더하기 — 보상 계산을 이어 불러요",
  DisplayTargetStates: "대상 상태 창(전투 화면)",
  Actor_isCrisisHP: "위기 체력 색",
  // ---- 메뉴에서만 여는 화면(이야기 읽기와 상관없음)
  MessageLog: "대사 기록 보기 화면(메뉴) — 대사를 그대로 이어 불러요",
  MpiUrmSceneMenu_PrayGame: "메뉴 화면 꾸미기·상태 화면(메뉴)",
  CategorySynthesis: "합성 메뉴 화면",
  SceneGlossary: "용어집 메뉴 화면",
  SceneEquipEx: "장비 화면 꾸미기",
  Torigoya_Achievement_Tile: "업적 목록 화면 꾸미기",
  sai_Scenefile: "세이브 목록에 화면 미리보기 — 세이브 위치는 그대로예요",
  Vitsuno_Difficulty: "난이도 설정",
  SecondaryCategories: "아이템 분류 창",
  TMEventItemEx: "아이템 고르기 창 꾸미기",
  Mihil_HiddenItems: "숨긴 아이템",
  PG_koma_god: "도움말 글 다듬기",
  DisableGamePad: "게임패드 끄기 설정",
  // ---- 화면 꾸미기·연출(대사·그림 기록과 상관없음)
  TRP_Particle: "파티클 효과(화면 연출)",
  TRP_ParticleEditor: "파티클 편집기(테스트 모드 전용)",
  TRP_ParticleExOption: "파티클 수 설정",
  FTKR_PopupSpriteMessage: "글 팝업 — 플러그인 명령(PSM_)이라 플러그인 명령 기록으로 남아요",
  MPI_AnimationOverPictures: "애니메이션을 그림 위에 표시",
  BMSP_MapFog: "맵 안개(화면 연출)",
  MOG_TitlePictureCom: "타이틀 화면 꾸미기",
  MpiUrmMogTitlePictureCom: "타이틀 화면 꾸미기",
  MOG_Weather_EX: "날씨 연출",
  TMAnimeLight: "이벤트 빛 연출",
  TMMapHpGauge: "맵 체력 게이지(화면 장식)",
  TMNamePop: "이벤트 위 이름 표시(화면 장식)",
  ParallaxLayerMap: "원경 맵 겹 그리기",
  FastForwardCustomize: "빨리 감기 속도",
  CustomizeErrorScreen: "오류 화면 꾸미기",
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
