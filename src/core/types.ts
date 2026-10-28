// ---- RPG Maker 원본 데이터 (필요한 필드만) ----
export interface EventCommand { code: number; indent: number; parameters: any[] }
export interface PageConditions {
  switch1Valid: boolean; switch1Id: number; switch2Valid: boolean; switch2Id: number;
  variableValid: boolean; variableId: number; variableValue: number;
  selfSwitchValid: boolean; selfSwitchCh: string;
  itemValid: boolean; itemId: number; actorValid: boolean; actorId: number;
}
export interface EventPage { conditions: PageConditions; trigger: number; list: EventCommand[] }
export interface MapEvent { id: number; name: string; note?: string; x: number; y: number; pages: EventPage[] }
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
  /** TemplateEvent 플러그인의 템플릿 맵 id(템플릿 이벤트를 풀었을 때만). */
  templateMapId?: number;
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
  | { kind: "picture"; cmd: number; pictureId: number; name: string }
  | { kind: "commonEvent"; commonEventId: number }
  | { kind: "transfer"; mapId: number | null; x?: number; y?: number }
  | { kind: "stateChange"; target: "switch" | "variable" | "selfSwitch" | "item" | "weapon" | "armor" | "gold" | "party"; description: string; refs: Ref[] }
  | { kind: "other"; commands: EventCommand[] };

// ---- 색인 ----
export type Location =
  | { source: "map"; mapId: number; eventId: number; page: number }   // page는 0부터
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
