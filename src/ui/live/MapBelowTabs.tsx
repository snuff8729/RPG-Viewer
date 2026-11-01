import { useState, type ReactNode } from "react";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import { stepTitle } from "@/core/story/format";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { terms } from "@/ui/terms";
import { NextStoryCard } from "./NextStoryCard";
import { MapList } from "./PlayMap";
import { isBelowTab, loadBelowTab, saveBelowTab, type BelowTab } from "./playLayout";
import { usePlayMap } from "./usePlayMapState";

/**
 * 맵 아래 목록(PC 맵 칸 아래 칸·휴대폰 Drawer): 탭 `다음 스토리 | 해 볼 것 N`.
 * 다음 스토리 탭은 카드 전체(먼저 할 일·가는 길·다른 후보·대사 보기·진행 기준), 해 볼 것 탭은 구역별 목록·적·다른 맵.
 * 해 볼 것 탭일 때 탭 줄에 `다음: 할 일` 한 줄(누르면 다음 스토리 탭).
 * 고른 탭은 이 기기에 기억해요. 고른 적이 없으면 다음 스토리를 찾았을 때 다음 스토리, 아니면 해 볼 것.
 * 맵에서 점을 고르면 그 줄이 보이게 해 볼 것 탭으로 가요.
 */
export function MapBelowTabs({ end, onTabPress, showContent = true, onChoose, className, contentClassName }: {
  /** 탭 줄 오른쪽 끝(예: 접기 버튼) */
  end?: ReactNode;
  /** 탭(또는 `다음:` 줄)을 누를 때(예: 접혀 있으면 펼치기) */
  onTabPress?: () => void;
  /** false면 탭 줄만(접힘) */
  showContent?: boolean;
  onChoose?: (ev: ChecklistEvent) => void;
  className?: string;
  /** 탭 내용(스크롤 칸)의 여백 */
  contentClassName?: string;
}) {
  const { here } = usePlayMap();
  const best = here.next.story?.steps[0];
  const [chosen, setChosen] = useState<BelowTab | null>(loadBelowTab);
  const [prevSelected, setPrevSelected] = useState(here.selected);
  const tab: BelowTab = chosen ?? (best ? "story" : "todo");
  // 맵에서 점을 고르면 목록에서 그 줄이 보이게
  if (here.selected !== prevSelected) {
    setPrevSelected(here.selected);
    if (here.selected != null && tab !== "todo") setChosen("todo");
  }
  const choose = (t: BelowTab) => { setChosen(t); saveBelowTab(t); };
  const checklist = here.checklist;
  if (!here.live || !checklist) return null;
  const content = cn("min-h-0 flex-1 overflow-y-auto", contentClassName);
  return (
    <Tabs value={tab} onValueChange={(v) => { if (isBelowTab(v)) choose(v); }} className={cn("min-h-0 gap-0", className)}>
      <div className="flex h-10 shrink-0 items-center gap-2 px-2">
        <TabsList className="shrink-0">
          <TabsTrigger value="story" onClick={onTabPress}>다음 스토리</TabsTrigger>
          <TabsTrigger value="todo" onClick={onTabPress}>{terms.todo(checklist.remaining)}</TabsTrigger>
        </TabsList>
        {tab === "todo" && best ? (
          <Button
            variant="ghost" size="sm" className="min-w-0 flex-1 justify-start px-2 font-normal text-muted-foreground"
            title={`다음: ${stepTitle(best)}`}
            onClick={() => { choose("story"); onTabPress?.(); }}
          >
            <span className="truncate">다음: {stepTitle(best)}</span>
          </Button>
        ) : (
          <div className="flex-1" />
        )}
        {end}
      </div>
      {showContent && (
        <>
          <TabsContent value="story" className={content}>
            <NextStoryCard state={here.next} />
          </TabsContent>
          <TabsContent value="todo" className={content}>
            <MapList onChoose={onChoose} />
          </TabsContent>
        </>
      )}
    </Tabs>
  );
}
