// ---- RPG Maker 원본 데이터 (필요한 필드만) ----
export interface EventCommand { code: number; indent: number; parameters: any[] }
export interface PageConditions {
  switch1Valid: boolean; switch1Id: number; switch2Valid: boolean; switch2Id: number;
  variableValid: boolean; variableId: number; variableValue: number;
  selfSwitchValid: boolean; selfSwitchCh: string;
  itemValid: boolean; itemId: number; actorValid: boolean; actorId: number;
}
/** 이벤트 페이지 그래픽. tileId > 0이면 타일, 아니면 캐릭터 시트의 한 칸. */
export interface EventImage { tileId: number; characterName: string; characterIndex: number; direction: number; pattern: number }
export interface EventPage {
  conditions: PageConditions; trigger: number; list: EventCommand[];
  image?: EventImage;
  /** 0: 캐릭터 아래, 1: 캐릭터와 같음, 2: 캐릭터 위. */
  priorityType?: number;
  through?: boolean;
  directionFix?: boolean;
  /** 자율 이동: 0 고정, 1 무작위, 2 다가옴, 3 사용자 정의. */
  moveType?: number;
  /** 페이지의 이동 경로(자율 이동 "사용자 정의"). */
  moveRoute?: { list?: EventCommand[] };
}
export interface MapEvent {
  id: number; name: string; note?: string; x: number; y: number; pages: EventPage[];
  /** TemplateEvent로 페이지를 템플릿 것으로 바꾼 이벤트의 원래 페이지(`TE固有イベント呼び出し`가 실행한다). */
  originalPages?: EventPage[];
}
export interface MapData { displayName: string; width: number; height: number; events: (MapEvent | null)[] }
export interface MapInfo { id: number; name: string; parentId: number; order: number }
export interface CommonEvent { id: number; name: string; trigger: number; switchId: number; list: EventCommand[] }
export interface TroopPageConditions {
  turnEnding: boolean; turnValid: boolean; enemyValid: boolean; actorValid: boolean; switchValid: boolean;
  turnA: number; turnB: number; enemyIndex: number; enemyHp: number; actorId: number; actorHp: number; switchId: number;
}
export interface TroopPage { conditions: TroopPageConditions; span: number; list: EventCommand[] }
export interface Troop { id: number; name: string; pages: TroopPage[] }
export interface Actor { id: number; name: string; faceName: string; faceIndex: number }
export interface NamedEntry { id: number; name: string }
export interface SystemData {
  gameTitle: string; currencyUnit: string; switches: string[]; variables: string[];
  encryptionKey?: string; hasEncryptedImages?: boolean; advanced?: unknown;
}

// ---- 로드 결과 ----
export type Engine = "MV" | "MZ";
export interface LoadError { file: string; message: string; mapId?: number }
export interface GameData {
  engine: Engine;
  dataRoot: string;            // 예: "www/data" 또는 "data"
  imgRoot: string;             // 예: "www/img" 또는 "img"
  system: SystemData;
  mapInfos: (MapInfo | null)[];
  maps: Map<number, MapData>;  // 로드 성공한 맵만
  commonEvents: (CommonEvent | null)[];
  troops: (Troop | null)[];
  actors: (Actor | null)[];
  items: (NamedEntry | null)[];
  weapons: (NamedEntry | null)[];
  armors: (NamedEntry | null)[];
  errors: LoadError[];
  /** 게임 화면 크기(MZ System.json advanced, MV는 plugins.js 파라미터, 없으면 816×624). 없으면 기본 크기로 본다. */
  screenSize?: { width: number; height: number };
  /** TemplateEvent 플러그인의 템플릿 맵 id(템플릿 이벤트를 풀었을 때만). */
  templateMapId?: number;
  /** TemplateEvent KeepEventId: 맵 이벤트 호출(TE_CALL_MAP_EVENT)이 부른 이벤트 id를 유지(셀프 스위치가 부른 이벤트에). 없으면 false. */
  templateKeepEventId?: boolean;
}

