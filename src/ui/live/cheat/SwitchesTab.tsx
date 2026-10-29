import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { searchSystem, systemEntries, type SearchEntry } from "@/core/live/cheat";
import {
  agoText, applyNarrow, findVariablesByValue, liveVariable, recentChanges, startNarrow, type NarrowFilter,
} from "@/core/live/varFinder";
import type { LiveSnapshot } from "@/core/live/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LIST_LIMIT, parseIntInput, type CheatTabProps } from "./shared";
import type { FinderMode, VariableFinder } from "./useVariableFinder";

type RowProps = Pick<CheatTabProps, "disabled" | "apply"> & { live: LiveSnapshot | null };

/** 변수 한 줄: 지금 값(또는 note), 숫자·글자 입력 */
function VariableRow({ entry, live, disabled, apply, note, badge }: RowProps & { entry: SearchEntry; note?: ReactNode; badge?: ReactNode }) {
  const [text, setText] = useState("");
  const current = live ? liveVariable(live, entry.id) : null;
  const n = parseIntInput(text);
  return (
    <Item variant="outline" size="xs">
      <ItemContent>
        <ItemTitle>{entry.id}. {entry.name || "(이름 없음)"}{badge}</ItemTitle>
        <ItemDescription>{note ?? `지금 ${current === null ? "?" : current}`}</ItemDescription>
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

const Hint = ({ children }: { children: ReactNode }) => <p className="text-xs text-muted-foreground">{children}</p>;

/** 값으로 찾기: 지금 값이 그 숫자인 변수 */
function ValueSearch({ names, live, disabled, apply }: RowProps & { names: readonly unknown[] | undefined }) {
  const [text, setText] = useState("");
  const value = parseIntInput(text);
  const hits = useMemo(() => (value === null ? [] : findVariablesByValue(names, live, value, LIST_LIMIT + 1)), [names, live, value]);
  return (
    <div className="flex flex-col gap-2">
      <InputGroup>
        <InputGroupAddon><Search /></InputGroupAddon>
        <InputGroupInput inputMode="numeric" placeholder="게임 화면에 보이는 숫자 (예: 35)" value={text} onChange={(e) => setText(e.target.value)} />
      </InputGroup>
      {!live ? <Hint>게임이 연결되어 있어야 값을 볼 수 있어요</Hint>
        : text.trim() === "" ? <Hint>게임 화면의 숫자(레벨, 호감도 등)를 넣으면 지금 그 값을 가진 변수를 보여 줘요</Hint>
          : value === null ? <Hint>숫자만 넣어 주세요</Hint>
            : value === 0 ? <Hint>0인 변수는 너무 많아요. 0이 아닐 때 찾거나 &apos;좁혀 찾기&apos;를 써 보세요</Hint>
              : hits.length === 0 ? <Hint>지금 이 값인 변수가 없어요. 화면 숫자가 변수에 들어 있지 않을 수도 있어요</Hint>
                : (
                  <>
                    {hits.length > 1 && <Hint>여러 개면 게임에서 숫자를 바꾼 뒤 &apos;좁혀 찾기&apos;로 골라내세요</Hint>}
                    <ItemGroup className="gap-1">
                      {hits.slice(0, LIST_LIMIT).map((e) => <VariableRow key={e.id} entry={e} live={live} disabled={disabled} apply={apply} />)}
                    </ItemGroup>
                    {hits.length > LIST_LIMIT && <Hint>더 있어요. &apos;좁혀 찾기&apos;로 줄여 보세요</Hint>}
                  </>
                )}
    </div>
  );
}

const FILTERS: { kind: "changed" | "increased" | "decreased" | "unchanged"; label: string }[] = [
  { kind: "changed", label: "바뀐 것" }, { kind: "increased", label: "늘어난 것" },
  { kind: "decreased", label: "줄어든 것" }, { kind: "unchanged", label: "그대로인 것" },
];

/** 좁혀 찾기: 값을 기억해 두고, 게임에서 바꾼 뒤 어떻게 바뀌었는지로 후보를 줄인다 */
function NarrowSearch({ names, live, disabled, apply, finder }: RowProps & { names: readonly unknown[] | undefined; finder: VariableFinder }) {
  const { narrow, setNarrow } = finder;
  const [text, setText] = useState("");
  const value = parseIntInput(text);
  const entries = useMemo(() => systemEntries(names), [names]);
  const filter = (f: NarrowFilter) => { if (narrow) setNarrow(applyNarrow(narrow, live, f)); };

  if (!narrow) {
    return (
      <div className="flex flex-col gap-2">
        <Hint>
          1. 지금 값을 기억해 두고 2. 게임에서 찾는 숫자를 바꾼 뒤(레벨 업, 물건 사기, 맞기 등) 3. 어떻게 바뀌었는지 고르면 후보가 줄어요.
          몇 번 되풀이하면 몇 개만 남아요.
        </Hint>
        <Button size="sm" disabled={!live} onClick={() => setNarrow(startNarrow(names, live))}>지금 값 기억하기</Button>
        {!live && <Hint>게임이 연결되어 있어야 해요</Hint>}
      </div>
    );
  }
  const shown = narrow.candidates.slice(0, LIST_LIMIT);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm">
          후보 <span className="font-medium">{narrow.candidates.length}</span>개
          {narrow.steps > 0 && <span className="text-muted-foreground"> · {narrow.steps}번 좁힘</span>}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setNarrow(null)}>처음부터</Button>
      </div>
      <Hint>게임에서 숫자를 바꾼 뒤 어떻게 바뀌었는지 고르세요</Hint>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {FILTERS.map((f) => (
          <Button key={f.kind} variant="outline" size="sm" disabled={!live || narrow.candidates.length === 0} onClick={() => filter({ kind: f.kind })}>
            {f.label}
          </Button>
        ))}
      </div>
      <InputGroup>
        <InputGroupInput inputMode="numeric" placeholder="지금 값 (예: 12)" value={text} onChange={(e) => setText(e.target.value)} />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            variant="secondary" disabled={!live || value === null || narrow.candidates.length === 0}
            onClick={() => { if (value !== null) { filter({ kind: "equals", value }); setText(""); } }}
          >
            값이 이것인 것
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {narrow.candidates.length === 0 ? <Hint>남은 후보가 없어요. &apos;처음부터&apos; 다시 해 보세요</Hint> : (
        <>
          <ItemGroup className="gap-1">
            {shown.map((c) => {
              const e = entries[c.id - 1] ?? { id: c.id, name: "" };
              const now = live ? liveVariable(live, c.id) : null;
              return (
                <VariableRow
                  key={c.id} entry={e} live={live} disabled={disabled} apply={apply}
                  note={`기억 ${c.prev} → 지금 ${now === null ? "?" : now}`}
                />
              );
            })}
          </ItemGroup>
          {narrow.candidates.length > LIST_LIMIT && <Hint>앞의 {LIST_LIMIT}개만 보여요. 더 좁혀 주세요</Hint>}
        </>
      )}
    </div>
  );
}

