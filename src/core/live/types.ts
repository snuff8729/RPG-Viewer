import type { GameData, Location, PageEntry } from "../types";

export interface RecordBase { v: 1; seq: number; t: number; run: number; branch: number }
export interface StateChange {
  kind: "switch" | "variable" | "selfSwitch"; id: number | string; value: number | boolean;
  /** 플러그인이 잦은 변수로 보고 기록을 줄이는 중에 남긴 변경(변수만). 있으면 그 변수는 잦은 변수다. */
  throttled?: true;
}
export type LogRecord = RecordBase & (
  | { type: "branchStart"; reason: "newGame" | "load" | "unknownSave"; parentBranch: number | null; fromSeq: number | null }
  | { type: "message"; src: Location | null; cmd: number; face: string; faceIndex: number; speaker: string; text: string }
  | { type: "scroll"; src: Location | null; cmd: number; text: string }
  | { type: "choices"; src: Location | null; cmd: number; options: string[] }
  | { type: "choice"; src: Location | null; cmd: number; picked: number }
  | { type: "picture"; src: Location | null; cmd: number; pictureId: number; name: string }
  | { type: "transfer"; mapId: number; x: number; y: number }
  | { type: "battle"; phase: "start" | "end"; troopId: number; result?: "win" | "escape" | "lose" }
  | { type: "state"; src: Location | null; cmd: number | null; changes: StateChange[] }
  | { type: "save"; slot: number }
  | { type: "load"; slot: number }
  | { type: "error"; message: string }
);
export type RecordOf<T extends LogRecord["type"]> = Extract<LogRecord, { type: T }>;

export interface LiveSnapshot {
  v: 1; t: number; pluginVersion: string;
  run: number | null; branch: number | null; seq: number;
  mapId: number; x: number; y: number;
  running: Location | null;
  /** 실행 중인 명령 인덱스(구버전 플러그인엔 없음) */
  runningCmd?: number | null;
  events: { eventId: number; page: number }[];   // page 0부터, -1 = 없음
  switches: number[];                             // ON인 id
  variables: Record<string, number>;              // 0이 아닌 값
  selfSwitches: string[];                         // ON인 "mapId,eventId,A"
  items: Record<string, number>; weapons: Record<string, number>; armors: Record<string, number>;
  gold: number; party: number[];
  choice: { src: Location | null; cmd: number; options: string[] } | null;
  inBattle: boolean;
  /** 게임 보조 상태(플러그인 1.1.0+, 없으면 구버전) */
  assist?: LiveAssist;
}
export interface LiveAssist {
  /** 기본 배속(단축키 F6으로 바뀔 수 있음) */
  speed: number;
  /** 지금 실제로 돌고 있는 배속(자동 배속 포함) */
  effectiveSpeed: number;
  skipSeen: boolean;
  troopId: number | null;
  lastCommand: string | null;
}

export interface BranchInfo {
  id: number; run: number; parent: number | null; fromSeq: number | null;
  reason: "newGame" | "load" | "unknownSave";
  startSeq: number; startT: number; lastSeq: number; lastT: number; children: number[];
}
export interface HistoryModel {
  branches: Map<number, BranchInfo>;
  /** run 오름차순, branches는 대표 갈래만 생성 순(이어진 갈래는 빠진다) */
  runs: { run: number; branches: number[] }[];
  /**
   * 이어진 갈래 → 대표 갈래. 불러오기로 시작했는데 부모가 속한 대표 갈래 묶음 전체(대표 + 이어진 갈래들)에 저장 지점(fromSeq) 뒤
   * 이야기 기록(message·scroll·choices·choice·picture)이 없으면 그 갈래는 부모를 이어 간 것으로 보고
   * 같은 갈래로 보인다(사슬이면 맨 위 갈래). 갈래가 시작될 때 정하고 바꾸지 않는다.
   * 대표 갈래는 여기에 없다 — representative(model, id)를 쓸 것. branches의 parent·children은 원본 그대로.
   */
  alias: Map<number, number>;
  latestBranch: number | null;                   // 가장 최근 기록이 속한 갈래의 대표 갈래
}
export type HistoryItem =
  | { kind: "record"; record: LogRecord; uncertain: boolean; changed: boolean }
  | { kind: "repeat"; record: RecordOf<"message">; count: number }
  | { kind: "stateGroup"; records: RecordOf<"state">[]; count: number }
  | { kind: "fork"; atSeq: number; branches: number[] };

export interface PickInfo { picked: number; run: number; branch: number; seq: number; aftermath: string[] }
export interface Coverage {
  seen: Set<string>;               // `${locationKey(src)}#${cmd}` (message, scroll)
  picks: Map<string, PickInfo[]>;  // `${locationKey(src)}#${cmd}` (choices 명령) → 선택들
  uncertainSeqs: Set<number>;      // 구조 불일치·위치 없음으로 제외한 기록 seq
  changedSeqs: Set<number>;        // 구조는 맞고 본문만 달라(실행 중 변경됨) 연결한 기록 seq
}

export type EvalStatus = "met" | "unmet" | "unknown";
export interface Requirement { text: string; status: EvalStatus }
export interface MissingItem {
  kind: "choice" | "page";
  entry: PageEntry; nodePath: number[];
  label: string;
  requirements: Requirement[];
  onCurrentMap: boolean; allMet: boolean;
}
export type { GameData };
