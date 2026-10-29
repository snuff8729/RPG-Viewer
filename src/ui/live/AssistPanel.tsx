import { useEffect, useState } from "react";
import { FolderOpen, Gauge, Heart, HeartCrack, History, Save, WandSparkles } from "lucide-react";
import { openCheatSheet } from "./cheat/CheatSheet";
import { useAssist, useLive } from "@/app/LiveProvider";
import {
  AUTO_SPEEDS, COMMAND_RESPONSE_MS, commandStatus, commandStatusText, DEFAULT_HOTKEYS, HOTKEY_ACTIONS, HP_COMMAND_MIN_VERSION, hotkeySummary,
  isAutoSpeed, isHpCommand, isQuickSlot, isSaveCommand, isSpeed, keyLabel, liveHotkeys, SAVE_COMMAND_MIN_VERSION, sameHotkeys, SPEEDS,
  validateHotkey, versionAtLeast, type HotkeyAction,
} from "@/core/live/assist";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** 게임에 걸린 단축키가 설정과 이만큼 오래 다르면 안내한다. */
const HOTKEY_MISMATCH_MS = 5000;

/** 키 이름 + 을/를(끝 글자를 한국어로 읽은 받침 기준: 0·1·3·6·7·8, L·M·N·R은 받침 있음). */
function withObjectParticle(label: string): string {
  return `${label}${/[013678LMNR]$/.test(label) ? "을" : "를"}`;
}

