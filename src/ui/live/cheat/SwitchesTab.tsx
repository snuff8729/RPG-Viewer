import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { searchSystem, type SearchEntry } from "@/core/live/cheat";
import type { LiveSnapshot } from "@/core/live/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LIST_LIMIT, parseIntInput, type CheatTabProps } from "./shared";

/** 변수 한 줄: 지금 값, 숫자·글자 입력 */
function VariableRow({ entry, live, disabled, apply }: { entry: SearchEntry; live: LiveSnapshot | null } & Pick<CheatTabProps, "disabled" | "apply">) {
  const [text, setText] = useState("");
  const raw = live?.variables?.[String(entry.id)];
  const current = live ? (typeof raw === "number" ? raw : 0) : null;
  const n = parseIntInput(text);
  return (
    <Item variant="outline" size="xs">
      <ItemContent>
        <ItemTitle>{entry.id}. {entry.name || "(이름 없음)"}</ItemTitle>
        <ItemDescription>지금 {current === null ? "?" : current}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Input className="h-6 w-24 text-xs" placeholder="새 값" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
        <Button
          size="xs" disabled={disabled || text === "" || text.length > 1000}
          onClick={() => { apply([{ op: "variable", id: entry.id, value: n ?? text }]); setText(""); }}
        >
          적용
        </Button>
      </ItemActions>
    </Item>
  );
}

/** `스위치·변수` 탭(고급): 이름·번호로 찾아 켜고 끄거나 값을 바꾼다 */
export function SwitchesTab({ data, live, disabled, apply }: CheatTabProps) {
  const [kind, setKind] = useState<"switch" | "variable">("switch");
  const [query, setQuery] = useState("");
  const names = kind === "switch" ? data.system.switches : data.system.variables;
  const hits = useMemo(() => searchSystem(names, query, LIST_LIMIT + 1), [names, query]);
  const on = useMemo(() => new Set(Array.isArray(live?.switches) ? live.switches : []), [live]);
  const shown = hits.slice(0, LIST_LIMIT);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={(v) => { if (v === "switch" || v === "variable") setKind(v); }}>
          <ToggleGroupItem value="switch">스위치</ToggleGroupItem>
          <ToggleGroupItem value="variable">변수</ToggleGroupItem>
        </ToggleGroup>
        <InputGroup>
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput placeholder="이름·번호로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
        </InputGroup>
      </div>
      <ItemGroup className="gap-1">
        {shown.map((e) => kind === "switch" ? (
          <Item key={e.id} variant="outline" size="xs">
            <ItemContent><ItemTitle>{e.id}. {e.name || "(이름 없음)"}</ItemTitle></ItemContent>
            <ItemActions>
              <Switch
                aria-label={`스위치 ${e.id}`} disabled={disabled || !live} checked={on.has(e.id)}
                onCheckedChange={(c) => apply([{ op: "switch", id: e.id, value: c }])}
              />
            </ItemActions>
          </Item>
        ) : (
          <VariableRow key={e.id} entry={e} live={live} disabled={disabled} apply={apply} />
        ))}
      </ItemGroup>
      {shown.length === 0 && <p className="text-sm text-muted-foreground">찾는 항목이 없어요</p>}
      {hits.length > LIST_LIMIT && <p className="text-xs text-muted-foreground">더 있어요. 검색어로 좁혀 주세요</p>}
    </div>
  );
}
