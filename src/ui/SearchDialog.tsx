import { useMemo, useState } from "react";
import { useGame } from "@/app/GameProvider";
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
    const m = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const l = m.get(h.entry.path);
      if (l) l.push(h); else m.set(h.entry.path, [h]);
    }
    return [...m.entries()];
  }, [hits]);

  const pick = (h: SearchHit) => {
    onOpenChange(false);
    openPage(h.entry.location);
    highlightNode(h.nodePath);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="검색" description="대사와 선택지를 검색해요">
    <Command shouldFilter={false}>
      <CommandInput placeholder="대사, 선택지 검색..." value={q} onValueChange={setQ} />
      <CommandList>
        {query && <CommandEmpty>결과가 없어요</CommandEmpty>}
        {groups.map(([path, hs]) => (
          <CommandGroup key={path} heading={path}>
            {hs.map((h, i) => (
              <CommandItem key={i} value={`${path}-${i}-${h.text}`} onSelect={() => pick(h)}>
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
