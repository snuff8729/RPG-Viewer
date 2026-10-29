import { memo, useEffect, useState, type ReactNode } from "react";
import { FolderOpen, Heart, HeartCrack, History, Save, type LucideIcon } from "lucide-react";
import { useAssist } from "@/app/LiveProvider";
import {
  AUTO_SPEEDS, DEFAULT_HOTKEYS, HOTKEY_ACTIONS, HOTKEY_GROUPS, hotkeyCode, isAutoSpeed, isQuickSlot, isSpeed, keyLabel, sameHotkeys, SPEEDS,
  validateHotkey, type HotkeyAction,
} from "@/core/live/assist";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { assistItemLabel, assistItemShortLabel, type AssistCommandItemId, type AssistFavoriteSlot } from "./assistItems";
import { useAssistGuards } from "./useAssistSession";

/** sm = 게임 보조 창·위 줄(작게), lg = 휴대폰(크게 누르기 쉽게). 버튼·배속 고르기에만 적용된다. */
export type AssistControlSize = "sm" | "lg";

interface ControlProps {
  size?: AssistControlSize;
  /** 조작 옆(줄·칸의 오른쪽 끝)에 둘 것(예: 즐겨찾기 ☆). 없으면 조작만 그린다. */
  favorite?: ReactNode;
  /** 짧은 이름(맨 위 줄). 긴 이름은 툴팁(title)으로. 배속 고르기는 칸을 붙여 좁게 그린다. */
  short?: boolean;
}

/** ☆가 있는 버튼 묶음 칸: 칸마다 버튼 + 오른쪽 끝 ☆(보조 탭·백업 줄이 같이 쓴다) */
// eslint-disable-next-line react-refresh/only-export-components
export const ASSIST_FAVORITE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2";

/** 조작 + 줄(칸) 오른쪽 끝에 둘 것. 옆에 둘 것이 없으면 감싸지 않는다(모양 그대로). */
function WithFavorite({ favorite, children }: { favorite?: ReactNode; children: ReactNode }) {
  if (favorite == null || favorite === false) return <>{children}</>;
  return <div className="flex min-w-0 items-center gap-1">{children}<span className="ml-auto shrink-0">{favorite}</span></div>;
}

/** 배속(×1 ~). */
export function SpeedControl({ size = "sm", favorite, short }: ControlProps) {
  const { settings, setSettings, supported } = useAssist();
  return (
    <WithFavorite favorite={favorite}>
      <ToggleGroup
        type="single" variant="outline" size={size} spacing={short ? 0 : undefined} disabled={!supported} aria-label={assistItemLabel("speed")}
        title={short ? assistItemLabel("speed") : undefined}
        value={String(settings.speed)}
        onValueChange={(v) => { const n = Number(v); if (isSpeed(n)) setSettings({ ...settings, speed: n }); }}
      >
        {SPEEDS.map((s) => <ToggleGroupItem key={s} value={String(s)}>×{s}</ToggleGroupItem>)}
      </ToggleGroup>
    </WithFavorite>
  );
}

/** 본 이벤트 자동 배속의 빠르기(자동 배속이 켜져 있을 때만). */
export function AutoSpeedControl({ size = "sm", short }: { size?: AssistControlSize; short?: boolean }) {
  const { settings, setSettings, supported } = useAssist();
  return (
    <ToggleGroup
      type="single" variant="outline" size={size} spacing={short ? 0 : undefined} disabled={!supported || !settings.autoFast} aria-label="자동 배속 빠르기"
      title={short ? "자동 배속 빠르기" : undefined}
      value={String(settings.autoSpeed)}
      onValueChange={(v) => { const n = Number(v); if (isAutoSpeed(n)) setSettings({ ...settings, autoSpeed: n }); }}
    >
      {AUTO_SPEEDS.map((s) => <ToggleGroupItem key={s} value={String(s)}>×{s}</ToggleGroupItem>)}
    </ToggleGroup>
  );
}

/** 이름 + 켜고 끄기 한 줄. 줄에서는 이름 왼쪽, 스위치·☆ 오른쪽 끝(☆가 맨 끝). short = 맨 위 줄(이름 바로 옆에 스위치). */
function SwitchRow({ id, label, title, checked, onChange, favorite, short }: {
  id: string; label: string; title?: string; checked: boolean; onChange(c: boolean): void; favorite?: ReactNode; short?: boolean;
}) {
  const { supported } = useAssist();
  return (
    <div className={short ? "flex items-center gap-1.5" : "flex items-center gap-2"} title={title}>
      <Label htmlFor={id} className={short ? undefined : "mr-auto"}>{label}</Label>
      <Switch id={id} disabled={!supported} checked={checked} onCheckedChange={onChange} />
      {favorite}
    </div>
  );
}

