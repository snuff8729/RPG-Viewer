import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { HereView } from "./HereView";

/** 옛 이 맵의 상세 기능을 맵 모듈 안에서 유지해요. 목록 통합은 단위 3에서 해요. */
export function MapDetailsButton() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm">
          자세히
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>이 맵 자세히</SheetTitle>
          <SheetDescription>이벤트의 조건과 남은 내용, 나오는 적을 살펴봐요.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <HereView />
        </div>
      </SheetContent>
    </Sheet>
  );
}