// ---- 해석 결과 ----
export type RefType = "switch" | "variable" | "selfSwitch" | "item" | "weapon" | "armor" | "actor" | "commonEvent" | "map";
export interface Ref { type: RefType; id: number | string }   // selfSwitch는 "A"~"D"
export type CompareOp = "=" | ">=" | "<=" | ">" | "<" | "!=";
export type ConditionTest =
  | { kind: "switch"; id: number; on: boolean }
  | { kind: "variable"; id: number; op: CompareOp; value: number }
  | { kind: "variableVar"; id: number; op: CompareOp; otherId: number }
  | { kind: "selfSwitch"; letter: string; on: boolean }
  | { kind: "item" | "weapon" | "armor"; id: number }
  | { kind: "actorInParty"; id: number }
  | { kind: "gold"; op: ">=" | "<=" | "<"; value: number }
  | { kind: "trigger" }
  | { kind: "unknown" };
export interface Condition { text: string; refs: Ref[]; test?: ConditionTest }
export interface FaceRef { name: string; index: number }
/** `cmd`: 노드를 만든 101/105/102/231 명령의 원본 `list` 인덱스. */
export type ScriptNode =
  | { kind: "message"; cmd: number; face?: FaceRef; speaker?: string; lines: string[] }
  | { kind: "scroll"; cmd: number; lines: string[] }
  | { kind: "choices"; cmd: number; branches: { label: string; body: ScriptNode[] }[]; cancelBranch?: ScriptNode[] }
  | { kind: "conditional"; condition: Condition; then: ScriptNode[]; else?: ScriptNode[] }
  | { kind: "loop"; body: ScriptNode[] }
  /** name이 ""이면 파일 없는 그림: caption(바로 앞 D_TEXT 글)이 있으면 화면에 글자 띄우기, 없으면 빈 그림 자리 */
  | { kind: "picture"; cmd: number; pictureId: number; name: string; caption?: string }
  | { kind: "commonEvent"; commonEventId: number }
  /** TemplateEvent 호출(원래 이벤트 페이지·다른 맵 이벤트 페이지)을 펼친 것. `cmd`: 356/357 명령 인덱스.
   *  `location`: 펼친 `nodes`의 `cmd`가 가리키는 목록의 위치(본 대사 키도 이 위치로 만든다). */
  | { kind: "call"; cmd: number; label: string; location: Location; nodes: ScriptNode[] }
  | { kind: "transfer"; mapId: number | null; x?: number; y?: number }
  | { kind: "stateChange"; target: "switch" | "variable" | "selfSwitch" | "item" | "weapon" | "armor" | "gold" | "party"; description: string; refs: Ref[] }
  /** cmds[i]: commands[i]의 원본 목록 인덱스 */
  | { kind: "other"; commands: EventCommand[]; cmds: number[] };

// ---- 색인 ----
export type Location =
  /** page는 0부터. origin: TemplateEvent 이벤트의 원래 페이지(0부터) 목록 — 템플릿 페이지 page가 불러 실행한 것 */
  | { source: "map"; mapId: number; eventId: number; page: number; origin?: number }
  | { source: "common"; commonEventId: number }
  | { source: "troop"; troopId: number; page: number };
export interface PageEntry {
  location: Location;
  path: string;                // 예: "촌장의 집 › 촌장 › p1"
  title: string;               // 사이드바용 표시 이름
  nodes: ScriptNode[];
  conditions: Condition[];     // 페이지 출현 조건 + 트리거 설명
  hasDialogue: boolean;
}
export interface SearchHit { entry: PageEntry; text: string; nodePath: number[] }
export interface XrefEntry { writes: PageEntry[]; reads: PageEntry[] }
export interface GameIndex {
  pages: PageEntry[];
  search(query: string, limit?: number): SearchHit[];
  xref(ref: Ref): XrefEntry;
  callers(commonEventId: number): PageEntry[];
}
