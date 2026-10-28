import { Coins, Megaphone, Package, ScrollText, Trophy } from "lucide-react";
import { isMoneyOrExp, NOTICE_KIND_LABELS, type NoticeKind } from "@/core/addons/notices";
import { cn } from "@/lib/utils";

/** 알림 종류의 아이콘(획득은 돈·경험치면 동전, 아이템이면 상자) */
export function NoticeIcon({ kind, text = "", className, label }: { kind: NoticeKind; text?: string; className?: string; label?: string }) {
  const p = { className, "aria-label": label };
  if (kind === "achievement") return <Trophy {...p} />;
  if (kind === "quest") return <ScrollText {...p} />;
  if (kind === "gain") return isMoneyOrExp(text) ? <Coins {...p} /> : <Package {...p} />;
  return <Megaphone {...p} />;
}

/**
 * 알림 문구 한 줄(티커·토스트·업적 등): 흐린 글 + 종류 아이콘. source = 출처 이름, kind = 업적·획득·퀘스트·알림
 * (마우스를 올리면 `종류 · 출처`가 보인다)
 */
export function NoticeLine({ text, source, kind = "info", className }: { text: string; source: string; kind?: NoticeKind; className?: string }) {
  const label = NOTICE_KIND_LABELS[kind] ?? "알림";
  const title = label === source ? label : `${label} · ${source}`;
  return (
    <div className={cn("flex min-w-0 items-start gap-2 text-sm text-muted-foreground", className)} title={title}>
      <NoticeIcon kind={kind} text={text} label={label} className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 whitespace-pre-wrap break-words">{text}</p>
    </div>
  );
}
