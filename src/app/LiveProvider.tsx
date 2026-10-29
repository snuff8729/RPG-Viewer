import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import pluginSource from "../../plugin/RPGViewerBridge.js?raw";
import { useGame } from "./GameProvider";
import { useAddons } from "./AddonsProvider";
import { isRemoteFolder } from "./serverFolder";
import { isWritableFolder, type WritableGameFolder } from "@/core/fs/folder";
import { buildHistory } from "@/core/live/history";
import { createAccumulator, type LiveAccumulator } from "@/core/live/accumulator";
import { conditionsKey } from "@/core/live/interactable";
import { computeMissing } from "@/core/live/missing";
import { withActorNames } from "@/core/live/actorNames";
import { getInstallStatus, install as installPlugin, livePaths, pluginVersionOf, uninstall as uninstallPlugin, type InstallResult, type InstallStatus } from "@/core/live/installer";
import { LogTail, readLive } from "@/core/live/tail";
import { mergeSeenArchive, parseSeenArchive, type SeenArchive } from "@/core/live/seenArchive";
import { logEditPaths } from "./logEdit";
import type { Coverage, HistoryModel, LiveSnapshot, LogRecord, MissingItem } from "@/core/live/types";
import type { GameData, GameIndex } from "@/core/types";
import {
  adoptLiveAssist, ASSIST_MIN_VERSION, carryCommand, changedAssistKeys, controlJson, controlMismatch, DEFAULT_ASSIST, hotkeysForSave, mergeAssist,
  migrateSavedAssist, normalizeAssist, parseControlFile, resyncDue, seenSets, versionAtLeast,
  type AssistCommand, type AssistCommandKind, type AssistKey, type AssistSettings, type ControlFile, type SeenSets, type WrittenControl,
} from "@/core/live/assist";
import {
  batchResults, CHEAT_MIN_VERSION, makeBatch, splitOps, validCheatOp, type CheatBatch, type CheatOp, type CheatStatus,
} from "@/core/live/cheat";
import { KEY_REPLY_TTL_MS, type KeyReply } from "@/core/live/keyRequest";
import { clearReadPositions, gameKeyOf } from "@/ui/live/readPosition";

export type Connection = "noPlugin" | "waiting" | "connected" | "stale";

export interface LiveContextValue {
  /** isWritableFolder(folder) — 폴더 열기(File System Access)로 연 게임만 true. */
  supported: boolean;
  install: InstallStatus | null;
  refreshInstall(): Promise<void>;
  /** 내부에서 requestWrite 후 설치/업데이트. 클릭 핸들러 안에서 호출할 것. */
  doInstall(): Promise<InstallResult>;
  doUninstall(): Promise<InstallResult>;
  /** waiting = 설치됐지만 기록·상태 없음 */
  connection: Connection;
  /**
   * 파생 계산(model·coverage·missing)에 쓴 기록. 기록이 계속 들어오면 최대 1초에 한 번 갱신(마지막 변경 뒤엔 꼭 한 번).
   * 누적기 내부 배열이 아니라 파생 순간의 사본이라, 참조가 바뀌면 내용도 바뀐 것이다(memo deps로 써도 된다).
   */
  records: LogRecord[];
  badLines: number;
  model: HistoryModel;
  coverage: Coverage;
  /** 연결됨(5초 이내)일 때만 현재 상태, 아니면 null → 판정은 모두 "?"가 된다. 하트비트(t만 바뀜)로는 참조가 바뀌지 않는다. */
  live: LiveSnapshot | null;
  missing: MissingItem[];
  /** noisyVariables(records) — foldTimeline opts.noisy로 넘긴다. */
  noisy: Set<number>;
  /** coverage.uncertainSeqs — foldTimeline opts.uncertainSeqs로 넘긴다. */
  uncertainSeqs: Set<number>;
  /** coverage.changedSeqs — foldTimeline opts.changedSeqs로 넘긴다. */
  changedSeqs: Set<number>;
  /** model.latestBranch */
  latestBranch: number | null;
  /** 뷰어에 들어 있는 플러그인 버전 */
  bundledVersion: string;
  /**
   * 현재 게임의 기록을 끝까지(LogTail eof) 한 번 읽었고, records·model이 그 시점까지를 담고 있다.
   * 그 전에는 기록이 앞부분만 있을 수 있어 읽은 위치·창을 정하면 안 된다.
   */
  caughtUp: boolean;
  /** 기록 파일이 초기화(LogTail reset)될 때마다 1씩 오른다. records·model과 같은 파생 순간 값. */
  logEpoch: number;
  /** 기록 파일과 본 기록 보관(seen-archive.json)을 처음부터 다시 읽는다(갈래 영구 삭제·되돌리기 뒤). */
  reloadLog(): void;
}

/**
 * 폴링·하트비트마다 바뀌는 값. useLive()와 나눠 두어, 이 값이 바뀌어도
 * useLive()만 쓰는 화면(기록 탭 등)은 다시 그리지 않는다.
 */
export interface LiveStatusValue {
  /** lastLive.t와 마지막 기록 t 중 최신 */
  lastSeenT: number | null;
  /** 연결 여부와 무관한 마지막 live.json(연결 Badge·라벨용). 하트비트마다 바뀐다. */
  lastLive: LiveSnapshot | null;
  /** 기록 파일 크기(바이트)와 줄 수(누적 기록 + 잘못된 줄). 아직 못 읽었으면 null. */
  logStats: { bytes: number; lines: number } | null;
}

const bundledVersion = pluginVersionOf(pluginSource) ?? "";
const POLL_MS = 500;
const FRESH_MS = 5000;
/** 기록에서 파생하는 계산(갈래 모델·잦은 변수·진행도·못 본 것)은 최대 이 간격에 한 번. */
const DERIVE_MS = 1000;
const UNSUPPORTED_FOLDER = "크롬이나 엣지에서 폴더 열기로 연 게임만 지원해요";
const NO_WRITE = "쓰기 권한이 필요해요";