/** 지금 시각(몇 초 전 표시용, 5초마다) */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** 최근 바뀐 변수: 게임에서 무언가 하고 바로 보면 어느 변수가 움직였는지 보인다 */
function RecentChanges({ names, live, disabled, apply, finder }: RowProps & { names: readonly unknown[] | undefined; finder: VariableFinder }) {
  const tick = useNow();
  // 마지막 변화가 시계보다 늦게 왔으면 그 시각을 쓴다(음수 "몇 초 전" 방지)
  const lastAt = [...finder.tracker.changes.values()].at(-1)?.at ?? 0;
  const now = Math.max(tick, lastAt);
  const [showFrequent, setShowFrequent] = useState(false);
  const entries = useMemo(() => systemEntries(names), [names]);
  const { normal, frequent } = recentChanges(finder.tracker, now);
  const row = (c: (typeof normal)[number], often: boolean) => (
    <VariableRow
      key={c.id} entry={entries[c.id - 1] ?? { id: c.id, name: "" }} live={live} disabled={disabled} apply={apply}
      note={`${c.from} → ${c.to} · ${agoText(c.at, now)}`}
      badge={often ? <Badge variant="outline" className="ml-1">자주 바뀜</Badge> : undefined}
    />
  );
  return (
    <div className="flex flex-col gap-2">
      <Hint>게임에서 무언가 한 뒤 여기를 보면 방금 바뀐 변수가 위에 보여요(연결된 동안 계속 봐요)</Hint>
      {normal.length === 0 ? <Hint>{live ? "아직 바뀐 변수가 없어요" : "게임이 연결되어 있어야 해요"}</Hint>
        : <ItemGroup className="gap-1">{normal.map((c) => row(c, false))}</ItemGroup>}
      {frequent.length > 0 && (
        <>
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowFrequent((v) => !v)}>
            자주 바뀌는 변수 {frequent.length}개 {showFrequent ? "숨기기" : "보기"}
          </Button>
          {showFrequent && <ItemGroup className="gap-1">{frequent.map((c) => row(c, true))}</ItemGroup>}
        </>
      )}
    </div>
  );
}

