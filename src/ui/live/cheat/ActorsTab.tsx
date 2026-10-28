import { useMemo, useState } from "react";
import { HeartPulse, Minus, Plus, Search } from "lucide-react";
import { baseParams, liveActor, PARAM_NAMES, searchEntries, type SearchEntry } from "@/core/live/cheat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LIST_LIMIT, parseIntInput, type CheatTabProps } from "./shared";

const STEPS = [1, 10, 100] as const;

/** 기술·상태 찾기 목록: 가진 것에는 표시, 버튼으로 배우기/잊기·걸기/풀기 */
function OwnedList({ label, list, owned, known, disabled, onAdd, onRemove, addText, removeText }: {
  label: string; list: readonly (SearchEntry | null)[] | undefined; owned: Set<number>; known: boolean; disabled: boolean;
  onAdd(id: number): void; onRemove(id: number): void; addText: string; removeText: string;
}) {
  const [query, setQuery] = useState("");
  const hits = useMemo(() => {
    const all = searchEntries(list, query, query.trim() === "" ? Infinity : LIST_LIMIT + 1);
    // 검색어가 없으면 가진 것 먼저
    return query.trim() === "" ? [...all.filter((e) => owned.has(e.id)), ...all.filter((e) => !owned.has(e.id))].slice(0, LIST_LIMIT + 1) : all;
  }, [list, query, owned]);
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <InputGroup>
        <InputGroupAddon><Search /></InputGroupAddon>
        <InputGroupInput placeholder={`${label} 찾기`} value={query} onChange={(e) => setQuery(e.target.value)} />
      </InputGroup>
      <ItemGroup className="max-h-64 gap-1 overflow-y-auto">
        {hits.slice(0, LIST_LIMIT).map((e) => {
          const has = owned.has(e.id);
          return (
            <Item key={e.id} variant="outline" size="xs">
              <ItemContent>
                <ItemTitle>
                  {e.name || `#${e.id}`}
                  {has && <Badge variant="secondary">있음</Badge>}
                </ItemTitle>
              </ItemContent>
              <ItemActions>
                <Button variant="outline" size="xs" disabled={disabled || (known && has)} onClick={() => onAdd(e.id)}>{addText}</Button>
                <Button variant="outline" size="xs" disabled={disabled || (known && !has)} onClick={() => onRemove(e.id)}>{removeText}</Button>
              </ItemActions>
            </Item>
          );
        })}
      </ItemGroup>
      {hits.length === 0 && <p className="text-sm text-muted-foreground">찾는 항목이 없어요</p>}
      {hits.length > LIST_LIMIT && <p className="text-xs text-muted-foreground">더 있어요. 검색어로 좁혀 주세요</p>}
    </div>
  );
}

/** `캐릭터` 탭: 레벨·경험치·능력치·회복·기술·상태 */
export function ActorsTab({ data, live, disabled, apply }: CheatTabProps) {
  // 파티(연결됐으면 지금 파티, 아니면 데이터베이스의 모든 캐릭터)
  const members = useMemo(() => {
    const ids = live && Array.isArray(live.party) && live.party.length > 0
      ? live.party
      : data.actors.flatMap((a) => (a && typeof a.id === "number" ? [a.id] : []));
    return ids.map((id) => ({ id, name: liveActor(live, id)?.name || data.actors[id]?.name || `캐릭터 ${id}` }));
  }, [data, live]);
  const [picked, setPicked] = useState<number | null>(null);
  const actorId = picked !== null && members.some((m) => m.id === picked) ? picked : (members[0]?.id ?? null);
  const la = actorId === null ? null : liveActor(live, actorId);
  const base = actorId === null ? null : baseParams(data, actorId);
  const params = la?.params ?? base;
  const [step, setStep] = useState<(typeof STEPS)[number]>(10);
  const [levelText, setLevelText] = useState("");
  const [expText, setExpText] = useState("");
  const level = parseIntInput(levelText);
  const exp = parseIntInput(expText);
  const skills = useMemo(() => new Set(la?.skills ?? []), [la]);
  const states = useMemo(() => new Set(la?.states ?? []), [la]);

  if (actorId === null) return <p className="text-sm text-muted-foreground">캐릭터가 없어요</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>캐릭터</Label>
        <Select value={String(actorId)} onValueChange={(v) => setPicked(Number(v))}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {members.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {la && <p className="text-xs text-muted-foreground">레벨 {la.level} · 경험치 {la.exp} · HP {la.hp} · MP {la.mp}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="cheat-level">레벨</Label>
          <div className="flex gap-2">
            <Input id="cheat-level" inputMode="numeric" placeholder={la ? String(la.level) : "1~99"} value={levelText} disabled={disabled} onChange={(e) => setLevelText(e.target.value)} />
            <Button
              variant="outline" size="sm" disabled={disabled || level === null || level < 1}
              onClick={() => { if (level !== null && level >= 1) { apply([{ op: "level", actorId, level }]); setLevelText(""); } }}
            >
              적용
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="cheat-exp">경험치 +</Label>
          <div className="flex gap-2">
            <Input id="cheat-exp" inputMode="numeric" placeholder="더할 값" value={expText} disabled={disabled} onChange={(e) => setExpText(e.target.value)} />
            <Button
              variant="outline" size="sm" disabled={disabled || exp === null}
              onClick={() => { if (exp !== null) { apply([{ op: "exp", actorId, add: exp }]); setExpText(""); } }}
            >
              더하기
            </Button>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">레벨·경험치는 되돌릴 수 없어요</p>
      <Separator />
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label>능력치</Label>
          <ToggleGroup type="single" variant="outline" size="sm" value={String(step)} onValueChange={(v) => { const n = Number(v); if (n === 1 || n === 10 || n === 100) setStep(n); }}>
            {STEPS.map((s) => <ToggleGroupItem key={s} value={String(s)}>{s}씩</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <Table>
          <TableHeader>
            <TableRow><TableHead>능력치</TableHead><TableHead>{la ? "지금" : "기본값"}</TableHead><TableHead className="text-right">바꾸기</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {PARAM_NAMES.map((name, paramId) => (
              <TableRow key={paramId}>
                <TableCell>{name}</TableCell>
                <TableCell>{params ? params[paramId] : "?"}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon-xs" aria-label={`${name} ${step} 빼기`} disabled={disabled} onClick={() => apply([{ op: "param", actorId, paramId, add: -step }])}><Minus /></Button>
                  <Button variant="ghost" size="icon-xs" aria-label={`${name} ${step} 더하기`} disabled={disabled} onClick={() => apply([{ op: "param", actorId, paramId, add: step }])}><Plus /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!la && <p className="text-xs text-muted-foreground">게임이 연결되면 장비·성장을 포함한 지금 값이 보여요</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => apply([{ op: "recover", actorId }])}><HeartPulse />전부 회복</Button>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => apply([{ op: "recover", actorId: null }])}>파티 전부 회복</Button>
      </div>
      <Separator />
      <OwnedList
        label="기술" list={data.skills} owned={skills} known={la !== null} disabled={disabled} addText="배우기" removeText="잊기"
        onAdd={(skillId) => apply([{ op: "learnSkill", actorId, skillId }])} onRemove={(skillId) => apply([{ op: "forgetSkill", actorId, skillId }])}
      />
      <OwnedList
        label="상태" list={data.states} owned={states} known={la !== null} disabled={disabled} addText="걸기" removeText="풀기"
        onAdd={(stateId) => apply([{ op: "addState", actorId, stateId }])} onRemove={(stateId) => apply([{ op: "removeState", actorId, stateId }])}
      />
    </div>
  );
}