const EMPTY_RECORDS: LogRecord[] = [];
const EMPTY_MODEL: HistoryModel = buildHistory([]);
const EMPTY_COVERAGE: Coverage = { seen: new Set(), picks: new Map(), uncertainSeqs: new Set(), changedSeqs: new Set(), touched: new Set(), pluginRan: new Set() };
const EMPTY_NOISY = new Set<number>();

/**
 * 폴링이 본 최신 기록 상태(변경 즉시 갱신). 파생값은 Derived로 따로 스로틀한다.
 * gen: 누적기마다 다른 번호 — 새 누적기의 version이 이전 누적기의 version과 같아도 섞이지 않게 (gen, version)으로 구분한다.
 */
interface TailInfo { gen: number; version: number; count: number; lastT: number | null; badLines: number; bytes: number | null; caughtUp: boolean }
const EMPTY_TAIL: TailInfo = { gen: 0, version: 0, count: 0, lastT: null, badLines: 0, bytes: null, caughtUp: false };

/** 스로틀된 파생 순간의 누적기 스냅숏(모두 이후 append로 바뀌지 않는다). caughtUp·epoch는 파생 순간의 TailEntry 값. */
interface Derived { gen: number; version: number; records: LogRecord[]; model: HistoryModel; coverage: Coverage; noisy: Set<number>; caughtUp: boolean; epoch: number }

/** 폴링 효과가 게임마다 만드는 누적기와 그 tail의 상태. */
interface TailEntry {
  acc: LiveAccumulator;
  gen: number;
  gameKey: string;
  /** tail이 끝까지(eof) 한 번 읽었다 */
  caughtUp: boolean;
  /** LogTail reset 횟수 */
  epoch: number;
  /** 읽은 위치를 지운 epoch(파생 순간에 지운다) */
  clearedEpoch: number;
  /** rpg-viewer/seen-archive.json(갈래 영구 삭제로 지운 기록의 진행도). 기록보다 먼저 읽는다. */
  archive: SeenArchive | null;
  /** 누적기 진행도 + 보관을 합친 값(같은 입력이면 같은 객체) */
  merged: { cov: Coverage; archive: SeenArchive | null; out: Coverage } | null;
}

/** 누적기 진행도에 본 기록 보관을 합친다(입력이 같으면 이전 객체). */
function mergedCoverage(entry: TailEntry): Coverage {
  const cov = entry.acc.coverage();
  const m = entry.merged;
  if (m && m.cov === cov && m.archive === entry.archive) return m.out;
  const out = mergeSeenArchive(cov, entry.archive);
  entry.merged = { cov, archive: entry.archive, out };
  return out;
}

/** 게임 보조(control.json) — useLive()와 나눠 두어 설정이 바뀌어도 다른 화면은 다시 그리지 않는다. */
export interface AssistValue {
  settings: AssistSettings;
  /** 설정을 바꾸고 바로 control.json에 쓴다. 클릭 핸들러 안에서 호출할 것(쓰기 권한 요청). */
  setSettings(next: AssistSettings): void;
  /** 전투 조작(이기기·지기·도망). supported일 때만. 클릭 핸들러 안에서 호출할 것. */
  sendCommand(kind: AssistCommandKind): void;
  /** 마지막으로 보낸 전투 명령(없으면 null) — live.json `assist.lastCommand`와 맞춰 응답을 보인다. */
  sentCommand: AssistCommand | null;
  /** 연결됨 + 게임의 플러그인이 1.1.0 이상 */
  supported: boolean;
  /** 연결됨 + 게임의 플러그인이 1.14.0 이상(치트) */
  cheatSupported: boolean;
  /**
   * 치트 보내기. 클릭 핸들러 안에서 호출할 것. 기록 키(50개씩 나눈 묶음마다 하나)를 돌려준다. 틀린 op가 있거나 지원 안 하면 [].
   * 앞서 보낸 치트의 응답을 기다리는 동안 누른 것은 모아 두었다가 다음 명령 하나로 보낸다.
   */
  sendCheat(ops: CheatOp[]): string[];
  /** 기록 키 → 상태 */
  cheatResults: ReadonlyMap<string, CheatStatus>;
  /** 치트 창이 열려 있는 동안 true: 게임이 live.json에 파티 캐릭터 정보를 싣는다(control.json `liveActors`). */
  setLiveActors(on: boolean): void;
  /**
   * 게임 창 단축키로 온 백업·복원 요청(core/live/keyRequest)에 답한다: control.json `keyReply`에 실어 게임 화면에 잠깐 띄운다.
   * 같은 요청에 여러 번 답해도 된다(답마다 번호가 다르다). 연결이 끊긴 때(타이틀 화면 등)도 쓴다.
   */
  replyKeyRequest(id: string, text: string): void;
}

/** 본 것 묶음은 진행도가 바뀐 뒤 이 시간 동안 조용하면 쓴다. */
const ASSIST_DEBOUNCE_MS = 3000;
/** 전투 명령은 이 시간 동안만 control.json에 남긴다(플러그인도 10초 넘은 명령은 무시). */
const COMMAND_TTL_MS = 10000;
/** 치트 응답을 이만큼 못 받으면 응답 없음으로 보고 다음 묶음을 보낸다(플러그인은 10초 넘은 명령을 무시한다). */
const CHEAT_RESPONSE_MS = COMMAND_TTL_MS + 1000;
let cheatSeq = 0;
/** 이 창의 표시: PC와 휴대폰이 같은 밀리초에 보낸 명령도 id가 겹치지 않게 */
const VIEWER_TAG = Math.random().toString(36).slice(2, 8);

