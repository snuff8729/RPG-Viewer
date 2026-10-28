import { useMemo, useState } from "react";
import { ChevronRight, ChevronsUpDown, EllipsisVertical } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { branchLabel, representative } from "@/core/live/history";
import {
  branchList, hideUpTo, isHidden, KEEP_RECENT, summarizeBranches, tidyOld, tidyOldCount, updatePref,
  type BranchRow, type BranchSummary,
} from "@/core/live/branchTidy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useBranchPrefs } from "./branchPrefs";
import { branchName, firstPickText, lastLineText } from "./branchText";
import { usePluginOverrides } from "./pluginDisplay";

type Confirm = { kind: "tidy"; count: number } | { kind: "upTo"; id: number; count: number };

/**
 * 갈래 고르기 + 정리(이름·고정·숨기기). 숨기기는 목록에서만 빠진다 — 기록·이어하기·처음부터 읽기(조상 경로)는 그대로.
 * selected·onSelect는 대표 갈래 id.
 */
export function BranchPicker({ selected, onSelect }: { selected: number; onSelect: (id: number) => void }) {
  const { data } = useGame();
  const { records, model, latestBranch } = useLive();
  const { overrides } = usePluginOverrides();
  const [prefs, updatePrefs] = useBranchPrefs();
  const [open, setOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [renaming, setRenaming] = useState<{ id: number; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const summaries = useMemo(() => summarizeBranches(records, model, { overrides }), [records, model, overrides]);
  const current = representative(model, selected);
  const list = useMemo(
    () => branchList(summaries, prefs, { showHidden, always: current }),
    [summaries, prefs, showHidden, current],
  );
  const tidyCount = useMemo(() => tidyOldCount(summaries, prefs, KEEP_RECENT, latestBranch), [summaries, prefs, latestBranch]);
  const nameOf = (id: number) => branchName(summaries.get(id), prefs, data, branchLabel(model, id));

  const pick = (id: number) => { onSelect(id); setOpen(false); };
  const set = (id: number, patch: Parameters<typeof updatePref>[2]) => updatePrefs(p => updatePref(p, id, patch, Date.now()));
  const askUpTo = (id: number) => {
    const count = hideUpTo(summaries, prefs, id, 0).count;
    setOpen(false);
    setConfirm({ kind: "upTo", id, count });
  };
  const doConfirm = () => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    updatePrefs(p => (c.kind === "tidy"
      ? tidyOld(summaries, p, Date.now(), KEEP_RECENT, latestBranch).prefs
      : hideUpTo(summaries, p, c.id, Date.now()).prefs));
  };
  const saveRename = () => {
    if (renaming) set(renaming.id, { label: renaming.text });
    setRenaming(null);
  };

  const renderRow = (row: BranchRow, nested = false) => {
    const s = summaries.get(row.id);
    if (!s) return null;
    return (
      <div key={row.id} className={nested ? "ml-4" : undefined}>
        <Row
          s={s} row={row} name={nameOf(row.id)} selected={row.id === current} latest={row.id === latestBranch}
          line={lastLineText(s, data)} choice={firstPickText(s, data)}
          onPick={() => pick(row.id)}
          onRename={() => { setOpen(false); setRenaming({ id: row.id, text: prefs.branches[String(row.id)]?.label ?? "" }); }}
          onPin={() => set(row.id, { pinned: !row.pinned })}
          onHide={() => set(row.id, { hidden: !isHidden(s, prefs) })}
          onHideUpTo={() => askUpTo(row.id)}
        />
        {row.shorts.length > 0 && (
          <Collapsible className="ml-4">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="xs" className="group text-muted-foreground">
                <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
                짧은 갈래 {row.shorts.length}개
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>{row.shorts.map(r => renderRow(r, true))}</CollapsibleContent>
          </Collapsible>
        )}
      </div>
    );
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-72 justify-between font-normal">
            <span className="truncate">{prefs.branches[String(current)]?.pinned ? "★ " : ""}{nameOf(current)}</span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[28rem] max-w-[calc(100vw-2rem)] p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-2">
            <div className="flex items-center gap-2">
              <Switch id="branch-show-hidden" checked={showHidden} onCheckedChange={setShowHidden} />
              <Label htmlFor="branch-show-hidden">숨긴 갈래 보기 ({list.hiddenCount})</Label>
            </div>
            <Button
              variant="ghost" size="sm" disabled={tidyCount === 0}
              onClick={() => { setOpen(false); setConfirm({ kind: "tidy", count: tidyCount }); }}
            >
              오래된 갈래 정리
            </Button>
          </div>
          <div className="max-h-[60svh] overflow-y-auto">
            <div className="space-y-3 p-2">
              {list.pinned.length > 0 && (
                <div className="space-y-1">
                  <p className="px-2 text-xs text-muted-foreground">고정</p>
                  {list.pinned.map(r => renderRow(r))}
                </div>
              )}
              {list.runs.map(run => (
                <div key={run.run} className="space-y-1">
                  <p className="px-2 text-xs text-muted-foreground">{run.run}회차</p>
                  {run.rows.map(r => renderRow(r))}
                </div>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={renaming !== null} onOpenChange={o => { if (!o) setRenaming(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>갈래 이름 바꾸기</DialogTitle>
            <DialogDescription>비워 두면 자동 이름으로 보여요.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus value={renaming?.text ?? ""}
            placeholder={renaming ? branchName(summaries.get(renaming.id), { v: 1, t: 0, branches: {} }, data, "") : ""}
            onChange={e => setRenaming(r => (r ? { ...r, text: e.target.value } : r))}
            onKeyDown={e => { if (e.key === "Enter") saveRename(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>취소</Button>
            <Button onClick={saveRename}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm !== null} onOpenChange={o => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>갈래 {confirm?.count ?? 0}개를 숨길까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "tidy"
                ? `최근 ${KEEP_RECENT}개와 고정한 갈래만 남기고 숨겨요.`
                : "이 갈래와 그 전에 시작한 갈래를 숨겨요(고정한 갈래는 남아요)."}
              {" "}기록은 지워지지 않고, `숨긴 갈래 보기`에서 다시 보이게 할 수 있어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={doConfirm}>숨기기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Row({ s, row, name, selected, latest, line, choice, onPick, onRename, onPin, onHide, onHideUpTo }: {
  s: BranchSummary; row: BranchRow; name: string; selected: boolean; latest: boolean;
  line: string | null; choice: string | null;
  onPick(): void; onRename(): void; onPin(): void; onHide(): void; onHideUpTo(): void;
}) {
  return (
    <Item
      size="xs" variant={selected ? "muted" : "default"} role="option" aria-selected={selected} tabIndex={0}
      className="cursor-pointer flex-nowrap hover:bg-muted"
      onClick={onPick}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } }}
    >
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full min-w-0">
          <span className="truncate">{row.pinned ? "★ " : ""}{name}</span>
          {latest && <Badge variant="secondary">최근</Badge>}
          {row.hidden && <Badge variant="outline">숨김</Badge>}
          {s.kind === "duplicate" && <Badge variant="outline">중복</Badge>}
          {s.kind === "empty" && <Badge variant="outline">빈 갈래</Badge>}
        </ItemTitle>
        {line && <ItemDescription className="truncate">{line}</ItemDescription>}
        {choice && <ItemDescription className="truncate">선택: {choice}</ItemDescription>}
      </ItemContent>
      <ItemActions onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="갈래 메뉴"><EllipsisVertical /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRename}>이름 바꾸기</DropdownMenuItem>
            <DropdownMenuItem onSelect={onPin}>{row.pinned ? "고정 해제" : "★ 고정"}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onHide}>{row.hidden ? "다시 보이기" : "숨기기"}</DropdownMenuItem>
            <DropdownMenuItem onSelect={onHideUpTo}>이 갈래와 이전 갈래 모두 숨기기</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  );
}
