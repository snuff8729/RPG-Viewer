import { Unplug } from "lucide-react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { terms } from "@/ui/terms";
import { ConnectionNextAction } from "./ConnectionStatusButton";

export function NotConnectedEmpty() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Unplug />
        </EmptyMedia>
        <EmptyTitle>{terms.notConnected}</EmptyTitle>
        <EmptyDescription>기록 플러그인을 설치하고 게임을 실행하면 여기에 보여요.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <ol className="space-y-1 text-muted-foreground">
          <li>① 기록 플러그인을 설치해 주세요.</li>
          <li>② 게임을 실행해 주세요.</li>
        </ol>
        <ConnectionNextAction />
      </EmptyContent>
      <Button variant="link" asChild>
        <a href="#/browse/events">게임 없이 이야기 찾아보기 →</a>
      </Button>
    </Empty>
  );
}