const assistStorageKey = (gameKey: string) => `rpgv.assist.${gameKey}`;
function loadAssist(gameKey: string | null): AssistSettings {
  if (gameKey === null) return DEFAULT_ASSIST;
  try {
    const raw = localStorage.getItem(assistStorageKey(gameKey));
    return raw === null ? DEFAULT_ASSIST : normalizeAssist(migrateSavedAssist(JSON.parse(raw)));
  } catch {
    return DEFAULT_ASSIST;
  }
}
const dirtyStorageKey = (gameKey: string) => `rpgv.assistDirty.${gameKey}`;
const ASSIST_KEY_SET: ReadonlySet<string> = new Set<AssistKey>(["speed", "skipSeen", "autoFast", "autoSpeed", "hotkeys", "quickSlot"]);
let keyReplySeq = 0;
/** 아직 control.json에 쓰지 못한 설정 키(게임별) */
function loadDirty(gameKey: string | null): Set<AssistKey> {
  if (gameKey === null) return new Set();
  try {
    const v: unknown = JSON.parse(localStorage.getItem(dirtyStorageKey(gameKey)) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((k): k is AssistKey => typeof k === "string" && ASSIST_KEY_SET.has(k)) : []);
  } catch {
    return new Set();
  }
}
function saveDirty(gameKey: string | null, keys: ReadonlySet<AssistKey>): void {
  if (gameKey === null) return;
  try {
    if (keys.size === 0) localStorage.removeItem(dirtyStorageKey(gameKey));
    else localStorage.setItem(dirtyStorageKey(gameKey), JSON.stringify([...keys]));
  } catch { /* 저장 못 해도 동작 */ }
}
/** control.json을 읽는다(없거나 깨졌으면 null). */
async function readControl(folder: WritableGameFolder, path: string): Promise<ControlFile | null> {
  try { return parseControlFile(await folder.readText(path)); } catch { return null; }
}
function saveAssist(gameKey: string | null, s: AssistSettings): void {
  if (gameKey === null) return;
  try { localStorage.setItem(assistStorageKey(gameKey), JSON.stringify({ ...s, hotkeys: hotkeysForSave(s.hotkeys) })); } catch { /* 저장 못 해도 동작 */ }
}

const LiveContext = createContext<LiveContextValue | null>(null);
const LiveStatusContext = createContext<LiveStatusValue | null>(null);
const AssistContext = createContext<AssistValue | null>(null);
/** 게임 중에 바뀐 캐릭터 이름을 넣은 GameData(useLiveData). LiveProvider 밖이면 null. */
const LiveDataContext = createContext<{ data: GameData | undefined } | null>(null);

