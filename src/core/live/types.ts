import type { GameData, Location, PageEntry } from "../types";

export interface RecordBase { v: 1; seq: number; t: number; run: number; branch: number }
export interface StateChange { kind: "switch" | "variable" | "selfSwitch"; id: number | string; value: number | boolean }
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
  events: { eventId: number; page: number }[];   // page 0부터, -1 = 없음
  switches: number[];                             // ON인 id
  variables: Record<string, number>;              // 0이 아닌 값
  selfSwitches: string[];                         // ON인 "mapId,eventId,A"
  items: Record<string, number>; weapons: Record<string, number>; armors: Record<string, number>;
  gold: number; party: number[];
  choice: { src: Location | null; cmd: number; options: string[] } | null;
  inBattle: boolean;
}

export interface BranchInfo {
  id: number; run: number; parent: number | null; fromSeq: number | null;
  reason: "newGame" | "load" | "unknownSave";
  startSeq: number; startT: number; lastSeq: number; lastT: number; children: number[];
}
export interface HistoryModel {
  branches: Map<number, BranchInfo>;
  runs: { run: number; branches: number[] }[];   // run 오름차순, branches 생성 순
  latestBranch: number | null;                   // 가장 최근 기록이 속한 갈래
}
export type HistoryItem =
  | { kind: "record"; record: LogRecord; uncertain: boolean }
  | { kind: "repeat"; record: RecordOf<"message">; count: number }
  | { kind: "stateGroup"; records: RecordOf<"state">[]; count: number }
  | { kind: "fork"; atSeq: number; branches: number[] };

export interface PickInfo { picked: number; run: number; branch: number; seq: number; aftermath: string[] }
export interface Coverage {
  seen: Set<string>;               // `${locationKey(src)}#${cmd}` (message, scroll)
  picks: Map<string, PickInfo[]>;  // `${locationKey(src)}#${cmd}` (choices 명령) → 선택들
  uncertainSeqs: Set<number>;      // 원문 불일치로 제외한 기록 seq
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
