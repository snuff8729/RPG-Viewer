import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** 휴대폰 보기의 시작 화면: 여는 중이거나, 볼 수 없는 이유(꺼짐·기간 끝·QR 바뀜)를 보여 준다. */
export function RemoteScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>RPG Viewer · 휴대폰 보기</CardTitle>
          <CardDescription>PC에서 하고 있는 게임의 플레이 화면을 봐요.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <>
              <Alert variant="destructive">
                <AlertTitle>볼 수 없어요</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
              <Button size="lg" onClick={onRetry}>다시 확인</Button>
            </>
          )}
          <p className="text-sm text-muted-foreground">
            Safari 공유 → 홈 화면에 추가를 누르면 다음부터 한 번에 열려요.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
