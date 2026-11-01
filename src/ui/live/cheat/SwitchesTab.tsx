import { useEffect, useMemo, useState, type ReactNode } from "react";
import { terms } from "@/ui/terms";
import { Pencil, Search, Star } from "lucide-react";
import { systemEntries, type SearchEntry } from "@/core/live/cheat";
import { favoriteEntries, findFavorite, NICKNAME_MAX, searchWithNicknames, type FavoriteKind } from "@/core/live/favorites";
import {
  agoText, applyNarrow, findVariablesByValue, liveVariable, recentChanges, startNarrow, type NarrowFilter,
} from "@/core/live/varFinder";
import type { LiveSnapshot } from "@/core/live/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LIST_LIMIT, parseIntInput, type CheatTabProps } from "./shared";
import type { FinderMode, VariableFinder } from "./useVariableFinder";

type RowProps = Pick<CheatTabProps, "disabled" | "apply"> & { live: LiveSnapshot | null; finder: VariableFinder };
type Names = readonly unknown[] | undefined;

const nicknameOf = (finder: VariableFinder, kind: FavoriteKind, id: number) => findFavorite(finder.favorites, kind, id)?.nickname ?? "";

/** 즐겨찾기 별(누르면 넣고 빼기) */
function StarButton({ finder, kind, id }: { finder: VariableFinder; kind: FavoriteKind; id: number }) {
  const on = findFavorite(finder.favorites, kind, id) !== undefined;
  return (
    <Button
      variant="ghost" size="icon-xs" aria-label={on ? "즐겨찾기에서 빼기" : "즐겨찾기"} aria-pressed={on}
      onClick={() => finder.toggleFavorite(kind, id)}
    >
      <Star className={on ? "fill-current" : undefined} />
    </Button>
  );
}

