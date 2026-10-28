import { useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { useAddons } from "@/app/AddonsProvider";
import { isNoticeHookPath, NOTICE_HOOKS_MAX } from "@/core/addons/notices";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** 새로 적은 경로의 문제(없으면 null) */
function problemOf(path: string, hooks: string[]): string | null {
  if (!path) return null;
  if (!isNoticeHookPath(path)) return "TickerManager.show처럼 점으로 이은 함수 이름만 적을 수 있어요.";
  if (hooks.includes(path)) return "이미 추가했어요.";
  if (hooks.length >= NOTICE_HOOKS_MAX) return `최대 ${NOTICE_HOOKS_MAX}개까지 추가할 수 있어요.`;
  return null;
}

/** 알림 문구 기록: 기록 플러그인이 감쌀 함수를 직접 추가한다(이 게임에만, 첫 인자를 글로 기록). */
export function NoticeHooksSection() {
  const { noticeHooks, setNoticeHooks } = useAddons();
  const [draft, setDraft] = useState("");
  const path = draft.trim();
  const problem = problemOf(path, noticeHooks);
  const add = () => {
    if (!path || problem) return;
    setNoticeHooks([...noticeHooks, path]);
    setDraft("");
  };
  return (
    <Collapsible defaultOpen={noticeHooks.length > 0}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          직접 추가할 함수{noticeHooks.length > 0 ? ` ${noticeHooks.length}개` : ""}
          <ChevronDown />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 pt-2">
        <p className="text-sm text-muted-foreground">
          다른 플러그인이 문구를 띄울 때 부르는 함수를 적으면 그 함수의 첫 번째 값(글)을 기록해요. 게임에 그 함수가 없으면 아무 일도 하지 않아요.
        </p>
        {noticeHooks.length > 0 && (
          <ul className="flex flex-col gap-2">
            {noticeHooks.map((h) => (
              <li key={h} className="flex items-center gap-2">
                <Input value={h} readOnly className="font-mono" aria-label="추가한 함수" />
                <Button variant="ghost" size="icon" aria-label={`${h} 빼기`} onClick={() => setNoticeHooks(noticeHooks.filter((x) => x !== h))}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="notice-hook-new">함수 추가</Label>
          <div className="flex items-center gap-2">
            <Input
              id="notice-hook-new"
              value={draft}
              placeholder="예: MyPopup.show"
              className="font-mono"
              aria-invalid={problem ? true : undefined}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            />
            <Button variant="outline" size="sm" disabled={!path || problem !== null} onClick={add}><Plus />추가</Button>
          </div>
          {problem && <p className="text-sm text-destructive">{problem}</p>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
