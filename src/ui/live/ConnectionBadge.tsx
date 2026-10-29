import { useEffect, useState } from "react";
import { useLive, useLiveStatus } from "@/app/LiveProvider";
import { branchLabel } from "@/core/live/history";
import { isRemoteView } from "@/app/share";
import { Badge } from "@/components/ui/badge";
import { InstallDialog } from "./InstallDialog";

function agoText(lastSeenT: number | null, now: number): string {
  if (lastSeenT === null) return "";
  const min = Math.floor(Math.max(0, now - lastSeenT) / 60000);
  return min < 1 ? "방금" : `${min}분 전`;
}

/** 상단 연결 상태 Badge. 클릭하면 설치 Dialog. */
export function ConnectionBadge() {
  const { connection, model, supported, install } = useLive();
  const { lastLive, lastSeenT } = useLiveStatus();
  const [open, setOpen] = useState(false);
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

  const badge = <Badge variant={variant} className={muted ? "text-muted-foreground" : undefined}>{text}</Badge>;
  // 휴대폰 보기에서는 플러그인을 설치·제거하지 않는다
  if (isRemoteView()) return badge;
  return (
    <>
      <button type="button" className="rounded-full" onClick={() => setOpen(true)}>
        {badge}
      </button>
      <InstallDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
