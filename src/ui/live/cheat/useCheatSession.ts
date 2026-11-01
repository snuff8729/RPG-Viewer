import { useCallback, useRef, useState } from "react";
import { isRemoteView } from "@/app/share";
import { useAssist, useLive, useLiveData } from "@/app/LiveProvider";
import { loadAutoBackup, makeBackup, notifyBackupsChanged } from "@/app/backups";
import { describeCheatOp, inverseCheatOps, undoable, type CheatOp } from "@/core/live/cheat";
import { gameKeyOf } from "../readPosition";
import { useGamePath, useLauncherAvailable } from "../useGamePath";
import { useVariableFinder, type VariableFinder } from "./useVariableFinder";

/** 이번 세션에 `치트 전` 자동 백업을 한 게임 */
const backedUp = new Set<string>();
const HISTORY_MAX = 30;

export interface HistoryEntry {
  n: number; label: string; keys: string[];
  /** 되돌리기 op(없으면 되돌릴 수 없음) */
  inverse: CheatOp[] | null;
  undone: boolean;
}

/**
 * 치트 창의 남는 상태: 바꾼 것 기록, 보던 탭, 변수 찾기, 백업 안내.
 * 창(Sheet)을 닫았다 열어도 남도록 덮개 쪽(항상 그려진 곳)에서 부른다. 게임이 바뀌면 기록을 비운다.
 */
export interface CheatSession {
  history: HistoryEntry[];
  apply(ops: CheatOp[], label?: string): void;
  undo(e: HistoryEntry): void;
  tab: string;
  setTab(t: string): void;
  finder: VariableFinder;
}

/** initialTab = 처음 보일 치트 탭(variables · items · actors · switches). */
export function useCheatSession(initialTab = "variables"): CheatSession {
  const data = useLiveData();
  const { live } = useLive();
  const { sendCheat } = useAssist();
  // 휴대폰 보기에서는 백업하지 않는다(PC에서)
  const launcher = useLauncherAvailable();
  const available = launcher && !isRemoteView();
  const gameKey = data ? gameKeyOf(data) : null;
  const { path } = useGamePath(gameKey);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const seq = useRef(0);
  // 창을 닫았다 열어도 보던 탭과 변수 찾기 상태가 남는다(게임에서 값을 바꾸고 돌아오는 흐름)
  const [tab, setTab] = useState<string>(initialTab);
  const finder = useVariableFinder(gameKey, live);

  // 게임이 바뀌면 기록을 비운다
  const [historyKey, setHistoryKey] = useState(gameKey);
  if (historyKey !== gameKey) { setHistoryKey(gameKey); setHistory([]); }

  const apply = useCallback((ops: CheatOp[], label?: string) => {
    if (!data || ops.length === 0) return;
    const keys = sendCheat(ops);
    if (keys.length === 0) return;
    // 이번 세션 첫 치트 전에 자동 백업(세이브 파일은 치트로 바뀌지 않으므로 기다리지 않는다)
    if (gameKey && !backedUp.has(gameKey)) {
      backedUp.add(gameKey);
      if (available && path && loadAutoBackup(gameKey)) {
        void makeBackup(path, "auto", "치트 전").then((r) => { if (r.ok && !r.skipped) notifyBackupsChanged(); });
      }
    }
    const text = label ?? (ops.length === 1 ? describeCheatOp(ops[0], data) : `${describeCheatOp(ops[0], data)} 외 ${ops.length - 1}개`);
    const inverse = undoable(ops) ? inverseCheatOps(ops, live) : null;
    setHistory((h) => [{ n: ++seq.current, label: text, keys, inverse, undone: false }, ...h].slice(0, HISTORY_MAX));
  }, [data, sendCheat, gameKey, available, path, live]);

  const undo = (e: HistoryEntry) => {
    if (!e.inverse) return;
    setHistory((h) => h.map((x) => (x.n === e.n ? { ...x, undone: true } : x)));
    apply(e.inverse, `되돌리기: ${e.label}`);
  };


  return {
    history, apply, undo, tab, setTab, finder,
  };
}
