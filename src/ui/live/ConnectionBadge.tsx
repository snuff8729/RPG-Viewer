import { useState } from "react";
import { isRemoteView } from "@/app/share";
import { Badge } from "@/components/ui/badge";
import { InstallDialog } from "./InstallDialog";
import { useConnectionStatus } from "./useConnectionStatus";

/** 상단 연결 상태 Badge. 클릭하면 설치 Dialog. */
export function ConnectionBadge() {
  const { text, variant, muted } = useConnectionStatus();
  const [open, setOpen] = useState(false);
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
