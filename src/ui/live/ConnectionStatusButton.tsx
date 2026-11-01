import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConnectionActionButton, useConnectionAction } from "./ConnectionAction";
import { useConnectionStatus } from "./useConnectionStatus";
import { terms } from "@/ui/terms";

/** 연결 상태 창의 다음 동작(연결 안내·알림 줄과 같은 동작이에요). */
export function ConnectionNextAction() {
  const ctl = useConnectionAction();
  const action = ctl.guide?.action ?? null;
  return (
    <div className="space-y-2">
      {ctl.status.remote && !ctl.status.connected && <p className="text-sm text-muted-foreground">{terms.pcOnly}</p>}
      {action && action !== "manage" && <ConnectionActionButton action={action} ctl={ctl} />}
      {ctl.dialog}
    </div>
  );
}

export function ConnectionStatusButton() {
  const status = useConnectionStatus();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5">
          <span aria-hidden className={`size-2 rounded-full ${status.dot}`} />
          {status.text}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="space-y-3">
        <p className="text-sm">{status.description}</p>
        <ConnectionNextAction />
        <Button variant="link" className="h-auto p-0" asChild>
          <a href="#/manage/connection" onClick={() => setOpen(false)}>
            관리에서 자세히
          </a>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
