import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import pluginSource from "../../plugin/RPGViewerBridge.js?raw";
import { useGame } from "./GameProvider";
import { isWritableFolder, type WritableGameFolder } from "@/core/fs/folder";
import { buildHistory } from "@/core/live/history";
import { createAccumulator, type LiveAccumulator } from "@/core/live/accumulator";
import { conditionsKey } from "@/core/live/interactable";
import { computeMissing } from "@/core/live/missing";
import { getInstallStatus, install as installPlugin, livePaths, pluginVersionOf, uninstall as uninstallPlugin, type InstallResult, type InstallStatus } from "@/core/live/installer";
import { LogTail, readLive } from "@/core/live/tail";
import type { Coverage, HistoryModel, LiveSnapshot, LogRecord, MissingItem } from "@/core/live/types";

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
const EMPTY_COVERAGE: Coverage = { seen: new Set(), picks: new Map(), uncertainSeqs: new Set(), changedSeqs: new Set() };
const EMPTY_NOISY = new Set<number>();

/**
 * 폴링이 본 최신 기록 상태(변경 즉시 갱신). 파생값은 Derived로 따로 스로틀한다.
 * gen: 누적기마다 다른 번호 — 새 누적기의 version이 이전 누적기의 version과 같아도 섞이지 않게 (gen, version)으로 구분한다.
 */
interface TailInfo { gen: number; version: number; count: number; lastT: number | null; badLines: number; bytes: number | null }
const EMPTY_TAIL: TailInfo = { gen: 0, version: 0, count: 0, lastT: null, badLines: 0, bytes: null };

/** 스로틀된 파생 순간의 누적기 스냅숏(모두 이후 append로 바뀌지 않는다). */
interface Derived { gen: number; version: number; records: LogRecord[]; model: HistoryModel; coverage: Coverage; noisy: Set<number> }

const LiveContext = createContext<LiveContextValue | null>(null);
const LiveStatusContext = createContext<LiveStatusValue | null>(null);

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
  const accRef = useRef<{ acc: LiveAccumulator; gen: number } | null>(null);
  const genCounter = useRef(0);

  // 폴링: 자기 재예약 setTimeout(setInterval 아님). 숨겨진 탭이면 건너뛴다. more면 바로 다시.
  useEffect(() => {
    if (!wfolder || dataRoot === null || !data) return;
    const paths = livePaths(dataRoot);
    const tail = new LogTail(wfolder, paths.logFile);
    const acc = createAccumulator(data);
    const gen = ++genCounter.current;
    const entry = { acc, gen };
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
          const res = await tail.poll();
          if (cancelled) return;
          if (res.changed) {
            // 새 기록만 누적기에 붙인다. reset이면 비우고 다시 쌓는다.
            if (res.reset) { acc.reset(); bad = 0; }
            acc.append(res.records);
            bad += res.badLines;
            // 기록 크기: 바뀐 주기에만 stat 한 번(LogTail은 고치지 않는다).
            let bytes: number | null = null;
            try { bytes = (await wfolder.stat(paths.logFile))?.size ?? null; } catch { bytes = null; }
            if (cancelled) return;
            const recs = acc.records;
            setTailInfo({
              gen, version: acc.version, count: recs.length, lastT: recs.length > 0 ? recs[recs.length - 1].t : null,
              badLines: bad, bytes,
            });
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
  }, [wfolder, dataRoot, data]);

  // DEV 시뮬레이터
  useEffect(() => {
    if (!import.meta.env.DEV || !wfolder || dataRoot === null) return;
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
  useEffect(() => {
    const wait = Math.max(0, lastDeriveAt.current + DERIVE_MS - Date.now());
    const id = setTimeout(() => {
      lastDeriveAt.current = Date.now();
      const cur = accRef.current;
      if (!cur || cur.acc.records.length === 0) { setDerived(null); return; }
      const { acc, gen } = cur;
      const v = acc.version;
      setDerived((prev) => (prev && prev.gen === gen && prev.version === v
        ? prev
        : { gen, version: v, records: acc.records.slice(), model: acc.model(), coverage: acc.coverage(), noisy: acc.noisy() }));
    }, wait);
    return () => clearTimeout(id);
  }, [tailGen, tailVersion]);

  const derivedRecords = derived?.records ?? EMPTY_RECORDS;
  const model = derived?.model ?? EMPTY_MODEL;
  const coverage = derived?.coverage ?? EMPTY_COVERAGE;
  const noisy = derived?.noisy ?? EMPTY_NOISY;
  const badLines = tailInfo.badLines;

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
  }), [supported, install, refreshInstall, doInstall, doUninstall, connection, derivedRecords, badLines, model, coverage, live, missing, noisy]);

  const statusValue = useMemo<LiveStatusValue>(() => ({ lastSeenT, lastLive, logStats }), [lastSeenT, lastLive, logStats]);

  return (
    <LiveContext.Provider value={value}>
      <LiveStatusContext.Provider value={statusValue}>{children}</LiveStatusContext.Provider>
    </LiveContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLive(): LiveContextValue {
  const v = useContext(LiveContext);
  if (!v) throw new Error("useLive must be used within LiveProvider");
  return v;
}

/** 자주 바뀌는 연결 상태값(lastSeenT·lastLive·logStats). 이 값이 필요한 작은 컴포넌트만 쓴다. */
// eslint-disable-next-line react-refresh/only-export-components
export function useLiveStatus(): LiveStatusValue {
  const v = useContext(LiveStatusContext);
  if (!v) throw new Error("useLiveStatus must be used within LiveProvider");
  return v;
}
