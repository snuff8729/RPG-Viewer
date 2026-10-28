import { useRef } from "react";
import { useGame } from "@/app/GameProvider";
import { locationKey } from "@/core/index/locations";
import { armorName, itemName, switchName, variableName, weaponName } from "@/core/text/names";
import type { GameData, PageEntry, Ref } from "@/core/types";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { openPage } from "./navigation";

export function refTitle(data: GameData, ref: Ref): string {
  const id = Number(ref.id);
  switch (ref.type) {
    case "switch": return `스위치: ${switchName(data, id)}`;
    case "variable": return `변수: ${variableName(data, id)}`;
    case "item": return `아이템: ${itemName(data, id)}`;
    case "weapon": return `무기: ${weaponName(data, id)}`;
    case "armor": return `방어구: ${armorName(data, id)}`;
    default: return "";
  }
}

function Section({ title, pages, onPick }: { title: string; pages: PageEntry[]; onPick: (p: PageEntry) => void }) {
  return (
    <section className="px-4">
      <h3 className="mb-1 text-sm font-medium">{title} ({pages.length})</h3>
      {pages.length === 0
        ? <p className="text-sm text-muted-foreground">없음</p>
        : pages.map((p) => (
          <Button key={locationKey(p.location)} variant="ghost" size="sm" className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => onPick(p)}>
            {p.path}
          </Button>
        ))}
    </section>
  );
}

export function XrefSheet({ refTarget, onClose }: { refTarget: Ref | null; onClose: () => void }) {
  const { data, index } = useGame();
  const last = useRef<Ref | null>(null);
  if (refTarget) last.current = refTarget;
  const shown = last.current;
  const xref = shown && index ? index.xref(shown) : null;
  const title = shown && data ? refTitle(data, shown) : "";
  const pick = (p: PageEntry) => { onClose(); openPage(p.location); };
  return (
    <Sheet open={!!refTarget} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>이 항목을 쓰는 이벤트 목록</SheetDescription>
        </SheetHeader>
        {xref && (
          <div className="space-y-4 overflow-y-auto pb-4">
            <Section title="값을 바꾸는 곳" pages={xref.writes} onPick={pick} />
            <Section title="조건으로 쓰는 곳" pages={xref.reads} onPick={pick} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