/** 별명 붙이기(게임 속 이름이 원래 말이라 알아보기 어려울 때) */
function NicknameButton({ finder, kind, entry }: { finder: VariableFinder; kind: FavoriteKind; entry: SearchEntry }) {
  const current = nicknameOf(finder, kind, entry.id);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(current);
  const save = () => { finder.renameFavorite(kind, entry.id, text); setOpen(false); };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setText(current); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="별명 붙이기"><Pencil /></Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <PopoverHeader>
          <PopoverTitle>별명</PopoverTitle>
          <PopoverDescription>{entry.id}. {entry.name || "(이름 없음)"} · 비우면 원래 이름이 보여요</PopoverDescription>
        </PopoverHeader>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Input autoFocus className="h-7" placeholder="예: 공격력" maxLength={NICKNAME_MAX} value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" size="sm">저장</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** 줄 제목: 별명이 있으면 별명, 아니면 원래 이름 */
function RowTitle({ finder, kind, entry, editable, children }: {
  finder: VariableFinder; kind: FavoriteKind; entry: SearchEntry; editable?: boolean; children?: ReactNode;
}) {
  const nick = nicknameOf(finder, kind, entry.id);
  return (
    <ItemTitle className="max-w-full gap-1">
      <span className="truncate">{entry.id}. {nick || entry.name || "(이름 없음)"}</span>
      {editable && <NicknameButton finder={finder} kind={kind} entry={entry} />}
      {children}
    </ItemTitle>
  );
}

/** 변수 한 줄: 별, 지금 값(또는 note), 숫자·글자 입력. 별명이 있으면 설명 앞에 원래 이름. */
function VariableRow({ entry, live, disabled, apply, finder, note, badge, editable }: RowProps & {
  entry: SearchEntry; note?: string; badge?: ReactNode; editable?: boolean;
}) {
  const [text, setText] = useState("");
  const current = live ? liveVariable(live, entry.id) : null;
  const n = parseIntInput(text);
  const desc = note ?? `지금 ${current === null ? terms.notLiveValue : current}`;
  const nick = nicknameOf(finder, "variable", entry.id);
  return (
    <Item variant="outline" size="xs">
      <StarButton finder={finder} kind="variable" id={entry.id} />
      {/* 좁으면 이름 몫(10rem)을 남기고 입력·적용은 다음 줄로 */}
      <ItemContent className="min-w-40">
        <RowTitle finder={finder} kind="variable" entry={entry} editable={editable}>{badge}</RowTitle>
        <ItemDescription className="truncate">{nick ? `${entry.name || "(이름 없음)"} · ${desc}` : desc}</ItemDescription>
      </ItemContent>
      <ItemActions className="ml-auto">
        <Input className="h-6 w-20 text-xs" placeholder="새 값" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
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

/** 스위치 한 줄: 별, 켜기·끄기 */
function SwitchRow({ entry, live, disabled, apply, finder, on, editable }: RowProps & { entry: SearchEntry; on: boolean; editable?: boolean }) {
  const nick = nicknameOf(finder, "switch", entry.id);
  return (
    <Item variant="outline" size="xs" className="flex-nowrap">
      <StarButton finder={finder} kind="switch" id={entry.id} />
      <ItemContent className="min-w-0">
        <RowTitle finder={finder} kind="switch" entry={entry} editable={editable} />
        {nick && <ItemDescription className="truncate">{entry.name || "(이름 없음)"}</ItemDescription>}
      </ItemContent>
      <ItemActions>
        <Switch
          aria-label={`스위치 ${entry.id}`} disabled={disabled || !live} checked={on}
          onCheckedChange={(c) => apply([{ op: "switch", id: entry.id, value: c }])}
        />
      </ItemActions>
    </Item>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <p className="text-xs text-muted-foreground">{children}</p>;

/** 즐겨찾기: 별 누른 것만, 넣은 순서대로. 연필로 별명을 붙인다. */
function FavoritesList({ kind, names, on, ...rp }: RowProps & { kind: FavoriteKind; names: Names; on: ReadonlySet<number> }) {
  const list = favoriteEntries(rp.finder.favorites, kind, names);
  if (list.length === 0) {
    return <Hint>아직 없어요. 다른 보기에서 ☆를 누르면 여기에 모여요. 다음에 열 때도 남아 있어요</Hint>;
  }
  return (
    <div className="flex flex-col gap-2">
      <Hint>연필을 누르면 알아보기 쉬운 별명(예: 공격력)을 붙일 수 있어요</Hint>
      <ItemGroup className="gap-1">
        {list.map((e) => kind === "switch"
          ? <SwitchRow key={e.id} entry={e} on={on.has(e.id)} editable {...rp} />
          : <VariableRow key={e.id} entry={e} editable {...rp} />)}
      </ItemGroup>
    </div>
  );
}

/** 값으로 찾기: 지금 값이 그 숫자인 변수 */
function ValueSearch({ names, ...rp }: RowProps & { names: Names }) {
  const { live } = rp;
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
                      {hits.slice(0, LIST_LIMIT).map((e) => <VariableRow key={e.id} entry={e} {...rp} />)}
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
function NarrowSearch({ names, ...rp }: RowProps & { names: Names }) {
  const { live, finder } = rp;
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
      <Hint>게임에서 숫자를 바꾼 뒤 어떻게 바뀌었는지 고르세요. 찾았으면 ☆를 눌러 두세요</Hint>
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
              return <VariableRow key={c.id} entry={e} note={`기억 ${c.prev} → 지금 ${now === null ? terms.notLiveValue : now}`} {...rp} />;
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
function RecentChanges({ names, ...rp }: RowProps & { names: Names }) {
  const { live, finder } = rp;
  const tick = useNow();
  // 마지막 변화가 시계보다 늦게 왔으면 그 시각을 쓴다(음수 "몇 초 전" 방지)
  const lastAt = [...finder.tracker.changes.values()].at(-1)?.at ?? 0;
  const now = Math.max(tick, lastAt);
  const [showFrequent, setShowFrequent] = useState(false);
  const entries = useMemo(() => systemEntries(names), [names]);
  const { normal, frequent } = recentChanges(finder.tracker, now);
  const row = (c: (typeof normal)[number], often: boolean) => (
    <VariableRow
      key={c.id} entry={entries[c.id - 1] ?? { id: c.id, name: "" }} {...rp}
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

const MODES: { value: FinderMode; label: string; switches?: boolean }[] = [
  { value: "favorites", label: "즐겨찾기", switches: true }, { value: "name", label: "이름·번호", switches: true },
  { value: "value", label: "값" }, { value: "narrow", label: "좁혀 찾기" }, { value: "recent", label: "최근 바뀜" },
];

/**
 * `스위치·변수` 탭(고급): 즐겨찾기·이름·번호(변수는 값·좁혀 찾기·최근 바뀜도)로 찾아 켜고 끄거나 값을 바꾼다.
 * 즐겨찾기가 있으면 즐겨찾기를 먼저 보여 준다.
 */
export function SwitchesTab({ data, live, disabled, apply, finder, fixedKind = false }: CheatTabProps & {
  finder: VariableFinder;
  /** 바깥 탭(변수 · 스위치)이 종류를 정하면 true: 안쪽 변수·스위치 고르기를 숨겨요 */
  fixedKind?: boolean;
}) {
  const { kind, setKind, mode } = finder;
  const [query, setQuery] = useState("");
  const names = kind === "switch" ? data.system.switches : data.system.variables;
  const hits = useMemo(() => searchWithNicknames(names, finder.favorites, kind, query, LIST_LIMIT + 1), [names, finder.favorites, kind, query]);
  const on = useMemo(() => new Set(Array.isArray(live?.switches) ? live.switches : []), [live]);
  const shown = hits.slice(0, LIST_LIMIT);
  const rowProps = { live, disabled, apply, finder };
  const favCount = finder.favorites[kind].length;
  const modes = kind === "switch" ? MODES.filter((m) => m.switches) : MODES;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {!fixedKind && (
        <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={(v) => { if (v === "switch" || v === "variable") setKind(v); }}>
          <ToggleGroupItem value="variable">변수</ToggleGroupItem>
          <ToggleGroupItem value="switch">스위치</ToggleGroupItem>
        </ToggleGroup>
        )}
        <Tabs value={mode} onValueChange={(v) => finder.setMode(v as FinderMode)}>
          <TabsList className="w-full">
            {modes.map((m) => (
              <TabsTrigger key={m.value} value={m.value} className="px-1 text-xs sm:text-sm" aria-label={m.value === "favorites" ? "즐겨찾기" : undefined}>
                {m.value === "favorites" ? <><Star />{favCount > 0 && favCount}</> : m.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {mode === "name" && (
          <InputGroup>
            <InputGroupAddon><Search /></InputGroupAddon>
            <InputGroupInput placeholder="이름·번호·별명으로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
          </InputGroup>
        )}
      </div>
      {mode === "favorites" && <FavoritesList kind={kind} names={names} on={on} {...rowProps} />}
      {mode === "value" && <ValueSearch names={names} {...rowProps} />}
      {mode === "narrow" && <NarrowSearch names={names} {...rowProps} />}
      {mode === "recent" && <RecentChanges names={names} {...rowProps} />}
      {mode === "name" && (
        <>
          <ItemGroup className="gap-1">
            {shown.map((e) => kind === "switch"
              ? <SwitchRow key={e.id} entry={e} on={on.has(e.id)} {...rowProps} />
              : <VariableRow key={e.id} entry={e} {...rowProps} />)}
          </ItemGroup>
          {shown.length === 0 && <p className="text-sm text-muted-foreground">찾는 항목이 없어요</p>}
          {hits.length > LIST_LIMIT && <p className="text-xs text-muted-foreground">더 있어요. 검색어로 좁혀 주세요</p>}
        </>
      )}
    </div>
  );
}
