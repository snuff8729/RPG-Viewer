import { useCallback, useEffect, useRef, useState } from "react";
import { WandSparkles } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { useAssist, useLive } from "@/app/LiveProvider";
import { loadAutoBackup, makeBackup, notifyBackupsChanged } from "@/app/backups";
import {
  CHEAT_MIN_VERSION, CHEAT_STATUS_TEXT, describeCheatOp, inverseCheatOps, undoable, type CheatOp, type CheatStatus,
} from "@/core/live/cheat";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { gameKeyOf } from "../readPosition";
import { useGamePath, useLauncherAvailable } from "../useGamePath";
import { ActorsTab } from "./ActorsTab";
import { ItemsTab } from "./ItemsTab";
import { SwitchesTab } from "./SwitchesTab";

const OPEN_EVENT = "rpgv:open-cheat";
/** 다른 곳(게임 보조 창)에서 치트 창을 연다 */
// eslint-disable-next-line react-refresh/only-export-components
export function openCheatSheet(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** 이번 세션에 `치트 전` 자동 백업을 한 게임 */
const backedUp = new Set<string>();
const HISTORY_MAX = 30;

interface HistoryEntry {
  n: number; label: string; keys: string[];
  /** 되돌리기 op(없으면 되돌릴 수 없음) */
  inverse: CheatOp[] | null;
  undone: boolean;
}

/** 기록 하나의 상태: 묶음들 중 가장 나쁜 것 */
function entryStatus(keys: string[], results: ReadonlyMap<string, CheatStatus>): CheatStatus {
  const all = keys.map((k) => results.get(k) ?? "queued");
  for (const s of ["failed", "noResponse", "ignored", "notApplied", "queued", "sent"] as const) if (all.includes(s)) return s;
  return "applied";
}

const STATUS_VARIANT: Record<CheatStatus, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline", sent: "outline", applied: "secondary", ignored: "outline", failed: "destructive", notApplied: "outline", noResponse: "destructive",
};

/** 상단 `치트` 버튼과 창: 아이템·돈, 캐릭터, 스위치·변수. 바꾼 것은 실행 중인 게임에 바로 적용된다. */
export function CheatSheet() {
  const { data } = useGame();
  const { live, connection } = useLive();
  const { cheatSupported, sendCheat, cheatResults, setLiveActors } = useAssist();
  const [open, setOpen] = useState(false);
  const available = useLauncherAvailable();
  const gameKey = data ? gameKeyOf(data) : null;
  const { path } = useGamePath(gameKey);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const seq = useRef(0);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  // 창이 열려 있는 동안 게임이 캐릭터 정보를 보낸다
  useEffect(() => {
    setLiveActors(open && cheatSupported);
    return () => setLiveActors(false);
  }, [open, cheatSupported, setLiveActors]);
  // 게임이 바뀌면 기록을 비운다
  const [historyKey, setHistoryKey] = useState(gameKey);
  if (historyKey !== gameKey) { setHistoryKey(gameKey); setHistory([]); }

  const apply = useCallback((ops: CheatOp[], label?: string) => {
    if (!data || ops.length === 0) return;
    const keys = sendCheat(ops);
    if (keys.length === 0) return;
    // 이번 세션 첫 치트 전에 자동 백업(세이브 파일은 치트로 바뀌지 않으므로 기다리지 않는다)
    if (gameKey && !backedUp.has(gameKey)) {
      backedUp.add(gameKey);
      if (available && path && loadAutoBackup(gameKey)) {
        void makeBackup(path, "auto", "치트 전").then((r) => { if (r.ok && !r.skipped) notifyBackupsChanged(); });
      }
    }
    const text = label ?? (ops.length === 1 ? describeCheatOp(ops[0], data) : `${describeCheatOp(ops[0], data)} 외 ${ops.length - 1}개`);
    const inverse = undoable(ops) ? inverseCheatOps(ops, live) : null;
    setHistory((h) => [{ n: ++seq.current, label: text, keys, inverse, undone: false }, ...h].slice(0, HISTORY_MAX));
  }, [data, sendCheat, gameKey, available, path, live]);

  const undo = (e: HistoryEntry) => {
    if (!e.inverse) return;
    setHistory((h) => h.map((x) => (x.n === e.n ? { ...x, undone: true } : x)));
    apply(e.inverse, `되돌리기: ${e.label}`);
  };

  const backupNow = async () => {
    if (!path) return;
    setBackingUp(true);
    setBackupNote(null);
    const r = await makeBackup(path, "manual", "치트 전");
    setBackingUp(false);
    if (r.ok) { notifyBackupsChanged(); setBackupNote(r.skipped ? "바뀐 게 없어서 지난 백업을 그대로 둬요" : "백업했어요"); }
    else setBackupNote(r.error);
  };

  if (!data) return null;
  const disabled = !cheatSupported;
  const connected = connection === "connected" && live !== null;
  const props = { data, live, disabled, apply };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm"><WandSparkles />치트</Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>치트</SheetTitle>
          <SheetDescription>누르면 실행 중인 게임에 바로 적용돼요. 게임에서 저장해야 세이브에 남아요.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {disabled && (
            <Alert>
              <AlertDescription>
                게임이 연결되어 있어야 해요.
                {connected && ` 게임의 기록 플러그인(${live?.pluginVersion || "?"})을 ${CHEAT_MIN_VERSION}으로 업데이트하고 게임을 다시 실행해 주세요.`}
              </AlertDescription>
            </Alert>
          )}
          <Tabs defaultValue="items">
            <TabsList className="w-full">
              <TabsTrigger value="items">아이템</TabsTrigger>
              <TabsTrigger value="actors">캐릭터</TabsTrigger>
              <TabsTrigger value="switches">스위치·변수 (고급)</TabsTrigger>
            </TabsList>
            <TabsContent value="items" className="pt-2"><ItemsTab {...props} /></TabsContent>
            <TabsContent value="actors" className="pt-2"><ActorsTab {...props} /></TabsContent>
            <TabsContent value="switches" className="flex flex-col gap-4 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-destructive">이야기 진행이 꼬일 수 있어요. 먼저 백업해 두세요.</p>
                {available && path && (
                  <Button variant="outline" size="sm" disabled={backingUp} onClick={() => void backupNow()}>지금 백업</Button>
                )}
              </div>
              {backupNote && <p className="text-xs text-muted-foreground">{backupNote}</p>}
              <SwitchesTab {...props} />
            </TabsContent>
          </Tabs>
          {history.length > 0 && (
            <>
              <Separator />
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">바꾼 것</p>
                <ItemGroup className="gap-1">
                  {history.map((e) => {
                    const status = entryStatus(e.keys, cheatResults);
                    return (
                      <Item key={e.n} variant="muted" size="xs">
                        <ItemContent>
                          <ItemTitle>{e.label}</ItemTitle>
                          {!e.inverse && <ItemDescription>되돌릴 수 없어요</ItemDescription>}
                        </ItemContent>
                        <ItemActions>
                          <Badge variant={STATUS_VARIANT[status]}>{CHEAT_STATUS_TEXT[status]}</Badge>
                          {e.inverse && (
                            <Button variant="ghost" size="xs" disabled={disabled || e.undone || status !== "applied"} onClick={() => undo(e)}>
                              {e.undone ? "되돌림" : "되돌리기"}
                            </Button>
                          )}
                        </ItemActions>
                      </Item>
                    );
                  })}
                </ItemGroup>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
