import { useEffect, useState } from "react";
import { useLive, useLiveStatus } from "@/app/LiveProvider";
import { branchLabel } from "@/core/live/history";
import { isRemoteView } from "@/app/share";

function agoText(lastSeenT: number | null, now: number): string {
  if (lastSeenT === null) return "";
  const min = Math.floor(Math.max(0, now - lastSeenT) / 60000);
  return min < 1 ? "방금" : `${min}분 전`;
}

/** 연결 상태 글과 모양(상단 Badge·휴대폰 더보기 메뉴 공용) */
export function useConnectionStatus(): { text: string; variant: "secondary" | "outline"; muted: boolean; connected: boolean } {
  const { connection, model, supported, install } = useLive();
  const { lastLive, lastSeenT } = useLiveStatus();
  const [now, setNow] = useState(() => Date.now());

  // "N분 전" 갱신용 시계(자기 재예약)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(Date.now()); timer = setTimeout(tick, 15000); };
    timer = setTimeout(tick, 15000);
    return () => clearTimeout(timer);
  }, []);

  let text: string;
  let variant: "secondary" | "outline" = "outline";
  let muted = false;
  if (supported && install === null) {
    // 설치 상태를 읽는 중: "플러그인 미설치"가 깜빡이지 않게
    text = "확인 중…";
    muted = true;
  } else if (connection === "connected") {
    const branch = lastLive?.branch ?? model.latestBranch;
    text = branch !== null && branch !== undefined ? `● 연결됨 · ${branchLabel(model, branch)}` : "● 연결됨";
    variant = "secondary";
  } else if (connection === "stale") {
    text = lastSeenT !== null ? `○ 게임 꺼짐 · 마지막 기록 ${agoText(lastSeenT, now)}` : "○ 게임 꺼짐";
  } else if (connection === "waiting") {
    text = "○ 게임 꺼짐";
  } else {
    // 휴대폰 보기에서는 설치할 수 없으니 설치 안내 대신 꺼짐으로만 보여 준다
    text = isRemoteView() ? "○ 게임 꺼짐" : "플러그인 미설치";
  }

  return { text, variant, muted, connected: connection === "connected" };
}