/** 상단 `게임 보조` Popover: 배속·본 대사 자동 넘기기·자동 배속·전투 조작·단축키. */
export function AssistPanel() {
  const { settings, setSettings, sendCommand, sentCommand, supported } = useAssist();
  const { live } = useLive();
  const inBattle = supported && live?.inBattle === true;
  /** 체력 명령은 플러그인 1.12.0부터(맵·전투 모두) */
  const hpSupported = supported && versionAtLeast(live?.pluginVersion, HP_COMMAND_MIN_VERSION);
  /** 세이브·로드 명령은 플러그인 1.21.0부터(맵, 불러오기는 타이틀에서도) */
  const saveSupported = supported && versionAtLeast(live?.pluginVersion, SAVE_COMMAND_MIN_VERSION);
  /** 게임이 알려 준 지금의 퀵 세이브 칸 */
  const liveSlot: unknown = live?.assist?.quickSlot;
  const [confirmQuickLoad, setConfirmQuickLoad] = useState(false);
  // 퀵 세이브 칸 입력: 고칠 때는 입력값, 아니면 설정값(빈칸 = 마지막 칸)
  const [slotDraft, setSlotDraft] = useState<string | null>(null);
  const commitSlot = () => {
    if (slotDraft === null) return;
    const t = slotDraft.trim();
    const n = Number(t);
    setSlotDraft(null);
    if (t === "") setSettings({ ...settings, quickSlot: null });
    else if (isQuickSlot(n)) setSettings({ ...settings, quickSlot: n });
  };
  const hotkeys = settings.hotkeys;
  // 전투 안전장치: 플러그인이 false라고 알려 줄 때만 막는다(구버전은 필드가 없다).
  const canEscape = live?.assist?.canEscape !== false;
  const canLose = live?.assist?.canLose !== false;
  const [confirmLose, setConfirmLose] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // 보낸 명령의 응답: COMMAND_RESPONSE_MS 안에 live.json에 메아리가 없으면 응답 없음.
  const [timedOutId, setTimedOutId] = useState<string | null>(null);
  useEffect(() => {
    if (!sentCommand) return;
    const id = setTimeout(() => setTimedOutId(sentCommand.id), Math.max(0, sentCommand.at + COMMAND_RESPONSE_MS - Date.now()));
    return () => clearTimeout(id);
  }, [sentCommand]);
  const status = commandStatus(sentCommand, live?.assist?.lastCommand, sentCommand !== null && timedOutId === sentCommand.id);
  const statusText = status === null ? null : commandStatusText(status, sentCommand?.kind);
  /** 마지막 명령이 체력 명령이면 응답을 체력 칸에 보인다 */
  const hpSent = isHpCommand(sentCommand?.kind);
  /** 마지막 명령이 세이브·로드 명령이면 응답을 세이브 칸에 보인다 */
  const saveSent = isSaveCommand(sentCommand?.kind);

  // 단축키 바꾸기: 고른 동작의 다음 keydown을 잡는다(Escape는 취소).
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  useEffect(() => {
    if (capturing === null) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setCapturing(null); return; }
      const code = e.keyCode;
      const err = validateHotkey(code, capturing, hotkeys);
      setHotkeyError(err);
      setCapturing(null);
      if (err === null) setSettings({ ...settings, hotkeys: { ...hotkeys, [capturing]: code } });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, hotkeys, settings, setSettings]);

  // 게임이 보고한 단축키가 설정과 5초 넘게 다르면 플러그인 업데이트를 안내한다.
  const effective = liveHotkeys(live?.assist);
  /** 게임 창에서 실제로 걸린 지기 단축키 */
  const loseKey = effective.lose;
  const mismatchKey = supported && live?.assist && !sameHotkeys(effective, hotkeys)
    ? JSON.stringify([effective, hotkeys]) : null;
  const [staleKey, setStaleKey] = useState<string | null>(null);
  useEffect(() => {
    if (mismatchKey === null) return;
    const id = setTimeout(() => setStaleKey(mismatchKey), HOTKEY_MISMATCH_MS);
    return () => clearTimeout(id);
  }, [mismatchKey]);
  const showMismatch = mismatchKey !== null && staleKey === mismatchKey;

  const setHotkey = (action: HotkeyAction, code: number | null) => {
    setHotkeyError(null);
    setCapturing(null);
    setSettings({ ...settings, hotkeys: { ...hotkeys, [action]: code } });
  };

  return (
    <Popover open={panelOpen} onOpenChange={(open) => { setPanelOpen(open); if (!open) { setCapturing(null); setHotkeyError(null); } }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm"><Gauge />게임 보조</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-h-(--radix-popover-content-available-height) overflow-auto">
        <PopoverHeader>
          <PopoverTitle>게임 보조</PopoverTitle>
          {!supported && <PopoverDescription>플러그인을 1.1.0으로 업데이트하면 쓸 수 있어요</PopoverDescription>}
        </PopoverHeader>
        <div className="flex flex-col gap-2">
          <Label>배속</Label>
          <ToggleGroup
            type="single" variant="outline" size="sm" disabled={!supported}
            value={String(settings.speed)}
            onValueChange={(v) => { const n = Number(v); if (isSpeed(n)) setSettings({ ...settings, speed: n }); }}
          >
            {SPEEDS.map((s) => <ToggleGroupItem key={s} value={String(s)}>×{s}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="assist-skip-seen">본 대사 자동 넘기기</Label>
          <Switch
            id="assist-skip-seen" disabled={!supported} checked={settings.skipSeen}
            onCheckedChange={(c) => setSettings({ ...settings, skipSeen: c })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="assist-auto-fast">본 이벤트 자동 배속</Label>
            <Switch
              id="assist-auto-fast" disabled={!supported} checked={settings.autoFast}
              onCheckedChange={(c) => setSettings({ ...settings, autoFast: c })}
            />
          </div>
          <ToggleGroup
            type="single" variant="outline" size="sm" disabled={!supported || !settings.autoFast}
            value={String(settings.autoSpeed)}
            onValueChange={(v) => { const n = Number(v); if (isAutoSpeed(n)) setSettings({ ...settings, autoSpeed: n }); }}
          >
            {AUTO_SPEEDS.map((s) => <ToggleGroupItem key={s} value={String(s)}>×{s}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <Separator />
        <div className="flex flex-col gap-2">
          <Label>전투</Label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!inBattle} onClick={() => sendCommand("win")}>이기기</Button>
            <Button
              variant="outline" size="sm" disabled={!inBattle}
              onClick={() => { if (canLose) sendCommand("lose"); else setConfirmLose(true); }}
            >
              지기
            </Button>
            <Button variant="outline" size="sm" disabled={!inBattle || !canEscape} onClick={() => sendCommand("escape")}>도망</Button>
          </div>
          {!inBattle && <p className="text-xs text-muted-foreground">전투 중에만 쓸 수 있어요</p>}
          {inBattle && canLose && <p className="text-xs text-muted-foreground">패배 장면이 있는 전투면 그 장면이 나와요</p>}
          {inBattle && !canEscape && <p className="text-xs text-muted-foreground">이 전투는 도망칠 수 없어요</p>}
          {inBattle && !canLose && loseKey !== null && (
            <p className="text-xs text-muted-foreground">지금 {withObjectParticle(keyLabel(loseKey))} 누르면 게임 오버가 돼요</p>
          )}
          {statusText !== null && !hpSent && !saveSent && <p className="text-xs text-muted-foreground">{statusText}</p>}
          <AlertDialog open={confirmLose} onOpenChange={setConfirmLose}>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>전투 지기</AlertDialogTitle>
                <AlertDialogDescription>이 전투는 지면 게임 오버예요. 저장하지 않은 진행은 사라져요. 그래도 질까요?</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => sendCommand("lose")}>지기</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <Separator />
        <div className="flex flex-col gap-2">
          <Label>내 체력</Label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!hpSupported} onClick={() => sendCommand("hpFull")}><Heart />체력 100%</Button>
            <Button variant="outline" size="sm" disabled={!hpSupported} onClick={() => sendCommand("hpLow")}><HeartCrack />체력 1%</Button>
          </div>
          {supported && !hpSupported && <p className="text-xs text-muted-foreground">플러그인을 1.12.0으로 업데이트하면 쓸 수 있어요</p>}
          {hpSupported && <p className="text-xs text-muted-foreground">파티 전원에게 적용돼요. 100%는 쓰러진 동료도 살려요</p>}
          {statusText !== null && hpSent && <p className="text-xs text-muted-foreground">{statusText}</p>}
        </div>
        <Separator />
        <div className="flex flex-col gap-2">
          <Label>세이브</Label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!saveSupported} onClick={() => sendCommand("quickSave")}><Save />퀵 세이브</Button>
            <Button variant="outline" size="sm" disabled={!saveSupported} onClick={() => setConfirmQuickLoad(true)}><History />퀵 로드</Button>
            <Button variant="outline" size="sm" disabled={!saveSupported} onClick={() => sendCommand("saveMenu")}><Save />세이브 창</Button>
            <Button variant="outline" size="sm" disabled={!saveSupported} onClick={() => sendCommand("loadMenu")}><FolderOpen />로드 창</Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="assist-quick-slot">퀵 세이브 칸</Label>
            <Input
              id="assist-quick-slot" className="w-28" type="number" min={1} max={999} inputMode="numeric"
              disabled={!saveSupported} placeholder="마지막 칸"
              value={slotDraft ?? (settings.quickSlot === null ? "" : String(settings.quickSlot))}
              onChange={(e) => setSlotDraft(e.target.value)}
              onBlur={commitSlot}
              onKeyDown={(e) => { if (e.key === "Enter") commitSlot(); }}
            />
          </div>
          {supported && !saveSupported && <p className="text-xs text-muted-foreground">플러그인을 1.21.0으로 업데이트하면 쓸 수 있어요</p>}
          {saveSupported && (
            <p className="text-xs text-muted-foreground">
              맵에서 이벤트가 없을 때만 돼요(불러오기는 타이틀에서도).{typeof liveSlot === "number" ? ` 지금 퀵 세이브 칸: ${liveSlot}번` : ""}
            </p>
          )}
          {statusText !== null && saveSent && <p className="text-xs text-muted-foreground">{statusText}</p>}
          <AlertDialog open={confirmQuickLoad} onOpenChange={setConfirmQuickLoad}>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>퀵 로드</AlertDialogTitle>
                <AlertDialogDescription>퀵 세이브를 불러와요. 저장하지 않은 진행은 사라져요.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => sendCommand("quickLoad")}>불러오기</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <Separator />
        <div className="flex items-center justify-between gap-2">
          <Label>아이템·능력치·스위치</Label>
          <Button variant="outline" size="sm" onClick={() => { setPanelOpen(false); openCheatSheet(); }}><WandSparkles />치트 열기</Button>
        </div>
        <Separator />
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label>단축키</Label>
            <Button
              variant="ghost" size="xs" disabled={!supported || sameHotkeys(hotkeys, DEFAULT_HOTKEYS)}
              onClick={() => setSettings({ ...settings, hotkeys: DEFAULT_HOTKEYS })}
            >
              기본값으로
            </Button>
          </div>
          {HOTKEY_ACTIONS.map(({ action, label }) => {
            const code = hotkeys[action];
            return (
              <div key={action} className="flex items-center justify-between gap-2">
                <span className="text-sm">{label}</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline" size="sm" disabled={!supported}
                    onClick={() => { setHotkeyError(null); setCapturing(capturing === action ? null : action); }}
                  >
                    {capturing === action ? "키를 누르세요…" : code === null ? "꺼짐" : keyLabel(code)}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={!supported || code === null} onClick={() => setHotkey(action, null)}>
                    끄기
                  </Button>
                </div>
              </div>
            );
          })}
          {hotkeyError && <p className="text-xs text-destructive">{hotkeyError}</p>}
          {showMismatch && (
            <p className="text-xs text-muted-foreground">게임에 적용되지 않은 단축키가 있어요 — 플러그인을 업데이트해 주세요</p>
          )}
        </div>
        <Separator />
        <p className="text-xs text-muted-foreground">{hotkeySummary(hotkeys)}</p>
      </PopoverContent>
    </Popover>
  );
}