/** t만 다른 live.json(하트비트)이면 같은 키 → 판정·못 본 것 재계산을 건너뛴다. */
function stateKey(s: LiveSnapshot): string {
  return JSON.stringify({ ...s, t: 0 });
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { status, data, index, folder } = useGame();
  const ready = status === "ready" && !!data && !!index && !!folder;
  const wfolder: WritableGameFolder | null = ready && folder && isWritableFolder(folder) ? folder : null;
  const supported = wfolder !== null;
  const dataRoot = data?.dataRoot ?? null;

  const [install, setInstall] = useState<InstallStatus | null>(null);
  const [tailInfo, setTailInfo] = useState<TailInfo>(EMPTY_TAIL);
  const [derived, setDerived] = useState<Derived | null>(null);
  const [lastLive, setLastLive] = useState<LiveSnapshot | null>(null);
  const [liveState, setLiveState] = useState<LiveSnapshot | null>(null);
  const [fresh, setFresh] = useState(false);

  // 게임(폴더)이 바뀌면 렌더 중에 상태를 비운다(React 권장 패턴: 이전 값과 비교).
  // 같은 폴더라도 데이터가 바뀌면 누적기를 새로 만들므로 기록·파생값도 비운다.
  const [prevFolder, setPrevFolder] = useState<WritableGameFolder | null>(wfolder);
  const [prevData, setPrevData] = useState(data);
  if (prevFolder !== wfolder) {
    setPrevFolder(wfolder);
    setInstall(null);
    setLastLive(null);
    setLiveState(null);
    setFresh(false);
  }
  if (prevFolder !== wfolder || prevData !== data) {
    setPrevData(data);
    setTailInfo(EMPTY_TAIL);
    setDerived(null);
  }

  // 비동기 결과가 이전 게임 것이면 버린다.
  const currentFolder = useRef(wfolder);
  useEffect(() => { currentFolder.current = wfolder; }, [wfolder]);

  const refreshInstall = useCallback(async () => {
    if (!wfolder || dataRoot === null) return;
    const st = await getInstallStatus(wfolder, dataRoot, bundledVersion);
    if (currentFolder.current === wfolder) setInstall(st);
  }, [wfolder, dataRoot]);

  const runWrite = useCallback(async (op: (f: WritableGameFolder, root: string) => Promise<InstallResult>): Promise<InstallResult> => {
    if (!wfolder || dataRoot === null) return { ok: false, message: UNSUPPORTED_FOLDER };
    let granted = false;
    try { granted = await wfolder.requestWrite(); } catch { granted = false; }
    if (!granted) return { ok: false, message: NO_WRITE };
    let r: InstallResult;
    try { r = await op(wfolder, dataRoot); } catch { r = { ok: false, message: NO_WRITE }; }
    await refreshInstall();
    return r;
  }, [wfolder, dataRoot, refreshInstall]);

  const doInstall = useCallback(() => runWrite((f, root) => installPlugin(f, root, pluginSource)), [runWrite]);
  const doUninstall = useCallback(() => runWrite((f, root) => uninstallPlugin(f, root)), [runWrite]);

  // 게임이 바뀌면 설치 상태를 다시 읽는다.
  useEffect(() => { void refreshInstall(); }, [refreshInstall]);

  // 누적기: 폴링 효과가 게임(폴더·데이터)마다 새로 만든다. 파생 스로틀이 여기서 읽는다.
  const accRef = useRef<TailEntry | null>(null);
  const genCounter = useRef(0);
  /** 바뀌면 기록·보관을 처음부터 다시 읽는다 */
  const [reloadKey, setReloadKey] = useState(0);
  const reloadLog = useCallback(() => setReloadKey(k => k + 1), []);

  // 폴링: 자기 재예약 setTimeout(setInterval 아님). 숨겨진 탭이면 건너뛴다. more면 바로 다시.
  useEffect(() => {
    if (!wfolder || dataRoot === null || !data) return;
    const paths = livePaths(dataRoot);
    const tail = new LogTail(wfolder, paths.logFile);
    const acc = createAccumulator(data);
    const gen = ++genCounter.current;
    const entry: TailEntry = { acc, gen, gameKey: gameKeyOf(data), caughtUp: false, epoch: 0, clearedEpoch: 0, archive: null, merged: null };
    let archiveRead = false;
    accRef.current = entry;
    let bad = 0;
    let liveModified: number | null = null;
    let lastKey: string | null = null;
    let lastLiveT: number | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      let again = false;
      try {
        if (document.visibilityState === "visible") {
          if (!archiveRead) {
            // 본 기록 보관을 기록보다 먼저 읽는다(진행도가 잠깐이라도 줄어 보이지 않게)
            let text: string | null = null;
            try { text = await wfolder.readText(logEditPaths(dataRoot).archive); } catch { text = null; }
            if (cancelled) return;
            entry.archive = parseSeenArchive(text);
            archiveRead = true;
          }
          const res = await tail.poll();
          if (cancelled) return;
          if (res.changed) {
            // 새 기록만 누적기에 붙인다. reset이면 비우고 다시 쌓는다.
            // reset이면 epoch를 올린다 — 읽은 위치는 다음 파생 순간에 지운다(아래 파생 스로틀).
            if (res.reset) { acc.reset(); bad = 0; entry.epoch++; }
            acc.append(res.records);
            bad += res.badLines;
            if (res.eof) entry.caughtUp = true;
            // 기록 크기: 바뀐 주기에만 stat 한 번(LogTail은 고치지 않는다).
            let bytes: number | null = null;
            try { bytes = (await wfolder.stat(paths.logFile))?.size ?? null; } catch { bytes = null; }
            if (cancelled) return;
            const recs = acc.records;
            setTailInfo({
              gen, version: acc.version, count: recs.length, lastT: recs.length > 0 ? recs[recs.length - 1].t : null,
              badLines: bad, bytes, caughtUp: entry.caughtUp,
            });
          } else if (res.eof && !entry.caughtUp) {
            // 기록이 없거나 더 읽을 게 없음 — 끝까지 읽은 것(읽기 실패는 eof가 아니다)
            entry.caughtUp = true;
            setTailInfo(p => (p.gen === gen ? { ...p, caughtUp: true } : { ...EMPTY_TAIL, gen, caughtUp: true }));
          }
          again = res.more;
          const lv = await readLive(wfolder, paths.liveFile, liveModified);
          if (cancelled) return;
          if (lv.changed && lv.snapshot) {
            liveModified = lv.modified;
            const snap = lv.snapshot;
            lastLiveT = snap.t;
            setLastLive(snap);
            const key = stateKey(snap);
            if (key !== lastKey) { lastKey = key; setLiveState(snap); }
          }
          setFresh(lastLiveT !== null && Math.abs(Date.now() - lastLiveT) <= FRESH_MS);
        }
      } catch {
        // 다음 주기에 재시도
      }
      if (!cancelled) timer = setTimeout(() => { void tick(); }, again ? 0 : POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (accRef.current === entry) accRef.current = null;
    };
  }, [wfolder, dataRoot, data, reloadKey]);

  // DEV 시뮬레이터
  useEffect(() => {
    if (!import.meta.env.DEV || !wfolder || isRemoteFolder(wfolder) || dataRoot === null) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    void import("./devLive").then((m) => {
      if (cancelled) return;
      cleanup = m.registerLiveDevTools({ folder: wfolder, dataRoot, pluginSource, refreshInstall });
    });
    return () => { cancelled = true; cleanup?.(); };
  }, [wfolder, dataRoot, refreshInstall]);

  // 누적기 → 파생값 스냅숏: 스로틀(최대 DERIVE_MS에 한 번, 마지막 변경 뒤 반드시 한 번).
  // 변경마다 타이머를 다시 걸지만 대기 시간은 "마지막 파생 + DERIVE_MS"까지라 미뤄지지 않는다.
  // records는 누적기 내부 배열(이후 append로 바뀜)이라 파생 순간에 slice() 사본을 내보낸다(초당 최대 한 번 O(n)).
  // model/coverage/noisy는 누적기가 version마다 만든 불변 사본이다.
  // 스냅숏은 (누적기 gen, version)으로 구분한다.
  const lastDeriveAt = useRef(0);
  const tailGen = tailInfo.gen;
  const tailVersion = tailInfo.version;
  const tailCaughtUp = tailInfo.caughtUp;
  useEffect(() => {
    const wait = Math.max(0, lastDeriveAt.current + DERIVE_MS - Date.now());
    const id = setTimeout(() => {
      lastDeriveAt.current = Date.now();
      const cur = accRef.current;
      // 기록이 초기화됐으면 이 게임의 읽은 위치를 지운다. 새 epoch의 파생값을 내보내기 직전에 지워서,
      // 그 사이 이전 기록 기준으로 저장된 위치도 함께 지워진다(읽기 탭은 epoch가 바뀌면 위치를 다시 읽는다).
      if (cur && cur.epoch !== cur.clearedEpoch) { cur.clearedEpoch = cur.epoch; clearReadPositions(cur.gameKey); }
      if (!cur || cur.acc.records.length === 0) { setDerived(null); return; }
      const { acc, gen, caughtUp, epoch } = cur;
      const v = acc.version;
      setDerived((prev) => (prev && prev.gen === gen && prev.version === v && prev.caughtUp === caughtUp && prev.epoch === epoch
        ? prev
        : { gen, version: v, records: acc.records.slice(), model: acc.model(), coverage: mergedCoverage(cur), noisy: acc.noisy(), caughtUp, epoch }));
    }, wait);
    return () => clearTimeout(id);
  }, [tailGen, tailVersion, tailCaughtUp]);

  const derivedRecords = derived?.records ?? EMPTY_RECORDS;
  const model = derived?.model ?? EMPTY_MODEL;
  const coverage = derived?.coverage ?? EMPTY_COVERAGE;
  const noisy = derived?.noisy ?? EMPTY_NOISY;
  const badLines = tailInfo.badLines;
  // 파생값이 있으면 그 순간의 caughtUp, 기록이 하나도 없으면(파생값 null) tail 상태만으로 판단.
  const caughtUp = tailInfo.caughtUp && (derived ? derived.caughtUp : tailInfo.count === 0);
  const logEpoch = derived?.epoch ?? 0;

  // 연결이 끊기면 null → 조건 판정 "?"
  const live = fresh ? liveState : null;
  // 못 본 것: 진행도 스냅숏이나 조건에 쓰는 상태(conditionsKey)가 바뀔 때만 다시 계산.
  // fresh가 바뀌면 live가 null↔상태로 바뀌어 키도 바뀐다. 키가 같으면 이전 live 참조를 그대로 쓴다.
  const liveKey = useMemo(() => conditionsKey(live), [live]);
  const [cond, setCond] = useState<{ key: string; live: LiveSnapshot | null }>({ key: liveKey, live });
  if (cond.key !== liveKey) setCond({ key: liveKey, live });
  const condLive = cond.key === liveKey ? cond.live : live;
  const missing = useMemo(
    () => (data && index ? computeMissing(index, data, coverage, condLive) : []),
    [index, data, coverage, condLive],
  );

  // 게임 중에 바뀐 캐릭터 이름(live.json actorNames): 연결이 끊겨도 마지막으로 읽은 상태의 이름을 쓴다.
  // withActorNames는 이름이 같으면 같은 객체라 하트비트·다른 상태 변화로는 참조가 바뀌지 않는다.
  const liveData = data ? withActorNames(data, liveState?.actorNames) : undefined;
  const liveDataValue = useMemo(() => ({ data: liveData }), [liveData]);

  const logStats = useMemo(
    () => (tailInfo.bytes === null ? null : { bytes: tailInfo.bytes, lines: tailInfo.count + tailInfo.badLines }),
    [tailInfo],
  );

  const lastRecordT = tailInfo.lastT;
  const lastSeenT = lastLive && lastRecordT !== null ? Math.max(lastLive.t, lastRecordT) : (lastLive?.t ?? lastRecordT);

  let connection: Connection;
  if (!supported || !install || install.state !== "installed") connection = "noPlugin";
  else if (!lastLive && tailInfo.count === 0) connection = "waiting";
  else if (fresh) connection = "connected";
  else connection = "stale";

  const value = useMemo<LiveContextValue>(() => ({
    supported, install, refreshInstall, doInstall, doUninstall,
    connection, records: derivedRecords, badLines, model, coverage, live, missing,
    noisy, uncertainSeqs: coverage.uncertainSeqs, changedSeqs: coverage.changedSeqs, latestBranch: model.latestBranch, bundledVersion,
    caughtUp, logEpoch, reloadLog,
  }), [supported, install, refreshInstall, doInstall, doUninstall, connection, derivedRecords, badLines, model, coverage, live, missing, noisy, caughtUp, logEpoch, reloadLog]);

  const statusValue = useMemo<LiveStatusValue>(() => ({ lastSeenT, lastLive, logStats }), [lastSeenT, lastLive, logStats]);

  // ── 게임 보조: 설정(게임별 localStorage, control.json에 다른 뷰어가 쓴 값이 있으면 그것을 따른다) → rpg-viewer/control.json ──
  const gameKey = data ? gameKeyOf(data) : null;
  const [assistKey, setAssistKey] = useState<string | null>(gameKey);
  const [assistSettings, setAssistSettings] = useState<AssistSettings>(() => loadAssist(gameKey));
  /** 마지막으로 보낸 전투 명령(응답 표시용) */
  const [sentCommand, setSentCommand] = useState<AssistCommand | null>(null);
  if (assistKey !== gameKey) {
    setAssistKey(gameKey);
    setAssistSettings(loadAssist(gameKey));
    setSentCommand(null);
  }
  // PC와 휴대폰 보기가 같은 control.json을 쓴다: 쓸 때마다 디스크 파일을 먼저 읽어, 다른 뷰어가 쓴 설정 위에
  // 이 뷰어에서 바꾼 키만 얹는다(doWrite). 게임이 다른 뷰어의 파일을 적용하면 그 설정을 받아들인다(checkForeignControl).
  const assistSupported = connection === "connected" && wfolder !== null
    && versionAtLeast(live?.pluginVersion, ASSIST_MIN_VERSION);
  const controlFile = dataRoot === null ? null : livePaths(dataRoot).controlFile;
  /** 켜진 애드온이 control.json에 싣는 값(예: 화면 그림 기록) + 치트 창이 열렸을 때 liveActors */
  const { controlFlags: addonFlags } = useAddons();
  const [liveActors, setLiveActors] = useState(false);
  const controlFlags = useMemo(() => (liveActors ? { ...addonFlags, liveActors: true } : addonFlags), [addonFlags, liveActors]);
  const cheatSupported = assistSupported && versionAtLeast(live?.pluginVersion, CHEAT_MIN_VERSION);

  /** 쓰기에 필요한 최신 값(비동기·타이머에서 읽는다) */
  const assistLatest = useRef({ supported: false, folder: null as WritableGameFolder | null, controlFile: null as string | null, settings: assistSettings, coverage, index: index as GameIndex | null, gameKey, live: live as LiveSnapshot | null, flags: controlFlags });
  useEffect(() => {
    assistLatest.current = { supported: assistSupported, folder: wfolder, controlFile, settings: assistSettings, coverage, index: index ?? null, gameKey, live, flags: controlFlags };
  });
  /** 마지막으로 성공한 쓰기: 본문(t 제외, 같으면 다시 쓰지 않는다)·t·설정 */
  const lastWritten = useRef<(WrittenControl & { body: string }) | null>(null);
  const lastCommand = useRef<AssistCommand | null>(null);
  /** 단축키 백업·복원 요청에 보낼 마지막 답(at = 답한 시각) */
  const keyReply = useRef<(KeyReply & { at: number }) | null>(null);
  /** 쓰기에 성공한 마지막 명령 id */
  const commandWritten = useRef<string | null>(null);
  const setsCache = useRef<{ coverage: Coverage; index: GameIndex; sets: SeenSets } | null>(null);
  /** 모든 쓰기는 이 사슬로 하나씩. 기다리는 쓰기는 하나로 합친다(queued). */
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef<{ force: boolean; perms: Promise<unknown>[] } | null>(null);
  const writing = useRef(false);
  const writeGen = useRef(0);
  /** controlT가 마지막 쓰기와 어긋나기 시작한 때 / 마지막으로 다시 쓴 때 */
  const mismatchSince = useRef<number | null>(null);
  const lastResyncAt = useRef<number | null>(null);
  /**
   * 이 뷰어에서 바꿨지만 아직 control.json에 쓰지 못한 설정 키 — 디스크(다른 뷰어) 설정 위에 이것만 얹는다.
   * 게임을 켜기 전에 바꾼 설정이 새로 고침 뒤에도 파일에 지지 않도록 localStorage에도 남긴다.
   */
  const dirtyKeys = useRef<Set<AssistKey>>(new Set()); // 게임이 정해지면 아래 효과가 읽는다
  const markDirty = useCallback((keys: Iterable<AssistKey>, on: boolean) => {
    for (const k of keys) {
      if (on) dirtyKeys.current.add(k); else dirtyKeys.current.delete(k);
    }
    saveDirty(assistLatest.current.gameKey, dirtyKeys.current);
  }, []);
  /** 다른 뷰어가 썼는지 보려고 이미 읽어 본 controlT */
  const foreignCheckedT = useRef<number | null>(null);
  /** 이 뷰어가 치트 창을 닫았다: 다음 쓰기에는 다른 뷰어의 liveActors를 이어받지 않고 끈다(한 번). */
  const liveActorsOff = useRef(false);
  const prevLiveActors = useRef(liveActors);
  useEffect(() => {
    if (prevLiveActors.current && !liveActors) liveActorsOff.current = true;
    prevLiveActors.current = liveActors;
  }, [liveActors]);
  /** 치트: 보낼 기록들 / 응답을 기다리는 묶음 / 기록별 상태 */
  const cheatQueue = useRef<{ key: string; ops: CheatOp[] }[]>([]);
  const cheatInflight = useRef<CheatBatch | null>(null);
  const [cheatResults, setCheatResults] = useState<ReadonlyMap<string, CheatStatus>>(() => new Map());
  const putCheatResults = useCallback((entries: Iterable<[string, CheatStatus]>) => {
    setCheatResults((prev) => {
      const m = new Map(prev);
      for (const [k, v] of entries) m.set(k, v);
      return m;
    });
  }, []);

  // 게임이 바뀌면 쓰기 기록을 비운다.
  useEffect(() => {
    writeGen.current++;
    lastWritten.current = null;
    lastCommand.current = null;
    keyReply.current = null;
    commandWritten.current = null;
    setsCache.current = null;
    queued.current = null;
    mismatchSince.current = null;
    lastResyncAt.current = null;
    cheatQueue.current = [];
    cheatInflight.current = null;
    dirtyKeys.current = loadDirty(data ? gameKeyOf(data) : null);
    foreignCheckedT.current = null;
    liveActorsOff.current = false;
  }, [wfolder, data]);

  const updateSettings = useCallback((s: AssistSettings) => {
    setAssistSettings(s);
    saveAssist(assistLatest.current.gameKey, s);
    assistLatest.current = { ...assistLatest.current, settings: s };
  }, []);

  /**
   * 디스크의 control.json(다른 뷰어가 썼을 수 있다)을 받아들인다: 설정은 이 뷰어에서 아직 못 쓴 키(dirty)만 우리 값으로 두고 나머지는 파일 값.
   * 마지막 쓰기도 그 파일로 본다(게임이 적용한 controlT와 맞아 다시 쓰지 않는다).
   */
  const adoptDisk = useCallback((disk: ControlFile) => {
    const cur = assistLatest.current.settings;
    const merged = mergeAssist(disk.settings, cur, dirtyKeys.current);
    if (changedAssistKeys(merged, cur).length > 0) updateSettings(merged);
    lastWritten.current = { body: disk.body, t: disk.t, settings: disk.settings };
  }, [updateSettings]);

  /**
   * control.json을 한 번 쓴다(읽고-고쳐-쓰기). 먼저 디스크 파일을 읽어, 마지막으로 쓴 뒤 다른 뷰어가 썼으면 그 설정을 받아들이고
   * 이 뷰어에서 바꾼 키만 얹는다. 본 것·애드온 값은 이 뷰어 것. 실패는 조용히 넘긴다.
   */
  const doWrite = useCallback(async (force: boolean, perms: Promise<unknown>[]) => {
    const gen = writeGen.current;
    if (perms.length > 0) await Promise.all(perms);
    const cur = assistLatest.current;
    const folderNow = cur.folder;
    const path = cur.controlFile;
    if (!folderNow || !path || !cur.index || writeGen.current !== gen) return;
    const disk = await readControl(folderNow, path);
    if (writeGen.current !== gen) return;
    if (disk && disk.t !== lastWritten.current?.t) adoptDisk(disk);
    let cached = setsCache.current;
    if (!cached || cached.coverage !== cur.coverage || cached.index !== cur.index) {
      cached = { coverage: cur.coverage, index: cur.index, sets: seenSets(cur.coverage, cur.index) };
      setsCache.current = cached;
    }
    const now = Date.now();
    // 다시 쓰기(force)에는 이미 쓴 명령을 다시 싣지 않는다 — 재시작한 게임이 예전 명령을 새 전투에 쓰지 않도록.
    const fresh = lastCommand.current && now - lastCommand.current.at < COMMAND_TTL_MS ? lastCommand.current : null;
    const own = fresh && !(force && commandWritten.current === fresh.id) ? fresh : null;
    // 다른 뷰어가 막 보낸 명령은 게임이 아직 못 읽었을 수 있다 — 우리 명령이 없으면 그대로 다시 싣는다(게임은 같은 id를 한 번만 쓴다).
    const cmd = force ? own : carryCommand(disk, own, now, COMMAND_TTL_MS);
    // 치트 창(liveActors)은 뷰어마다 다르다: 다른 뷰어가 켜 둔 것은 이어받고, 이 뷰어가 막 닫았을 때만 끈다.
    let flags = assistLatest.current.flags;
    const offNow = liveActorsOff.current;
    if (flags.liveActors !== true && disk?.flags.liveActors === true && !offNow) flags = { ...flags, liveActors: true };
    // 단축키 백업·복원의 답은 잠깐만 싣는다(게임은 같은 답을 한 번만 띄운다)
    const reply = keyReply.current;
    if (reply && now - reply.at < KEY_REPLY_TTL_MS) flags = { ...flags, keyReply: { id: reply.id, n: reply.n, text: reply.text } };
    const settings = assistLatest.current.settings;
    const dirtyNow = [...dirtyKeys.current];
    const clearDirty = () => {
      const latest = assistLatest.current.settings;
      markDirty(dirtyNow.filter((k) => JSON.stringify(latest[k]) === JSON.stringify(settings[k])), false);
    };
    const body = controlJson(settings, cached.sets, cmd, 0, flags);
    const prev = lastWritten.current;
    if (!force && prev?.body === body) { clearDirty(); if (offNow) liveActorsOff.current = false; return; }
    const t = Math.max(now, (prev?.t ?? 0) + 1, (disk?.t ?? 0) + 1);
    let ok = false;
    try { ok = await folderNow.writeText(path, controlJson(settings, cached.sets, cmd, t, flags)); } catch { ok = false; }
    if (ok && writeGen.current === gen && assistLatest.current.folder === folderNow) {
      lastWritten.current = { body, t, settings };
      if (cmd && cmd === own) commandWritten.current = cmd.id;
      clearDirty();
      if (offNow) liveActorsOff.current = false;
    }
  }, [adoptDisk, markDirty]);

  /** control.json 쓰기를 사슬에 건다. gesture면 지금(클릭 핸들러 안에서) 쓰기 권한을 요청한다. force면 본문이 같아도 쓴다. */
  const requestControlWrite = useCallback((opts: { gesture?: boolean; force?: boolean } = {}) => {
    const folderNow = assistLatest.current.folder;
    const perm = opts.gesture && folderNow ? folderNow.requestWrite().catch(() => false) : null;
    const q = queued.current;
    if (q) {
      q.force ||= opts.force === true;
      if (perm) q.perms.push(perm);
      return;
    }
    const next = { force: opts.force === true, perms: perm ? [perm] : [] };
    queued.current = next;
    writeChain.current = writeChain.current.then(async () => {
      if (queued.current !== next) return;
      queued.current = null;
      writing.current = true;
      try { await doWrite(next.force, next.perms); } catch { /* 조용히 */ } finally { writing.current = false; }
    });
  }, [doWrite]);

  const setSettings = useCallback((next: AssistSettings) => {
    const n = normalizeAssist(next);
    markDirty(changedAssistKeys(n, assistLatest.current.settings), true);
    updateSettings(n);
    if (assistLatest.current.supported) requestControlWrite({ gesture: true });
  }, [markDirty, updateSettings, requestControlWrite]);

  /**
   * 게임이 다른 뷰어(PC·휴대폰)의 control.json을 적용했으면(controlT가 우리가 쓴 것과 다름) 그 파일을 읽어 설정을 받아들인다.
   * 다시 쓰지는 않는다 — 이 뷰어가 치트 창을 열어 둔 채(liveActors) 그 파일에 빠졌을 때만 다시 쓴다.
   */
  const checkForeignControl = useCallback((controlT: number) => {
    const gen = writeGen.current;
    writeChain.current = writeChain.current.then(async () => {
      const cur = assistLatest.current;
      if (!cur.folder || !cur.controlFile || writeGen.current !== gen) return;
      const disk = await readControl(cur.folder, cur.controlFile);
      if (!disk || disk.t !== controlT || writeGen.current !== gen || disk.t === lastWritten.current?.t) return;
      adoptDisk(disk);
      mismatchSince.current = null;
      if (assistLatest.current.flags.liveActors === true && disk.flags.liveActors !== true) requestControlWrite();
    }).catch(() => { /* 조용히 */ });
  }, [adoptDisk, requestControlWrite]);

  const sendCommand = useCallback((kind: AssistCommandKind) => {
    if (!assistLatest.current.supported) return;
    const at = Date.now();
    const command: AssistCommand = { id: `c-${at}-${VIEWER_TAG}`, kind, at };
    lastCommand.current = command;
    setSentCommand(command);
    requestControlWrite({ gesture: true });
  }, [requestControlWrite]);

  const replyKeyRequest = useCallback((id: string, text: string) => {
    keyReply.current = { id, n: ++keyReplySeq, text, at: Date.now() };
    requestControlWrite();
  }, [requestControlWrite]);

  /** 기다리는 치트를 명령 하나로 묶어 보낸다(응답을 기다리는 묶음이 없을 때만). */
  const pumpCheat = useCallback((gesture: boolean) => {
    if (cheatInflight.current || !assistLatest.current.supported) return;
    const at = Date.now();
    const r = makeBatch(cheatQueue.current, `x-${at}-${++cheatSeq}-${VIEWER_TAG}`, at);
    if (!r) { cheatQueue.current = []; return; }
    cheatQueue.current = r.rest;
    cheatInflight.current = r.batch;
    lastCommand.current = { id: r.batch.id, kind: "cheat", at, ops: r.batch.ops };
    putCheatResults(r.batch.entries.map((e): [string, CheatStatus] => [e.key, "sent"]));
    requestControlWrite({ gesture });
  }, [putCheatResults, requestControlWrite]);

  const cheatSupportedRef = useRef(false);
  useEffect(() => { cheatSupportedRef.current = cheatSupported; }, [cheatSupported]);
  const sendCheat = useCallback((ops: CheatOp[]): string[] => {
    if (!cheatSupportedRef.current || !Array.isArray(ops) || ops.length === 0) return [];
    if (!ops.every((o) => validCheatOp(o, data ?? null))) return [];
    const keys = splitOps(ops).map((chunk) => {
      const key = `k-${Date.now()}-${++cheatSeq}`;
      cheatQueue.current.push({ key, ops: chunk });
      return key;
    });
    putCheatResults(keys.map((k): [string, CheatStatus] => [k, "queued"]));
    pumpCheat(true);
    return keys;
  }, [data, putCheatResults, pumpCheat]);

  // 치트 응답: live.json `assist.lastCommand`가 묶음 id면 기록별 결과를 적고 다음 묶음을 보낸다.
  const liveLastCommand = live?.assist?.lastCommand;
  useEffect(() => {
    const b = cheatInflight.current;
    if (!b) return;
    const res = batchResults(b, liveLastCommand);
    if (!res) return;
    cheatInflight.current = null;
    putCheatResults(res);
    pumpCheat(false);
  }, [liveLastCommand, putCheatResults, pumpCheat]);
  // 응답이 너무 늦으면 응답 없음
  useEffect(() => {
    const id = setInterval(() => {
      const b = cheatInflight.current;
      if (!b || Date.now() - b.at < CHEAT_RESPONSE_MS) return;
      cheatInflight.current = null;
      putCheatResults(b.entries.map((e): [string, CheatStatus] => [e.key, "noResponse"]));
      pumpCheat(false);
    }, 1000);
    return () => clearInterval(id);
  }, [putCheatResults, pumpCheat]);

  // 연결되면(또는 플러그인이 1.1.0 이상이 되면) 바로 한 번 쓴다(권한이 이미 있을 때만 성공).
  useEffect(() => {
    if (assistSupported) requestControlWrite();
  }, [assistSupported, wfolder, requestControlWrite]);

  // 애드온을 켜고 끄면 바로 다시 쓴다(본문이 같으면 doWrite가 건너뛴다).
  const flagsKey = JSON.stringify(controlFlags);
  useEffect(() => {
    if (assistSupported) requestControlWrite();
  }, [assistSupported, flagsKey, requestControlWrite]);

  // 진행도가 바뀌면 3초 조용할 때 본 것 묶음을 다시 쓴다.
  useEffect(() => {
    if (!assistSupported) return;
    const id = setTimeout(() => requestControlWrite(), ASSIST_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [assistSupported, coverage, index, requestControlWrite]);

  /**
   * 게임과 맞추기:
   * - 게임 창 단축키로 바뀐 배속·본 대사 넘기기를 받아들인다(게임이 우리 마지막 파일을 적용한 뒤 바꾼 값만).
   * - 게임이 적용한 파일(controlT)이 마지막 쓰기와 3초 넘게 다르면 다시 쓴다(게임 재시작·F5, 시작 전 파일 무시). 5초에 한 번까지.
   */
  const syncWithGame = useCallback(() => {
    const cur = assistLatest.current;
    if (!cur.supported) { mismatchSince.current = null; return; }
    const a = cur.live?.assist;
    const pending = queued.current !== null || writing.current;
    const patch = adoptLiveAssist(a, lastWritten.current, cur.settings, pending);
    if (patch) {
      markDirty(Object.keys(patch) as AssistKey[], true);
      updateSettings(normalizeAssist({ ...cur.settings, ...patch }));
      requestControlWrite();
      return;
    }
    // 다른 뷰어가 쓴 파일을 게임이 적용했다 → 그 설정을 받아들인다(controlT 하나에 한 번 읽는다).
    const ct = a && typeof a.controlT === "number" ? a.controlT : null;
    if (!pending && ct !== null && ct !== lastWritten.current?.t && ct !== foreignCheckedT.current) {
      foreignCheckedT.current = ct;
      checkForeignControl(ct);
    }
    const now = Date.now();
    if (!pending && controlMismatch(a, lastWritten.current?.t ?? null)) mismatchSince.current ??= now;
    else mismatchSince.current = null;
    if (resyncDue(mismatchSince.current, lastResyncAt.current, now)) {
      lastResyncAt.current = now;
      mismatchSince.current = null;
      requestControlWrite({ force: true });
    }
  }, [markDirty, updateSettings, requestControlWrite, checkForeignControl]);

  useEffect(() => {
    if (!assistSupported) return;
    syncWithGame();
    const id = setInterval(syncWithGame, 1000);
    return () => clearInterval(id);
  }, [assistSupported, live, syncWithGame]);

  const assistValue = useMemo<AssistValue>(
    () => ({
      settings: assistSettings, setSettings, sendCommand, sentCommand, supported: assistSupported,
      cheatSupported, sendCheat, cheatResults, setLiveActors, replyKeyRequest,
    }),
    [assistSettings, setSettings, sendCommand, sentCommand, assistSupported, cheatSupported, sendCheat, cheatResults, replyKeyRequest],
  );

  return (
    <LiveContext.Provider value={value}>
      <LiveStatusContext.Provider value={statusValue}>
        <AssistContext.Provider value={assistValue}>
          <LiveDataContext.Provider value={liveDataValue}>{children}</LiveDataContext.Provider>
        </AssistContext.Provider>
      </LiveStatusContext.Provider>
    </LiveContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLive(): LiveContextValue {
  const v = useContext(LiveContext);
  if (!v) throw new Error("useLive must be used within LiveProvider");
  return v;
}

/** 게임 보조 설정·전투 조작. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAssist(): AssistValue {
  const v = useContext(AssistContext);
  if (!v) throw new Error("useAssist must be used within LiveProvider");
  return v;
}

/**
 * 실행 중 화면(읽기·기록·선택지·치트 등)이 글을 풀 때 쓰는 GameData: useGame().data에 게임 중에 바뀐 캐릭터 이름
 * (live.json actorNames, 플러그인 1.20.1+)을 넣은 것. 바뀐 이름이 없으면 useGame().data 그대로.
 * 스크립트 보기 등 원본 데이터 화면은 useGame().data를 쓴다.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useLiveData(): GameData | undefined {
  const v = useContext(LiveDataContext);
  if (!v) throw new Error("useLiveData must be used within LiveProvider");
  return v.data;
}

/** 자주 바뀌는 연결 상태값(lastSeenT·lastLive·logStats). 이 값이 필요한 작은 컴포넌트만 쓴다. */
// eslint-disable-next-line react-refresh/only-export-components
export function useLiveStatus(): LiveStatusValue {
  const v = useContext(LiveStatusContext);
  if (!v) throw new Error("useLiveStatus must be used within LiveProvider");
  return v;
}
