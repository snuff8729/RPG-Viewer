import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import pluginSource from "../../plugin/RPGViewerBridge.js?raw";
import { useGame } from "./GameProvider";
import { isWritableFolder, type WritableGameFolder } from "@/core/fs/folder";
import { buildHistory, noisyVariables } from "@/core/live/history";
import { computeCoverage } from "@/core/live/coverage";
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
  /** live.t와 마지막 기록 t 중 최신 */
  lastSeenT: number | null;
  records: LogRecord[];
  badLines: number;
  model: HistoryModel;
  coverage: Coverage;
  live: LiveSnapshot | null;
  missing: MissingItem[];
  /** noisyVariables(records) — foldTimeline opts.noisy로 넘긴다. */
  noisy: Set<number>;
  /** coverage.uncertainSeqs — foldTimeline opts.uncertainSeqs로 넘긴다. */
  uncertainSeqs: Set<number>;
  /** model.latestBranch */
  latestBranch: number | null;
  /** 뷰어에 들어 있는 플러그인 버전 */
  bundledVersion: string;
}

const bundledVersion = pluginVersionOf(pluginSource) ?? "";
const POLL_MS = 500;
const FRESH_MS = 5000;
const UNSUPPORTED_FOLDER = "크롬이나 엣지에서 폴더 열기로 연 게임만 지원해요";
const NO_WRITE = "쓰기 권한이 필요해요";

const LiveContext = createContext<LiveContextValue | null>(null);

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
  const [records, setRecords] = useState<LogRecord[]>([]);
  const [badLines, setBadLines] = useState(0);
  const [live, setLive] = useState<LiveSnapshot | null>(null);
  const [liveState, setLiveState] = useState<LiveSnapshot | null>(null);
  const [fresh, setFresh] = useState(false);

  // 게임(폴더)이 바뀌면 렌더 중에 상태를 비운다(React 권장 패턴: 이전 값과 비교).
  const [prevFolder, setPrevFolder] = useState<WritableGameFolder | null>(wfolder);
  if (prevFolder !== wfolder) {
    setPrevFolder(wfolder);
    setInstall(null);
    setRecords([]);
    setBadLines(0);
    setLive(null);
    setLiveState(null);
    setFresh(false);
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

  // 폴링: 자기 재예약 setTimeout(setInterval 아님). 숨겨진 탭이면 건너뛴다. more면 바로 다시.
  useEffect(() => {
    if (!wfolder || dataRoot === null) return;
    const paths = livePaths(dataRoot);
    const tail = new LogTail(wfolder, paths.logFile);
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
            // 바뀐 주기에만 새 배열(누적 + 새 기록). reset이면 비우고 다시 쌓는다.
            const added = res.records;
            setRecords((prev) => (res.reset ? added : added.length > 0 ? prev.concat(added) : prev));
            setBadLines((b) => (res.reset ? res.badLines : b + res.badLines));
          }
          again = res.more;
          const lv = await readLive(wfolder, paths.liveFile, liveModified);
          if (cancelled) return;
          if (lv.changed && lv.snapshot) {
            liveModified = lv.modified;
            const snap = lv.snapshot;
            lastLiveT = snap.t;
            setLive(snap);
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
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer); };
  }, [wfolder, dataRoot]);

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

  const model = useMemo(() => buildHistory(records), [records]);
  const noisy = useMemo(() => noisyVariables(records), [records]);
  const coverage = useMemo<Coverage>(
    () => (data ? computeCoverage(records, data) : { seen: new Set(), picks: new Map(), uncertainSeqs: new Set() }),
    [records, data],
  );
  const missing = useMemo(
    () => (data && index ? computeMissing(index, data, coverage, liveState) : []),
    [index, data, coverage, liveState],
  );

  const lastRecordT = records.length > 0 ? records[records.length - 1].t : null;
  const lastSeenT = live && lastRecordT !== null ? Math.max(live.t, lastRecordT) : (live?.t ?? lastRecordT);

  let connection: Connection;
  if (!supported || !install || install.state !== "installed") connection = "noPlugin";
  else if (!live && records.length === 0) connection = "waiting";
  else if (fresh) connection = "connected";
  else connection = "stale";

  const value = useMemo<LiveContextValue>(() => ({
    supported, install, refreshInstall, doInstall, doUninstall,
    connection, lastSeenT, records, badLines, model, coverage, live, missing,
    noisy, uncertainSeqs: coverage.uncertainSeqs, latestBranch: model.latestBranch, bundledVersion,
  }), [supported, install, refreshInstall, doInstall, doUninstall, connection, lastSeenT, records, badLines, model, coverage, live, missing, noisy]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLive(): LiveContextValue {
  const v = useContext(LiveContext);
  if (!v) throw new Error("useLive must be used within LiveProvider");
  return v;
}
