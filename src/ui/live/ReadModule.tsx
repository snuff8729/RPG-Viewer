import { useLive } from "@/app/LiveProvider";
import { useRoute } from "@/app/route";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NotConnectedEmpty } from "./NotConnectedEmpty";
import { ReaderView } from "./ReaderView";
import { HistoryView } from "./HistoryView";

/**
 * 읽기 모듈: 맨 앞 `이야기 | 모든 기록`(주소 #/play/read/story·history와 함께 바뀌어요) + 각 보기의 도구 줄.
 * mobile이면 보기 설정이 Drawer로 열려요.
 */
export function ReadModule({ mobile = false }: { mobile?: boolean }) {
  const [route] = useRoute();
  const { connection } = useLive();
  if (connection !== "connected") return <NotConnectedEmpty />;
  const history = route.kind === "play" && route.mode === "history";
  const modeSwitch = (
    <ToggleGroup
      type="single" variant="outline" size="sm" className="shrink-0" aria-label="읽기 보기"
      value={history ? "history" : "story"}
      onValueChange={(v) => { if (v === "story" || v === "history") window.location.hash = `#/play/read/${v}`; }}
    >
      <ToggleGroupItem value="story">이야기</ToggleGroupItem>
      <ToggleGroupItem value="history">모든 기록</ToggleGroupItem>
    </ToggleGroup>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {history ? <HistoryView mobile={mobile} toolbarStart={modeSwitch} /> : <ReaderView mobile={mobile} toolbarStart={modeSwitch} />}
    </div>
  );
}
