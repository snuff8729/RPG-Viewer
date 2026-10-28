import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGame } from "./GameProvider";
import { useLive } from "./LiveProvider";
import { useAddons } from "./AddonsProvider";
import { BUNDLED_ADAPTERS } from "./adapterBundle";
import { diagnoseGame, gatherDiagnosisInput, type DiagnosisReport, type GatheredInput } from "@/core/diagnose";
import type { LogRecord } from "@/core/live/types";

/** 게임 자동 진단: 게임을 열면 한 번, `다시 분석`을 누르면 그때의 플레이 기록까지 넣어 다시. */
export interface DiagnosisValue {
  /** 진단 결과(재료를 읽는 중이면 null) */
  report: DiagnosisReport | null;
  /** 재료(플러그인 본문·그림 목록)를 읽는 중 */
  loading: boolean;
  /** 지금까지의 플레이 기록을 넣어 다시 진단한다(플러그인 본문·그림 목록도 다시 읽는다) */
  rerun(): void;
}

const NONE: DiagnosisValue = { report: null, loading: false, rerun: () => {} };
const DiagnosisContext = createContext<DiagnosisValue | null>(null);

interface Gathered { data: unknown; input: GatheredInput; log: LogRecord[] | null }

export function DiagnosisProvider({ children }: { children: ReactNode }) {
  const { status, data, folder } = useGame();
  const { records, caughtUp } = useLive();
  const addons = useAddons();
  const ready = status === "ready" && !!data && !!folder;
  const [nonce, setNonce] = useState(0);
  const [gathered, setGathered] = useState<Gathered | null>(null);
  const recordsRef = useRef<LogRecord[]>(records);
  useEffect(() => { recordsRef.current = records; }, [records]);
  const snapshot = () => (recordsRef.current.length > 0 ? recordsRef.current.slice() : null);

  // 게임을 열 때, 기록을 끝까지 읽었을 때(그 기록까지 넣어), `다시 분석`을 누를 때 진단 재료를 읽는다
  useEffect(() => {
    if (!ready || !folder || !data) return;
    let cancelled = false;
    void gatherDiagnosisInput(folder, data).then((input) => {
      if (!cancelled) setGathered({ data, input, log: snapshot() });
    });
    return () => { cancelled = true; };
  }, [ready, folder, data, nonce, caughtUp]);

  const rerun = useCallback(() => setNonce((n) => n + 1), []);
  const current = gathered && gathered.data === data ? gathered : null;
  const { state, enabledAdapters, spriteRoles } = addons;
  const report = useMemo(() => {
    if (!current || !data) return null;
    const adapters = Object.fromEntries(enabledAdapters.map((a) => [a.manifest.id, true]));
    return diagnoseGame(data, current.input.pluginsText, current.input.files, current.log, {
      pluginSources: current.input.pluginSources,
      adapters: BUNDLED_ADAPTERS.map((a) => a.manifest),
      settings: { addons: state, adapters, spriteRoles },
    });
  }, [current, data, state, enabledAdapters, spriteRoles]);

  const value = useMemo<DiagnosisValue>(
    () => ({ report, loading: ready && !current, rerun }),
    [report, ready, current, rerun],
  );
  return <DiagnosisContext.Provider value={value}>{children}</DiagnosisContext.Provider>;
}

/** 게임 자동 진단. DiagnosisProvider 밖에서는 없음. */
// eslint-disable-next-line react-refresh/only-export-components
export function useDiagnosis(): DiagnosisValue {
  return useContext(DiagnosisContext) ?? NONE;
}
