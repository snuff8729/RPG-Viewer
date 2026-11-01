import { NotConnectedEmpty } from "./NotConnectedEmpty";
import { terms } from "@/ui/terms";
import { useAssist, useLive } from "@/app/LiveProvider";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { ASSIST_FAVORITE_GRID } from "./AssistControls";
import { AssistFavoriteStar } from "./AssistFavoriteStar";
import { AssistContent } from "./AssistContent";
import { BackupNowButton, RestoreLatestButton, useBackupControls } from "./BackupControls";
import type { AssistSession } from "./useAssistSession";

export interface AssistTabProps {
  /** 남는 상태(명령 응답 글·단축키 불일치). 탭을 바꿔도 남게 늘 그려진 곳에서 useAssistSession()으로 만들어 넘긴다. */
  session?: AssistSession;
  /** 보이는 동안 true(단축키 잡기) */
  active?: boolean;
  className?: string;
}

/**
 * 보조 탭 내용(PC 도구 칸·따로 창·휴대폰 보조 탭이 같이 쓴다): 게임 보조 전부 + 백업·복원 한 번 누르기,
 * 조작마다 ☆(맨 위 줄 즐겨찾기). 칸이 스크롤된다.
 */
export function AssistTab({ session, active = true, className }: AssistTabProps) {
  const { supported } = useAssist();
  const { connection } = useLive();
  const backup = useBackupControls();
  if (connection !== "connected") return <NotConnectedEmpty />;
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {!supported && <p className="text-xs text-muted-foreground">게임이 연결되고 기록 플러그인이 1.1.0 이상이면 쓸 수 있어요</p>}
      <AssistContent session={session} active={active} header={false} favorite={(id) => <AssistFavoriteStar id={id} />} />
      {backup && (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <Label>{terms.backups}</Label>
            <div className={ASSIST_FAVORITE_GRID}>
              <BackupNowButton favorite={<AssistFavoriteStar id="backup" />} />
              <RestoreLatestButton favorite={<AssistFavoriteStar id="restore" />} />
            </div>
            <p className="text-xs text-muted-foreground">
              {backup.path ? "복원은 가장 최근의 직접·자동 백업으로 되돌리고 게임을 다시 켜요(게임 창 단축키 복원과 같아요)" : "관리의 연결·실행에서 게임 폴더 위치를 먼저 정해 주세요"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