/** 본 대사 자동 넘기기 켜고 끄기. 한 화면에 둘 이상 둘 때는 id를 달리 준다. */
export function SkipSeenControl({ favorite, short, id = "assist-skip-seen" }: ControlProps & { id?: string }) {
  const { settings, setSettings } = useAssist();
  return (
    <SwitchRow
      id={id} label={short ? assistItemShortLabel("skipSeen") : assistItemLabel("skipSeen")} title={short ? assistItemLabel("skipSeen") : undefined}
      checked={settings.skipSeen} favorite={favorite} short={short}
      onChange={(c) => setSettings({ ...settings, skipSeen: c })}
    />
  );
}

/** 본 이벤트 자동 배속 켜고 끄기. 한 화면에 둘 이상 둘 때는 id를 달리 준다. */
export function AutoFastControl({ favorite, short, id = "assist-auto-fast" }: ControlProps & { id?: string }) {
  const { settings, setSettings } = useAssist();
  return (
    <SwitchRow
      id={id} label={short ? assistItemShortLabel("autoFast") : assistItemLabel("autoFast")} title={short ? assistItemLabel("autoFast") : undefined}
      checked={settings.autoFast} favorite={favorite} short={short}
      onChange={(c) => setSettings({ ...settings, autoFast: c })}
    />
  );
}

const COMMAND_ICON: Partial<Record<AssistCommandItemId, LucideIcon>> = {
  enemyHpFull: Heart, enemyHpLow: HeartCrack, hpFull: Heart, hpLow: HeartCrack,
  quickSave: Save, quickLoad: History, saveMenu: Save, loadMenu: FolderOpen,
};

/** 누르기 전에 한 번 더 묻는 명령 */
const CONFIRM: Partial<Record<AssistCommandItemId, { title: string; description: string; action: string }>> = {
  lose: { title: "전투 지기", description: "이 전투는 지면 게임 오버예요. 저장하지 않은 진행은 사라져요. 그래도 질까요?", action: "지기" },
  quickLoad: { title: "퀵 로드", description: "퀵 세이브를 불러와요. 저장하지 않은 진행은 사라져요.", action: "불러오기" },
};

/**
 * 게임에 명령 하나를 보내는 버튼(이기기·지기·도망·적 체력·내 체력·세이브·로드).
 * 쓸 수 없을 때(전투 밖·플러그인 버전·도망 못 침)는 꺼지고, 지기(게임 오버 전투)·퀵 로드는 한 번 더 묻는다.
 */
