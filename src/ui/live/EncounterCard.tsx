import { useMemo } from "react";
import { Swords } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { mapEncounters } from "@/core/live/enemies";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { sectionStyle } from "./sectionStyle";

/** 이 맵의 랜덤 인카운트: 적 그룹과 나올 확률, 구역 번호. 없으면 아무것도 안 그린다. */
export function EncounterCard({ mapId }: { mapId: number }) {
  const { data } = useGame();
  const enc = useMemo(() => (data ? mapEncounters(data, mapId) : null), [data, mapId]);
  if (!enc) return null;
  const st = sectionStyle("enemy");
  return (
    <Card className={cn("gap-2 border-l-4 py-3", st.border)}>
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Swords className={cn("size-4", st.text)} aria-hidden />
          이 맵에서 나오는 적
        </CardTitle>
        <CardDescription>
          걸어 다니면 평균 {enc.step}걸음마다 나와요
          {enc.regions.length > 0 && " · 구역이 정해진 적은 그 구역에서만 나와요"}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <ul className="space-y-1 text-sm">
          {enc.entries.map((e, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{e.name}</span>
              <Badge variant="secondary" className="tabular-nums">{e.chance}%</Badge>
              {e.regions.length > 0 && <Badge variant="outline">구역 {e.regions.join(", ")}</Badge>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
