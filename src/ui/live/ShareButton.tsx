import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Smartphone } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import {
  DEFAULT_SHARE_DAYS, rotateShare, SHARE_DAYS, shareGame, shareStatus, startShare, stopShare, untilText, type ShareResult, type ShareStatus,
} from "@/app/share";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GamePathDialog } from "./GamePathDialog";
import { gameKeyOf } from "./readPosition";
import { useGamePath, useLauncherAvailable } from "./useGamePath";

/** QR 그림(흰 바탕). */
function QrImage({ url }: { url: string }) {
  const [src, setSrc] = useState<{ url: string; data: string } | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { margin: 2, width: 480, errorCorrectionLevel: "M" })
      .then((data) => { if (alive) setSrc({ url, data }); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [url]);
  if (src?.url !== url) return <div className="size-48 rounded-lg border" />;
  return <img src={src.data} alt="휴대폰으로 찍을 QR 코드" className="size-48 rounded-lg border" />;
}

function CopyUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <InputGroup>
      <InputGroupInput readOnly value={url} aria-label="휴대폰에서 열 주소" onFocus={(e) => e.target.select()} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label="주소 복사"
          onClick={() => { void navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(() => {}); }}
        >
          {copied ? <Check /> : <Copy />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

/**
 * 상단 `휴대폰으로 보기`. 뷰어 서버(npm run dev / preview)가 있을 때만 보인다.
 * 켜면 같은 와이파이의 휴대폰이 QR 주소로 플레이 화면을 본다(게임 보조·치트·게임 설정도 쓸 수 있다). 허용 기간(1·7·30일) 동안은 다시 찍지 않아도 된다.
 */
export function ShareButton() {
  const { data } = useGame();
  const available = useLauncherAvailable();
  const gameKey = data ? gameKeyOf(data) : null;
  const { path, save: savePath } = useGamePath(gameKey);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<number>(DEFAULT_SHARE_DAYS);
  const [urlIndex, setUrlIndex] = useState(0);
  const [askPath, setAskPath] = useState(false);

  const apply = (r: ShareResult): string | null => {
    if (!r.ok) { setError(r.error); return r.error; }
    setError(null);
    setStatus(r);
    setDays(r.days);
    return null;
  };

  const run = async (fn: () => Promise<ShareResult>): Promise<string | null> => {
    setBusy(true);
    try { return apply(await fn()); } finally { setBusy(false); }
  };

  // 창을 열 때 상태를 읽고, 켜져 있으면 지금 연 게임으로 맞춘다.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const r = path ? await shareGame(path) : await shareStatus();
      if (alive) apply(r);
    })();
    return () => { alive = false; };
  }, [open, path]);

  if (!data || !available) return null;

  const on = status?.on === true;
  const urls = status?.urls ?? [];
  const url = urls[Math.min(urlIndex, urls.length - 1)] ?? null;
  /** 지금 연 게임과 공유 중인 게임이 다른지(경로를 모르면 알 수 없다) */
  const pathUnknown = path === null;

  const turnOn = async (d: number) => {
    if (pathUnknown && !status?.gamePath) { setAskPath(true); return; }
    await run(() => startShare(d, path));
  };

  const onSwitch = (v: boolean) => {
    if (v) void turnOn(days);
    else void run(() => stopShare());
  };

  const onDays = (v: string) => {
    const d = Number(v);
    if (!SHARE_DAYS.includes(d as never)) return;
    setDays(d);
    // 켜져 있으면 기간만 새로 정한다(같은 QR 그대로).
    if (on) void run(() => startShare(d, path));
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Smartphone />휴대폰으로 보기
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>휴대폰으로 보기</DialogTitle>
            <DialogDescription>
              PC와 휴대폰이 같은 와이파이에 있어야 해요. 처음 켤 때 Windows 방화벽 창이 뜨면 '개인 네트워크' 허용을 눌러 주세요.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Switch id="share-on" checked={on} disabled={busy} onCheckedChange={onSwitch} />
              <Label htmlFor="share-on">{on ? "켜짐" : "꺼짐"}</Label>
              {on && status?.expiresAt != null && (
                <span className="ml-auto text-sm text-muted-foreground">{untilText(status.expiresAt)}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Label>허용 기간</Label>
              <ToggleGroup type="single" variant="outline" size="sm" value={String(days)} onValueChange={onDays} disabled={busy}>
                {SHARE_DAYS.map((d) => <ToggleGroupItem key={d} value={String(d)}>{d}일</ToggleGroupItem>)}
              </ToggleGroup>
            </div>
            {status?.expired && !on && (
              <Alert>
                <AlertDescription>허용 기간이 끝났어요. 다시 켜면 새 QR이 만들어져요.</AlertDescription>
              </Alert>
            )}
            {pathUnknown && (
              <Alert>
                <AlertDescription>
                  <p>지금 연 게임의 폴더 위치를 몰라요{status?.title ? ` — 지금은 「${status.title}」을 보여 줘요` : ""}.</p>
                  <Button variant="link" className="h-auto p-0" onClick={() => setAskPath(true)}>폴더 위치 알려 주기</Button>
                </AlertDescription>
              </Alert>
            )}
            {on && url && (
              <>
                <Separator />
                <div className="flex flex-col items-center gap-3">
                  <QrImage url={url} />
                  {status?.title && <p className="text-sm text-muted-foreground">「{status.title}」</p>}
                </div>
                {urls.length > 1 && (
                  <Select value={String(Math.min(urlIndex, urls.length - 1))} onValueChange={(v) => setUrlIndex(Number(v))}>
                    <SelectTrigger className="w-full" aria-label="PC 주소 고르기"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {urls.map((u, i) => <SelectItem key={u} value={String(i)}>{new URL(u).host}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <CopyUrl url={url} />
                <p className="text-sm text-muted-foreground">
                  휴대폰에서 연 뒤 Safari 공유 → 홈 화면에 추가를 누르면 다음부터 한 번에 열려요.
                </p>
                <Button variant="outline" disabled={busy} onClick={() => void run(() => rotateShare())}>
                  새 QR 만들기(기존 휴대폰 연결 끊기)
                </Button>
              </>
            )}
            {on && urls.length === 0 && (
              <Alert variant="destructive">
                <AlertDescription>이 PC의 와이파이 주소를 찾지 못했어요. 네트워크 연결을 확인해 주세요.</AlertDescription>
              </Alert>
            )}
            {error !== null && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <GamePathDialog
        open={askPath}
        onOpenChange={setAskPath}
        initialPath=""
        initialError={null}
        openedTitle={data.system.gameTitle}
        confirmLabel={on ? "저장" : "저장하고 켜기"}
        confirmIcon={<Smartphone />}
        onConfirm={async (p) => {
          savePath(p);
          return on ? run(() => shareGame(p)) : run(() => startShare(days, p));
        }}
      />
    </>
  );
}
