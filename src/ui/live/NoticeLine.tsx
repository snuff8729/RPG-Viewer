import { Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";

/** 알림 문구 한 줄(티커·코멘트 등): 흐린 글 + 확성기 아이콘. source = 출처 이름(마우스를 올리면 보인다) */
export function NoticeLine({ text, source, className }: { text: string; source: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2 text-sm text-muted-foreground", className)} title={source}>
      <Megaphone className="mt-0.5 size-4 shrink-0" aria-label={source} />
      <p className="min-w-0 whitespace-pre-wrap break-words">{text}</p>
    </div>
  );
}
