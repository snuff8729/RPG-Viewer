import type { GameData, Location, PageEntry } from "../types";

export interface RecordBase { v: 1; seq: number; t: number; run: number; branch: number }
export interface StateChange {
  kind: "switch" | "variable" | "selfSwitch"; id: number | string; value: number | boolean;
  /** 플러그인이 잦은 변수로 보고 기록을 줄이는 중에 남긴 변경(변수만). 있으면 그 변수는 잦은 변수다. */
  throttled?: true;
}
export type LogRecord = RecordBase & (
  | { type: "branchStart"; reason: "newGame" | "load" | "unknownSave"; parentBranch: number | null; fromSeq: number | null }
  /**
   * 1.6.0+, 화면 그림 따라 그리기가 켜진 게임만: pics = 대사가 나올 때 화면 그림 전체(앞과 다를 때),
   * picsSame = 앞과 같음. 그림 하나는 [id, name, origin, x, y, scaleX, scaleY, opacity, blendMode, tone?, angle?] (core/addons/screenPictures)
   */
  | { type: "message"; src: Location | null; cmd: number; face: string; faceIndex: number; speaker: string; text: string; pics?: unknown[]; picsSame?: true }
  | { type: "scroll"; src: Location | null; cmd: number; text: string }
  /** pics: 1.6.0+ 그림이 바뀌었을 때만(message와 같은 모양) */
  | { type: "choices"; src: Location | null; cmd: number; options: string[]; pics?: unknown[] }
  | { type: "choice"; src: Location | null; cmd: number; picked: number }
  /**
   * 그림 표시(231). 1.15.0+: origin·x·y·scaleX·scaleY·opacity·blend = 실제로 쓴 값(변수 위치도 푼 것).
   * op "move"(232) = 이동 목표값(name ""), op "erase"(235) = 그림 지우기(name ""). op가 없으면 그림 표시.
   */
  | {
    type: "picture"; src: Location | null; cmd: number; pictureId: number; name: string; op?: "move" | "erase";
    origin?: number; x?: number; y?: number; scaleX?: number; scaleY?: number; opacity?: number; blend?: number;
  }
  /** 이벤트가 실행한 플러그인 명령(MV 356 / MZ 357, 플러그인 1.3.0+). text: 356은 명령 글, 357은 플러그인·명령 이름과 문자열 인자 */
  /** 1.5.0+: name = 명령 이름(MV 첫 토큰·MZ 명령), args = MV 나머지 토큰 / MZ 인자 객체, plugin = MZ 플러그인 이름 */
  | { type: "plugin"; src: Location | null; cmd: number; code: number; text: string; plugin?: string; name?: string; args?: string[] | Record<string, unknown> }
  | { type: "transfer"; mapId: number; x: number; y: number }
  /**
   * 전투 시작·끝. 1.8.0+: 시작에 troopName·enemies·canEscape·canLose, 끝에 result "abort"(전투 중단)·rewards(승리 보상)·
   * dropped(줄 수 제한으로 안 남긴 전투 로그 줄 수). pics/picsSame: 화면 그림 따라 그리기가 켜졌을 때(message와 같은 모양).
   */
  | {
    type: "battle"; phase: "start" | "end"; troopId: number; result?: "win" | "escape" | "lose" | "abort";
    troopName?: string; enemies?: string[]; canEscape?: boolean; canLose?: boolean;
    rewards?: { exp: number; gold: number; items: string[] }; dropped?: number; pics?: unknown[]; picsSame?: true;
  }
  /** 1.8.0+: 전투 로그 한 줄(제어 문자 그대로). 이야기 기록이 아니다. pics: 그림이 바뀌었을 때만 */
  /**
   * 1.8.1+: kind "action" = 기술·아이템 사용 줄(Window_BattleLog.displayAction). by = 쓴 쪽 이름, isEnemy = 적이 썼는지,
   * item = 기술·아이템 이름, itemKind, targets = 대상 이름들(있을 때만). text = 그때 띄운 첫 줄(없으면 "")
   */
  | {
    type: "battlelog"; text: string; pics?: unknown[];
    kind?: "action"; by?: string; isEnemy?: boolean; item?: string; itemKind?: "skill" | "item"; targets?: string[];
  }
  /**
   * 1.9.0+, 알림 문구 기록이 켜진 게임만: 다른 플러그인이 화면에 잠깐 띄운 문구(이야기 기록이 아니다).
   * source = "ticker"(TickerManager.show)·"livecomment"·"notify"·"info" 또는 직접 추가한 함수 경로,
   * text = 게임이 \n[]·\v[] 등을 풀어 쓴 글(\c[]·\i[] 등은 그대로), raw = 원문
   */
  | { type: "notice"; source: string; text: string; raw?: string }
  /**
   * 1.10.0+, 화면 그림 따라 그리기가 켜진 게임만: 기록 사이에 화면 그림이 바뀌었을 때(다른 플러그인이 잠깐 띄운 컷인 등)
   * 그때 화면 그림 전체. 이야기 기록이 아니고 반복 대화·전투 묶음·갈래 판정에 영향을 주지 않는다. scene = 맵/전투 화면.
   */
  | { type: "screen"; scene?: "battle" | "map" | "menu"; pics?: unknown[] }
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
  /**
   * page 0부터, -1 = 없음. x·y·d: 지금 위치·방향(플러그인 1.4.0+, 없으면 구버전 — 맵 데이터 위치를 쓴다).
   * spawn: 게임이 실행 중에 만든 이벤트(플러그인 1.16.0+, EventReSpawn 등)의 원본 — page는 원본 페이지 번호
   */
  events: { eventId: number; page: number; x?: number; y?: number; d?: number; spawn?: LiveSpawn }[];
  switches: number[];                             // ON인 id
  variables: Record<string, number>;              // 0이 아닌 값
  selfSwitches: string[];                         // ON인 "mapId,eventId,A"
  items: Record<string, number>; weapons: Record<string, number>; armors: Record<string, number>;
  gold: number; party: number[];
  choice: { src: Location | null; cmd: number; options: string[] } | null;
  inBattle: boolean;
  /** 게임 보조 상태(플러그인 1.1.0+, 없으면 구버전) */
  assist?: LiveAssist;
  /** 파티 캐릭터 자세히(플러그인 1.14.0+, 뷰어가 control.json `liveActors: true`로 부탁할 때만) */
  actors?: LiveActor[];
}
/**
 * 실행 중에 만든 이벤트의 원본: from = 원본 이벤트 번호(tpl이면 TemplateEvent 템플릿 맵, 아니면 같은 맵).
 * from이 없으면 원본을 못 찾은 것(name = 그 이벤트 데이터의 이름).
 */
