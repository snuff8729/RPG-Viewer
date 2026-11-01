import { useRef } from "react";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import { locationKey } from "@/core/index/locations";
import type { LiveSnapshot } from "@/core/live/types";
import { armorName, itemName, switchName, variableName, weaponName } from "@/core/text/names";
import type { GameData, PageEntry, Ref } from "@/core/types";
import { Badge } from "@/components/ui/badge";
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

/** 게임과 연결됐을 때 이 항목의 지금 값(스위치 켜짐·꺼짐, 변수 값, 가진 개수). 모르면 null */
export function refLiveValue(live: LiveSnapshot | null, ref: Ref): string | null {
  if (!live) return null;
  const id = String(ref.id);
  switch (ref.type) {
    case "switch": return Array.isArray(live.switches) ? (live.switches.includes(Number(ref.id)) ? "켜짐" : "꺼짐") : null;
    case "variable": return live.variables ? String(live.variables[id] ?? 0) : null;
    case "item": return live.items ? `${live.items[id] ?? 0}개` : null;
    case "weapon": return live.weapons ? `${live.weapons[id] ?? 0}개` : null;
    case "armor": return live.armors ? `${live.armors[id] ?? 0}개` : null;
    default: return null;
  }
}

function Section({ title, pages, onPick }: { title: string; pages: PageEntry[]; onPick: (p: PageEntry) => void }) {
  return (
    <section className="px-4">
      <h3 className="mb-1 text-sm font-medium">{title} ({pages.length})</h3>
      {pages.length === 0
        ? <p className="text-sm text-muted-foreground">없어요</p>
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
  const { live, connection } = useLive();
  const last = useRef<Ref | null>(null);
  if (refTarget) last.current = refTarget;
  const shown = last.current;
  const xref = shown && index ? index.xref(shown) : null;
  const title = shown && data ? refTitle(data, shown) : "";
  const value = shown && connection === "connected" ? refLiveValue(live, shown) : null;
  const pick = (p: PageEntry) => { onClose(); openPage(p.location); };
  return (
    <Sheet open={!!refTarget} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {shown && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">번호 {String(shown.id).padStart(4, "0")}</Badge>
              {value !== null && <Badge variant="secondary">지금 값 {value}</Badge>}
            </div>
          )}
          <SheetDescription>이 항목을 쓰는 이벤트 목록이에요</SheetDescription>
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
