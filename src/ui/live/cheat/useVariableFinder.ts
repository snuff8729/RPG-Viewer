import { useState } from "react";
import { emptyTracker, trackVariables, type ChangeTracker, type NarrowState } from "@/core/live/varFinder";
import type { LiveSnapshot } from "@/core/live/types";

export type FinderMode = "name" | "value" | "narrow" | "recent";

/** 변수 찾기 상태: 치트 창을 닫았다 열어도(게임에서 값을 바꾸고 돌아와도) 남는다. 게임이 바뀌면 비운다. */
export interface VariableFinder {
  kind: "switch" | "variable";
  setKind(k: "switch" | "variable"): void;
  mode: FinderMode;
  setMode(m: FinderMode): void;
  /** 좁혀 찾기 후보(null = 아직 기억 안 함) */
  narrow: NarrowState | null;
  setNarrow(s: NarrowState | null): void;
  /** 연결된 동안 계속 보는 최근 바뀐 변수 */
  tracker: ChangeTracker;
}

export function useVariableFinder(gameKey: string | null, live: LiveSnapshot | null): VariableFinder {
  const [kind, setKind] = useState<"switch" | "variable">("switch");
  const [mode, setMode] = useState<FinderMode>("name");
  const [narrow, setNarrow] = useState<NarrowState | null>(null);
  const [tracker, setTracker] = useState<ChangeTracker>(emptyTracker);
  const [key, setKey] = useState(gameKey);
  const [seen, setSeen] = useState<LiveSnapshot | null>(null);
  if (key !== gameKey) { setKey(gameKey); setNarrow(null); setTracker(emptyTracker()); setSeen(null); }
  else if (seen !== live) {
    // 새 live.json(값이 바뀐 것만 새 객체)마다 바뀐 변수를 적는다. 시각은 live.json을 쓴 시각
    // (뷰어도 게임 시계와 비교해 연결 여부를 판단하므로 같은 시계로 본다)
    setSeen(live);
    setTracker((t) => trackVariables(t, live, typeof live?.t === "number" ? live.t : 0));
  }
  return { kind, setKind, mode, setMode, narrow, setNarrow, tracker };
}