const MODES: { value: FinderMode; label: string }[] = [
  { value: "name", label: "이름·번호" }, { value: "value", label: "값" },
  { value: "narrow", label: "좁혀 찾기" }, { value: "recent", label: "최근 바뀜" },
];

/** `스위치·변수` 탭(고급): 이름·번호(변수는 값·좁혀 찾기·최근 바뀜도)로 찾아 켜고 끄거나 값을 바꾼다 */
export function SwitchesTab({ data, live, disabled, apply, finder }: CheatTabProps & { finder: VariableFinder }) {
  const { kind, setKind } = finder;
  const mode: FinderMode = kind === "variable" ? finder.mode : "name";
  const [query, setQuery] = useState("");
  const names = kind === "switch" ? data.system.switches : data.system.variables;
  const hits = useMemo(() => searchSystem(names, query, LIST_LIMIT + 1), [names, query]);
  const on = useMemo(() => new Set(Array.isArray(live?.switches) ? live.switches : []), [live]);
  const shown = hits.slice(0, LIST_LIMIT);
  const rowProps = { live, disabled, apply };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={(v) => { if (v === "switch" || v === "variable") setKind(v); }}>
          <ToggleGroupItem value="switch">스위치</ToggleGroupItem>
          <ToggleGroupItem value="variable">변수</ToggleGroupItem>
        </ToggleGroup>
        {kind === "variable" && (
          <Tabs value={mode} onValueChange={(v) => finder.setMode(v as FinderMode)}>
            <TabsList className="w-full">
              {MODES.map((m) => <TabsTrigger key={m.value} value={m.value} className="px-1 text-xs sm:text-sm">{m.label}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        )}
        {mode === "name" && (
          <InputGroup>
            <InputGroupAddon><Search /></InputGroupAddon>
            <InputGroupInput placeholder="이름·번호로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
          </InputGroup>
        )}
      </div>
      {mode === "value" && <ValueSearch names={names} {...rowProps} />}
      {mode === "narrow" && <NarrowSearch names={names} finder={finder} {...rowProps} />}
      {mode === "recent" && <RecentChanges names={names} finder={finder} {...rowProps} />}
      {mode === "name" && (
        <>
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
              <VariableRow key={e.id} entry={e} {...rowProps} />
            ))}
          </ItemGroup>
          {shown.length === 0 && <p className="text-sm text-muted-foreground">찾는 항목이 없어요</p>}
          {hits.length > LIST_LIMIT && <p className="text-xs text-muted-foreground">더 있어요. 검색어로 좁혀 주세요</p>}
        </>
      )}
    </div>
  );
}
