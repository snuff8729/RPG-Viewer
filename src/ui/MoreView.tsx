import { ChevronRight, FolderSearch, Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemGroup, ItemTitle, ItemMedia, ItemActions } from "@/components/ui/item";
import { SectionHeader } from "./SectionHeader";
import { terms } from "./terms";
import { Badge } from "@/components/ui/badge";
import { useManageAttention } from "./useManageAttention";
export function MoreView({ onSearch }: { onSearch: () => void }) {
  const attention = useManageAttention();
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 p-4">
      <SectionHeader title={terms.more} description="이벤트를 찾아보거나 게임과 화면을 관리해요." />
      <ItemGroup className="gap-2">
        {(
          [
            ["#/browse/events", terms.browse, FolderSearch],
            [attention.href, terms.manage, Settings],
          ] as const
        ).map(([href, label, Icon]) => (
          <Item key={label} variant="outline" asChild>
            <a href={href}>
              <ItemMedia>
                <Icon className="size-5" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {label}
                  {Icon === Settings && attention.count > 0 && (
                    <Badge variant={attention.variant}>{attention.count}</Badge>
                  )}
                </ItemTitle>
              </ItemContent>
              <ItemActions>
                <ChevronRight className="size-4" />
              </ItemActions>
            </a>
          </Item>
        ))}
        <Button variant="outline" className="justify-start" onClick={onSearch}>
          <Search />
          검색
        </Button>
      </ItemGroup>
    </div>
  );
}
