import { useState } from "react";
import { Bot, Copy, Languages } from "lucide-react";
import { toast } from "sonner";
import { useGame } from "@/app/GameProvider";
import { agentInstruction, exportMasked, unmaskWithGame, type MaskExportResult, type UnmaskResult } from "@/app/maskApi";
import { isRemoteFolder, ServerFolder } from "@/app/serverFolder";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GamePathDialog } from "@/ui/live/GamePathDialog";
import { gameKeyOf } from "@/ui/live/readPosition";
import { useGamePath, useLauncherAvailable } from "@/ui/live/useGamePath";

/** 읽기 전용 한 줄 + 복사 버튼 */
function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <InputGroup>
      <InputGroupInput readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={`${label} 복사`}
          onClick={() => {
            void navigator.clipboard.writeText(value)
              .then(() => toast.success("복사했어요"))
              .catch(() => toast.error("복사하지 못했어요. 브라우저가 클립보드를 막았을 수 있어요."));
          }}
        >
          <Copy />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

/**
 * `게임 진단`의 `AI에게 맡기기`(가린 사본 만들기)와 `AI 답변 풀어보기`(토큰을 원래 글로).
 * 뷰어 서버가 있을 때만(게임 실행·백업과 같음), 휴대폰 보기에서는 쓰지 않는다.
 */
export function AiHandoff() {
  const { data, folder } = useGame();
  const available = useLauncherAvailable();
  const gameKey = data ? gameKeyOf(data) : null;
  const { path, save: savePath } = useGamePath(gameKey);
  const [askPath, setAskPath] = useState<null | "export" | "unmask">(null);
  const [dialog, setDialog] = useState<null | "export" | "unmask">(null);

  const [note, setNote] = useState("");
  const [exported, setExported] = useState<MaskExportResult | null>(null);
  const [aiText, setAiText] = useState("");
  const [restored, setRestored] = useState<UnmaskResult | null>(null);
  const [busy, setBusy] = useState(false);

  if (!data) return null;
  const remote = isRemoteFolder(folder);
  const reason = remote ? "휴대폰에서는 쓸 수 없어요." : !available ? "뷰어를 npm run dev로 열었을 때만 쓸 수 있어요." : null;
  const knowsGame = (folder instanceof ServerFolder) || path !== null;
  const target = { folder, path };

  const openDialog = (which: "export" | "unmask") => {
    if (!knowsGame) { setAskPath(which); return; }
    setDialog(which);
  };

  const onExport = async () => {
    setBusy(true);
    setExported(null);
    try { setExported(await exportMasked(target, note)); } finally { setBusy(false); }
  };
  const onUnmask = async () => {
    setBusy(true);
    setRestored(null);
    try { setRestored(await unmaskWithGame(target, aiText)); } finally { setBusy(false); }
  };

  return (
    <>
      <ItemGroup className="gap-2">
        <Item variant="outline" size="sm">
          <ItemContent>
            <ItemDescription className="line-clamp-none">게임 글을 가린 사본을 만들어 AI에게 고쳐 달라고 할 수 있어요.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="outline" size="sm" disabled={reason !== null} onClick={() => openDialog("export")}><Bot />AI에게 맡기기</Button>
          </ItemActions>
        </Item>
        <Item variant="outline" size="sm">
          <ItemContent>
            <ItemDescription className="line-clamp-none">AI 답변 속 가린 글을 이 게임의 원래 글로 바꿔 보여 줘요.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="outline" size="sm" disabled={reason !== null} onClick={() => openDialog("unmask")}><Languages />AI 답변 풀어보기</Button>
          </ItemActions>
        </Item>
      </ItemGroup>
      {reason !== null && <p className="text-xs text-muted-foreground">AI 기능: {reason}</p>}
      <GamePathDialog
        open={askPath !== null}
        onOpenChange={(o) => { if (!o) setAskPath(null); }}
        initialPath=""
        initialError={null}
        openedTitle={data.system.gameTitle}
        confirmLabel="저장"
        onConfirm={async (p) => {
          savePath(p);
          setDialog(askPath);
          setAskPath(null);
          return null;
        }}
      />
      <Dialog open={dialog === "export"} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI에게 맡기기</DialogTitle>
            <DialogDescription>
              게임 속 글을 알아볼 수 없게 가린 사본을 문서 폴더의 RPG-Viewer-Masked에 만들어요. 게임은 바꾸지 않아요.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-note">어떤 문제가 있었나요?</Label>
              <Textarea
                id="ai-note"
                value={note}
                placeholder="예: 어떤 장면에서 그림이 안 보여요 (안 써도 돼요)"
                maxLength={20000}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {exported?.ok === false && (
              <Alert variant="destructive"><AlertDescription>{exported.error}</AlertDescription></Alert>
            )}
            {exported?.ok === true && (
              <div className="flex flex-col gap-3">
                <p className="text-sm">
                  가린 사본을 만들었어요. 파일 {exported.files.toLocaleString()}개, 가린 글 {exported.replaced.toLocaleString()}곳
                </p>
                <CopyField value={exported.path} label="사본 폴더 위치" />
                {exported.hits > 0 && (
                  <Alert variant="destructive">
                    <AlertTitle>보내기 전에 확인하세요</AlertTitle>
                    <AlertDescription>
                      가려지지 않은 단어가 {exported.hits.toLocaleString()}곳 남았어요 — MASK-WARNINGS.md 확인 전에는 보내지 마세요.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-col gap-2">
                  <Label>Claude Code에 붙여 넣을 말</Label>
                  <CopyField value={agentInstruction(exported.path)} label="Claude Code에 붙여 넣을 말" />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button disabled={busy} onClick={() => void onExport()}>{busy ? "만드는 중…" : "가린 사본 만들기"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "unmask"} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI 답변 풀어보기</DialogTitle>
            <DialogDescription>
              AI 답변에 T_로 시작하는 가린 글이 있으면 붙여 넣으세요. 이 게임의 원래 글로 바꿔 보여 줘요(이 PC 안에서만).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-reply">AI 답변</Label>
              <Textarea id="ai-reply" value={aiText} className="max-h-48" onChange={(e) => setAiText(e.target.value)} />
            </div>
            {restored?.ok === false && (
              <Alert variant="destructive"><AlertDescription>{restored.error}</AlertDescription></Alert>
            )}
            {restored?.ok === true && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="ai-restored">원래 글로 바꾼 답변</Label>
                <Textarea id="ai-restored" readOnly value={restored.text} className="max-h-64" />
                <p className="text-xs text-muted-foreground">
                  {restored.replaced.toLocaleString()}곳을 바꿨어요.
                  {restored.unknown > 0 ? ` 이 게임에서 찾지 못한 가린 글 ${restored.unknown}종은 그대로 두었어요.` : ""}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button disabled={busy || aiText.trim() === ""} onClick={() => void onUnmask()}>{busy ? "푸는 중…" : "풀어보기"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
