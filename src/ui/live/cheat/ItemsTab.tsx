import { useMemo, useState } from "react";
import { Coins, Search } from "lucide-react";
import { fillAllOps, ITEM_TYPE_LABEL, liveCount, searchItems, type ItemHit, type ItemType } from "@/core/live/cheat";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LIST_LIMIT, parseIntInput, type CheatTabProps } from "./shared";

const TYPES: readonly ItemType[] = ["item", "weapon", "armor"];

/**
 * 한 항목: 지금 개수, +1/+10/+99/−1, 정확한 개수 입력.
 * 칸이 좁으면(이름 몫 12rem이 안 남으면) 이름이 첫 줄을 다 쓰고 버튼들은 둘째 줄로 내려간다(Item은 flex-wrap).
 */
function ItemRow({ hit, count, disabled, apply }: { hit: ItemHit; count: number } & Pick<CheatTabProps, "disabled" | "apply">) {
  const { type, entry } = hit;
  const [text, setText] = useState("");
  const exact = parseIntInput(text);
  const gain = (amount: number) => apply([{ op: "gainItem", type, id: entry.id, amount }]);
  return (
    <Item variant="outline" size="xs">
      <ItemContent className="min-w-48">
        <ItemTitle className="flex-wrap gap-x-2 gap-y-0.5">
          {entry.name || `#${entry.id}`}
          <Badge variant="secondary">{ITEM_TYPE_LABEL[type]}</Badge>
          <span className="text-muted-foreground">보유 {count}</span>
        </ItemTitle>
        {entry.description && <ItemDescription className="line-clamp-1">{entry.description}</ItemDescription>}
      </ItemContent>
      <ItemActions className="flex-wrap">
        <Button variant="outline" size="xs" disabled={disabled} onClick={() => gain(1)}>+1</Button>
        <Button variant="outline" size="xs" disabled={disabled} onClick={() => gain(10)}>+10</Button>
        <Button variant="outline" size="xs" disabled={disabled} onClick={() => gain(99)}>+99</Button>
        <Button variant="outline" size="xs" disabled={disabled || count === 0} onClick={() => gain(-1)}>−1</Button>
        <Input
          className="h-6 w-16 text-xs" inputMode="numeric" placeholder="개수" value={text} disabled={disabled}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          size="xs" disabled={disabled || exact === null || exact < 0}
          onClick={() => { if (exact !== null && exact >= 0) { apply([{ op: "setItem", type, id: entry.id, count: exact }]); setText(""); } }}
        >
          적용
        </Button>
      </ItemActions>
    </Item>
  );
}

/** 돈: 지금 금액, 맞추기·더하기 */
function GoldRow({ data, live, disabled, apply }: CheatTabProps) {
  const [text, setText] = useState("");
  const n = parseIntInput(text);
  const unit = data.system.currencyUnit || "G";
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="cheat-gold">돈 <span className="font-normal text-muted-foreground">지금 {live ? `${live.gold} ${unit}` : "?"}</span></Label>
      <div className="flex flex-wrap gap-2">
        <InputGroup className="min-w-40 flex-1">
          <InputGroupAddon><Coins /></InputGroupAddon>
          <InputGroupInput id="cheat-gold" inputMode="numeric" placeholder="금액" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
        </InputGroup>
        <Button
          variant="outline" size="sm" disabled={disabled || n === null || n < 0}
          onClick={() => { if (n !== null && n >= 0) { apply([{ op: "gold", set: n }]); setText(""); } }}
        >
          이 금액으로
        </Button>
        <Button
          variant="outline" size="sm" disabled={disabled || n === null}
          onClick={() => { if (n !== null) { apply([{ op: "gold", add: n }]); setText(""); } }}
        >
          더하기
        </Button>
      </div>
    </div>
  );
}

/** `아이템` 탭: 찾기·개수 바꾸기·전부 99개·돈 */
export function ItemsTab(props: CheatTabProps) {
  const { data, live, disabled, apply } = props;
  const [query, setQuery] = useState("");
  const [type, setType] = useState<ItemType | "all">("all");
  const hits = useMemo(() => searchItems(data, type, query, LIST_LIMIT + 1), [data, type, query]);
  const shown = hits.slice(0, LIST_LIMIT);

  return (
    <div className="flex flex-col gap-4">
      <GoldRow {...props} />
      <Separator />
      <div className="flex flex-col gap-2">
        <Label>한 번에 채우기</Label>
        <div className="flex flex-wrap gap-2">
          {TYPES.map((t) => {
            const ops = fillAllOps(data, t);
            return (
              <AlertDialog key={t}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={disabled || ops.length === 0}>모든 {ITEM_TYPE_LABEL[t]} 99개</Button>
                </AlertDialogTrigger>
                <AlertDialogContent size="sm">
                  <AlertDialogHeader>
                    <AlertDialogTitle>모든 {ITEM_TYPE_LABEL[t]} 99개</AlertDialogTitle>
                    <AlertDialogDescription>
                      {ITEM_TYPE_LABEL[t]} {ops.length}종류를 모두 99개로 맞춰요. 이야기용 아이템까지 들어와서 진행이 꼬일 수 있어요. 할까요?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction onClick={() => apply(ops, `모든 ${ITEM_TYPE_LABEL[t]} 99개`)}>채우기</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            );
          })}
        </div>
      </div>
      <Separator />
      <div className="flex flex-col gap-2">
        <InputGroup>
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput placeholder="이름·설명·번호로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
        </InputGroup>
        <ToggleGroup type="single" variant="outline" size="sm" value={type} onValueChange={(v) => { if (v) setType(v as ItemType | "all"); }}>
          <ToggleGroupItem value="all">전체</ToggleGroupItem>
          {TYPES.map((t) => <ToggleGroupItem key={t} value={t}>{ITEM_TYPE_LABEL[t]}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      <ItemGroup className="gap-2">
        {shown.map((h) => (
          <ItemRow key={`${h.type}:${h.entry.id}`} hit={h} count={liveCount(live, h.type, h.entry.id)} disabled={disabled} apply={apply} />
        ))}
      </ItemGroup>
      {shown.length === 0 && <p className="text-sm text-muted-foreground">찾는 항목이 없어요</p>}
      {hits.length > LIST_LIMIT && <p className="text-xs text-muted-foreground">더 있어요. 검색어로 좁혀 주세요</p>}
    </div>
  );
}
