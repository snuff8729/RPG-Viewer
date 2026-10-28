import { useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
import { locationKey } from "@/core/index/locations";
import type { SearchHit } from "@/core/types";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { highlightNode } from "./highlight";
import { openPage } from "./navigation";

function Marked({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<span className="font-semibold">{text.slice(i, i + q.length)}</span>{text.slice(i + q.length)}</>;
}

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { index } = useGame();
  const [q, setQ] = useState("");
  const query = q.trim();
  const hits = useMemo<SearchHit[]>(() => (index && query ? index.search(query, 200) : []), [index, query]);
  const groups = useMemo(() => {
    // 같은 이름의 이벤트가 한 맵에 있어도 섞이지 않도록 위치 키로 묶는다. 제목은 path.
    const m = new Map<string, { path: string; hits: SearchHit[] }>();
    for (const h of hits) {
      const key = locationKey(h.entry.location);
      const g = m.get(key);
      if (g) g.hits.push(h); else m.set(key, { path: h.entry.path, hits: [h] });
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
      <CommandList>
        {query && <CommandEmpty>결과가 없어요</CommandEmpty>}
        {groups.map(([key, { path, hits: hs }]) => (
          <CommandGroup key={key} heading={path}>
            {hs.map((h, i) => (
              <CommandItem key={i} value={`${key}-${i}-${h.text}`} onSelect={() => pick(h)}>
                <Marked text={h.text} q={query} />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
    </CommandDialog>
  );
}