export interface LiveSpawn { from?: number; tpl?: boolean; name?: string }
/** params: 지금 능력치 8개(장비·상태 포함, actor.param(0~7)) */
export interface LiveActor {
  id: number; name: string; level: number; exp: number; params: number[]; hp: number; mp: number;
  skills: number[]; states: number[];
}
export interface LiveAssist {
  /** 기본 배속(단축키 F6으로 바뀔 수 있음) */
  speed: number;
  /** 지금 실제로 돌고 있는 배속(자동 배속 포함) */
  effectiveSpeed: number;
  skipSeen: boolean;
  troopId: number | null;
  lastCommand: string | null;
  /** 게임에 실제로 걸린 단축키 keyCode(null = 끔). 없으면 기본 단축키가 고정인 구버전 플러그인. */
  hotkeys?: { speed: number | null; skip: number | null; win: number | null; lose: number | null };
  /** 게임이 적용한 control.json의 t(null = 아직 없음). 게임은 시작 뒤에 쓰인 파일만 적용한다. 없으면 구버전. */
  controlT?: number | null;
  /** 게임이 화면 그림을 기록하고 있는가(플러그인 1.6.0+, 없으면 구버전) */
  capturePictures?: boolean;
  /** 게임이 메뉴 화면 그림도 기록하는가(플러그인 1.16.0+, control.json captureMenuScenes) */
  captureMenuScenes?: boolean;
  /** 게임이 알림 문구를 기록하고 있는가(플러그인 1.9.0+) */
  captureNotices?: boolean;
  /** 게임이 감싼 알림 함수 경로들(플러그인 1.9.0+) */
  notices?: string[];
  /** 게임에 붙은 게임 전용 확장 id들(플러그인 1.13.0+) */
  extensions?: string[];
  /** 지금 전투에서 도망칠 수 있는가(전투 중일 때만 의미) */
  canEscape?: boolean;
  /** 지금 전투에서 져도 게임 오버가 아닌가(전투 중일 때만 의미) */
  canLose?: boolean;
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
  | { kind: "fork"; atSeq: number; branches: number[] }
  /**
   * 전투 한 번: 시작 기록부터 끝 기록(없으면 진행 중이거나 끊김)까지. items = 그 사이 기록을 접은 것(전투 로그·대사·상태 변경…),
   * logLines = 전투 로그 줄 수(알림 문구 포함), repeat = 앞에서 본 것과 같은 전투(적 무리·결과·로그·대사가 같음)를 이어서 다시 본 횟수(0 = 처음).
   */
  | { kind: "battle"; start: RecordOf<"battle">; end: RecordOf<"battle"> | null; items: HistoryItem[]; logLines: number; repeat: number };

export interface PickInfo { picked: number; run: number; branch: number; seq: number; aftermath: string[] }
export interface Coverage {
  seen: Set<string>;               // `${locationKey(src)}#${cmd}` (message, scroll)
  picks: Map<string, PickInfo[]>;  // `${locationKey(src)}#${cmd}` (choices 명령) → 선택들
  uncertainSeqs: Set<number>;      // 구조 불일치·위치 없음으로 제외한 기록 seq
  changedSeqs: Set<number>;        // 구조는 맞고 본문만 달라(실행 중 변경됨) 연결한 기록 seq
  /** 실행된 적 있는 페이지: 위치(src)가 있는 모든 기록의 `locationKey(pageLocation(src))`(원래 페이지 실행은 부른 템플릿 페이지) */
  touched: Set<string>;
  /** 실행된 플러그인 명령: `${locationKey(src)}#${cmd}` */
  pluginRan: Set<string>;
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
