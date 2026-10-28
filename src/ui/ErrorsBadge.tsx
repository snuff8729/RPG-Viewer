import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGame } from "@/app/GameProvider";

export function ErrorsBadge() {
  const { data } = useGame();
  const errors = data?.errors ?? [];
  if (errors.length === 0) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="rounded-full">
          <Badge variant="destructive">오류 {errors.length}</Badge>
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>불러오기 오류</DialogTitle>
          <DialogDescription>일부 파일을 읽지 못했어요.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-80">
          <ul className="space-y-1 text-sm">
            {errors.map((e, i) => (
              <li key={i}><span className="font-medium">{e.file}</span>: {e.message}</li>
            ))}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
