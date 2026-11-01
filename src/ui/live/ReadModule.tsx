import { useRoute } from "@/app/route";
import { Button } from "@/components/ui/button";
import { ReaderView } from "./ReaderView";
import { HistoryView } from "./HistoryView";

/** 기록 화면은 읽기 안에서 접근해요. 보기 설정 통합은 단위 3에서 해요. */
export function ReadModule({ mobile = false }: { mobile?: boolean }) {
  const [route] = useRoute();
  const history = route.kind === "play" && route.mode === "history";
  return <div className="flex h-full min-h-0 flex-col gap-2">
    <div className="flex shrink-0 gap-2">
      <Button size="sm" variant={history ? "ghost" : "secondary"} asChild><a href="#/play/read/story">이야기</a></Button>
      <Button size="sm" variant={history ? "secondary" : "ghost"} asChild><a href="#/play/read/history">모든 기록</a></Button>
    </div>
    <div className="min-h-0 flex-1 *:h-full! *:min-h-0">{history ? <HistoryView /> : <ReaderView mobile={mobile} />}</div>
  </div>;
}
