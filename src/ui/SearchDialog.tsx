import { useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { locationKey } from "@/core/index/locations";
import { walk } from "@/core/interpret/interpret";
import type { PageEntry, SearchHit } from "@/core/types";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { highlightNode } from "./highlight";
import { openPage } from "./navigation";

/** 한 번에 찾는 결과 수(넘으면 "N개 넘게"로 알려요) */
const LIMIT = 200;

/**
 * 찾은 글자를 <mark>로 강조. 한 덩어리(span) 안에 이어 붙여야 해요 —
 * CommandItem이 flex라 글 조각이 따로 놓이면 사이에 틈(gap)이 생겨 한글 낱말이 띄어 보여요.
 */
function Marked({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <span className="min-w-0 wrap-anywhere">{text}</span>;
  return (
    <span className="min-w-0 wrap-anywhere">
      {text.slice(0, i)}<mark className="rounded-sm bg-primary/15 px-0 font-semibold text-foreground">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}
    </span>
  );
}

/** 결과가 든 대사의 화자 이름(대사가 아니거나 없으면 null) */
function speakerOf(entry: PageEntry, nodePath: number[]): string | null {
  const want = nodePath.join(".");
  let found: string | null = null;
  walk(entry.nodes, [], (n, path) => {
    if (found === null && n.kind === "message" && n.speaker && path.join(".") === want) found = n.speaker;
  });
  return found;
}

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { index } = useGame();
  const [q, setQ] = useState("");
  const query = q.trim();
  const hits = useMemo<SearchHit[]>(() => (index && query ? index.search(query, LIMIT) : []), [index, query]);
  const groups = useMemo(() => {
    // 같은 이름의 이벤트가 한 맵에 있어도 섞이지 않도록 위치 키로 묶는다. 제목은 path.
    const m = new Map<string, { path: string; hits: { hit: SearchHit; speaker: string | null }[] }>();
    for (const h of hits) {
      const key = locationKey(h.entry.location);
      const item = { hit: h, speaker: speakerOf(h.entry, h.nodePath) };
      const g = m.get(key);
      if (g) g.hits.push(item); else m.set(key, { path: h.entry.path, hits: [item] });
    }
    return [...m.entries()];
  }, [hits]);

  const pick = (h: SearchHit) => {
    onOpenChange(false);
    openPage(h.entry.location);
    highlightNode(locationKey(h.entry.location), h.nodePath);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="검색" description="대사, 선택지, 화자 이름을 검색해요">
    <Command shouldFilter={false}>
      <CommandInput placeholder="대사, 선택지, 화자 이름 검색..." value={q} onValueChange={setQ} />
      {query && hits.length > 0 && (
        <p className="border-b px-3 py-1.5 text-xs text-muted-foreground" aria-live="polite">
          {hits.length >= LIMIT ? `${LIMIT}개 넘게 찾았어요 — 더 길게 적으면 좁혀져요` : `${hits.length}개 찾았어요`}
        </p>
      )}
      <CommandList>
        {query && <CommandEmpty>결과가 없어요</CommandEmpty>}
        {groups.map(([key, { path, hits: hs }]) => (
          <CommandGroup key={key} heading={path}>
            {hs.map(({ hit: h, speaker }, i) => (
              <CommandItem key={i} value={`${key}-${i}-${h.text}`} onSelect={() => pick(h)} className="items-start">
                <span className="flex min-w-0 flex-col">
                  {speaker && <span className="text-xs text-muted-foreground">{speaker === h.text ? "화자 이름" : speaker}</span>}
                  <Marked text={h.text} q={query} />
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
    </CommandDialog>
  );
}
