import { Info } from "lucide-react";
import { useLive } from "@/app/LiveProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** 지금 맵을 못 보여줄 때(이 맵·플레이 화면 공용): 연결 전이면 안내, 연결됐는데 맵 정보가 없으면 그렇다고. */
export function HereNotConnected() {
  const { connection, live } = useLive();
  if (connection !== "connected" || !live) {
    return (
      <Alert>
        <Info />
        <AlertDescription>게임에 연결하면 지금 있는 맵을 보여줘요.</AlertDescription>
      </Alert>
    );
  }
  return <p className="text-sm text-muted-foreground">지금 맵 정보를 찾을 수 없어요</p>;
}
