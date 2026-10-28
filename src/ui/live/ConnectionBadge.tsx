import { useEffect, useState } from "react";
import { useLive } from "@/app/LiveProvider";
import { branchLabel } from "@/core/live/history";
import { Badge } from "@/components/ui/badge";
import { InstallDialog } from "./InstallDialog";

function agoText(lastSeenT: number | null, now: number): string {
  if (lastSeenT === null) return "";
  const min = Math.floor(Math.max(0, now - lastSeenT) / 60000);
  return min < 1 ? "방금" : `${min}분 전`;
}

/** 상단 연결 상태 Badge. 클릭하면 설치 Dialog. */
export function ConnectionBadge() {
  const { connection, live, model, lastSeenT } = useLive();
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
  if (connection === "connected") {
    const branch = live?.branch ?? model.latestBranch;
    text = branch !== null && branch !== undefined ? `● 연결됨 · ${branchLabel(model, branch)}` : "● 연결됨";
    variant = "secondary";
  } else if (connection === "stale") {
    text = lastSeenT !== null ? `○ 게임 꺼짐 · 마지막 기록 ${agoText(lastSeenT, now)}` : "○ 게임 꺼짐";
  } else if (connection === "waiting") {
    text = "○ 게임 꺼짐";
  } else {
    text = "플러그인 미설치";
  }

  return (
    <>
      <button type="button" className="rounded-full" onClick={() => setOpen(true)}>
        <Badge variant={variant}>{text}</Badge>
      </button>
      <InstallDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
