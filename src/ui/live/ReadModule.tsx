import { useState } from "react";
import { BookOpen } from "lucide-react";
import { useLive } from "@/app/LiveProvider";
import { formatRoute, type ReadMode } from "@/app/route";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { safeStore } from "./playLayout";
import { ConnectionActionButton, useConnectionAction } from "./ConnectionAction";
import { ReaderView } from "./ReaderView";
import { HistoryView } from "./HistoryView";

/** 기록이 하나도 없을 때 하나만: 제목 · 한 문장 · (플러그인이 없으면) 설치·업데이트 단추 */
function NoLogEmpty() {
  const ctl = useConnectionAction();
  const action = ctl.guide?.action;
  const setup = action === "install" || action === "update" ? action : null;
  return (
    <Empty className="h-full flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon"><BookOpen /></EmptyMedia>
        <EmptyTitle>아직 기록이 없어요</EmptyTitle>
        <EmptyDescription>기록 플러그인을 설치하고 플레이하면 여기에 쌓여요.</EmptyDescription>
      </EmptyHeader>
      {setup && (
        <EmptyContent>
          <ConnectionActionButton action={setup} ctl={ctl} />
        </EmptyContent>
      )}
      {ctl.dialog}
    </Empty>
  );
}

/**
 * 읽기: 맨 앞 `이야기 | 모든 기록` + 각 보기의 도구 줄. 게임이 꺼져 있어도 남은 기록(rpg-viewer/log.jsonl)으로 보여요
 * (지금 선택지 같은 연결 때만 있는 것은 저절로 숨어요). mobile이면 보기 설정이 Drawer로 열려요.
 */
export function ReadModule({ mobile = false, mode, onModeChange }: {
  mobile?: boolean; mode: ReadMode; onModeChange: (mode: ReadMode) => void;
}) {
  const { records, supported, caughtUp } = useLive();
  if (records.length === 0) {
    if (supported && !caughtUp) {
      return (
        <Empty className="h-full flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Spinner /></EmptyMedia>
            <EmptyTitle>기록을 읽고 있어요</EmptyTitle>
          </EmptyHeader>
        </Empty>
      );
    }
    return <NoLogEmpty />;
  }
  const history = mode === "history";
  const modeSwitch = (
    <ToggleGroup
      type="single" variant="outline" size="sm" className="shrink-0" aria-label="읽기 보기"
      value={mode}
      onValueChange={(v) => { if (v === "story" || v === "history") onModeChange(v); }}
    >
      <ToggleGroupItem value="story">이야기</ToggleGroupItem>
      <ToggleGroupItem value="history">모든 기록</ToggleGroupItem>
    </ToggleGroup>
  );
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {history ? <HistoryView mobile={mobile} toolbarStart={modeSwitch} /> : <ReaderView mobile={mobile} toolbarStart={modeSwitch} />}
    </div>
  );
}

/** 읽기 화면(#/read·#/read/history): 넓은 화면에서도 읽기 편한 너비의 한 줄기. 보기는 주소와 함께 바뀌어요. */
export function ReadPage({ mode, mobile }: { mode: ReadMode; mobile: boolean }) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-2 pt-2 pb-3 min-[900px]:px-4 min-[900px]:pt-3">
      <ReadModule
        mobile={mobile} mode={mode}
        onModeChange={(m) => { window.location.hash = formatRoute({ kind: "read", mode: m }); }}
      />
    </div>
  );
}

const PLAY_READ_MODE_KEY = "rpgv.play.readMode";

/** 플레이 화면·따로 창의 읽기 탭: 보기(이야기 | 모든 기록)는 이 브라우저에 기억해요. */
export function PlayReadModule({ mobile = false }: { mobile?: boolean }) {
  const [mode, setMode] = useState<ReadMode>(() => (safeStore().getItem(PLAY_READ_MODE_KEY) === "history" ? "history" : "story"));
  return (
    <ReadModule
      mobile={mobile} mode={mode}
      onModeChange={(m) => { setMode(m); safeStore().setItem(PLAY_READ_MODE_KEY, m); }}
    />
  );
}