export function AssistCommandButton({ id, size = "sm", favorite, short }: ControlProps & { id: AssistCommandItemId }) {
  const { sendCommand } = useAssist();
  const g = useAssistGuards();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const disabled = (() => {
    switch (id) {
      case "win": case "lose": return !g.inBattle;
      case "escape": return !g.inBattle || !g.canEscape;
      case "enemyHpFull": case "enemyHpLow": return !g.inBattle || !g.enemyHpSupported;
      case "hpFull": case "hpLow": return !g.hpSupported;
      case "quickSave": case "quickLoad": case "saveMenu": case "loadMenu": return !g.saveSupported;
    }
  })();
  const confirm = CONFIRM[id];
  /** 지기는 게임 오버 전투일 때만 묻는다 */
  const ask = confirm !== undefined && (id !== "lose" || !g.canLose);
  const Icon = COMMAND_ICON[id];
  return (
    <>
      <WithFavorite favorite={favorite}>
        <Button
          variant="outline" size={size} disabled={disabled} className={favorite ? "min-w-0 flex-1" : undefined}
          title={short && assistItemShortLabel(id) !== assistItemLabel(id) ? assistItemLabel(id) : undefined}
          onClick={() => { if (ask) setConfirmOpen(true); else sendCommand(id); }}
        >
          {Icon && <Icon />}{short ? assistItemShortLabel(id) : assistItemLabel(id)}
        </Button>
      </WithFavorite>
      {confirm && (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => sendCommand(id)}>{confirm.action}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

interface GroupProps {
  size?: AssistControlSize;
  /** 각 버튼 옆에 둘 것(예: 즐겨찾기 ☆)을 id로 */
  favorite?: AssistFavoriteSlot;
  className?: string;
}

/** ☆가 있으면 칸 나눔(칸마다 버튼 + 오른쪽 끝 ☆), 없으면 버튼만 한 줄(줄 바꿈) */
function CommandGroup({ ids, size, favorite, className }: GroupProps & { ids: readonly AssistCommandItemId[] }) {
  return (
    <div className={className ?? (favorite ? ASSIST_FAVORITE_GRID : "flex flex-wrap gap-2")}>
      {ids.map((id) => <AssistCommandButton key={id} id={id} size={size} favorite={favorite?.(id)} />)}
    </div>
  );
}

/** 전투: 이기기 · 지기 · 도망 */
export function BattleControls(props: GroupProps) {
  return <CommandGroup ids={["win", "lose", "escape"]} {...props} />;
}

/** 적 체력 100% · 1% */
export function EnemyHpControls(props: GroupProps) {
  return <CommandGroup ids={["enemyHpFull", "enemyHpLow"]} {...props} />;
}

/** 내 체력 100% · 1% */
export function HpControls(props: GroupProps) {
  return <CommandGroup ids={["hpFull", "hpLow"]} {...props} />;
}

/** 퀵 세이브 · 퀵 로드 · 세이브 창 · 로드 창 */
export function SaveControls(props: GroupProps) {
  return <CommandGroup ids={["quickSave", "quickLoad", "saveMenu", "loadMenu"]} {...props} />;
}

/** 퀵 세이브 칸 입력(빈칸 = 마지막 칸) */
export function QuickSlotInput({ id = "assist-quick-slot" }: { id?: string }) {
  const { settings, setSettings } = useAssist();
  const { saveSupported } = useAssistGuards();
  // 고칠 때는 입력값, 아니면 설정값
  const [slotDraft, setSlotDraft] = useState<string | null>(null);
  const commitSlot = () => {
    if (slotDraft === null) return;
    const t = slotDraft.trim();
    const n = Number(t);
    setSlotDraft(null);
    if (t === "") setSettings({ ...settings, quickSlot: null });
    else if (isQuickSlot(n)) setSettings({ ...settings, quickSlot: n });
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor={id}>퀵 세이브 칸</Label>
      <Input
        id={id} className="w-28" type="number" min={1} max={999} inputMode="numeric"
        disabled={!saveSupported} placeholder="마지막 칸"
        value={slotDraft ?? (settings.quickSlot === null ? "" : String(settings.quickSlot))}
        onChange={(e) => setSlotDraft(e.target.value)}
        onBlur={commitSlot}
        onKeyDown={(e) => { if (e.key === "Enter") commitSlot(); }}
      />
    </div>
  );
}

/**
 * 단축키 설정. 동작을 고르면 다음 keydown을 Ctrl·Shift·Alt 조합과 함께 잡는다(Escape는 취소). 사라지면 잡기도 멈춘다.
 * memo: 게임 상태가 바뀔 때마다 보조 화면이 다시 그려져도 단축키 줄들은 설정이 바뀔 때만 다시 그린다.
 */
export const HotkeySettings = memo(function HotkeySettings({ showMismatch, active = true }: {
  showMismatch: boolean;
  /** false가 되면(창을 닫으면) 잡기와 오류 글을 지운다 */
  active?: boolean;
}) {
  const { settings, setSettings, supported } = useAssist();
  const hotkeys = settings.hotkeys;
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  /** 잡는 중에 누르고 있는 조합 키("Ctrl+Shift+") */
  const [heldMods, setHeldMods] = useState("");
  if (!active && (capturing !== null || heldMods !== "" || hotkeyError !== null)) {
    setCapturing(null);
    setHeldMods("");
    setHotkeyError(null);
  }
  useEffect(() => {
    if (capturing === null) return;
    const modsOf = (e: KeyboardEvent) => (e.ctrlKey ? "Ctrl+" : "") + (e.shiftKey ? "Shift+" : "") + (e.altKey ? "Alt+" : "");
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setCapturing(null); setHeldMods(""); return; }
      // 조합 키만 누르면 다음 키를 기다린다
      if (e.keyCode === 16 || e.keyCode === 17 || e.keyCode === 18 || e.key === "Meta") { setHeldMods(modsOf(e)); return; }
      const code = hotkeyCode(e.keyCode, { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
      const err = validateHotkey(code, capturing, hotkeys);
      setHotkeyError(err);
      setCapturing(null);
      setHeldMods("");
      if (err === null) setSettings({ ...settings, hotkeys: { ...hotkeys, [capturing]: code } });
    };
    const onKeyUp = (e: KeyboardEvent) => setHeldMods(modsOf(e));
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [capturing, hotkeys, settings, setSettings]);

  const setHotkey = (action: HotkeyAction, code: number | null) => {
    setHotkeyError(null);
    setCapturing(null);
    setHeldMods("");
    setSettings({ ...settings, hotkeys: { ...hotkeys, [action]: code } });
  };

  return (
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
      {HOTKEY_GROUPS.map((group) => (
        <div key={group} className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{group}</p>
          {HOTKEY_ACTIONS.filter((a) => a.group === group).map(({ action, label }) => {
            const code = hotkeys[action];
            return (
              <div key={action} className="flex items-center justify-between gap-2">
                <span className="min-w-0 text-sm">{label}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline" size="sm" disabled={!supported}
                    onClick={() => { setHotkeyError(null); setHeldMods(""); setCapturing(capturing === action ? null : action); }}
                  >
                    {capturing === action ? `${heldMods}키를 누르세요…` : code === null ? "꺼짐" : keyLabel(code)}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={!supported || code === null} onClick={() => setHotkey(action, null)}>
                    끄기
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {capturing !== null && (
        <p className="text-xs text-muted-foreground">Ctrl·Shift·Alt를 누른 채로 누르면 조합 키가 돼요 (Esc: 취소)</p>
      )}
      {hotkeyError && <p className="text-xs text-destructive">{hotkeyError}</p>}
      {showMismatch && (
        <p className="text-xs text-muted-foreground">게임에 적용되지 않은 단축키가 있어요 — 플러그인을 업데이트해 주세요</p>
      )}
    </div>
  );
});
