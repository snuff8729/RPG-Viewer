import { ArrowUpRight } from "lucide-react";
import type { Location, Ref, ScriptNode } from "@/core/types";
import { ScriptLocation } from "./ScriptLocation";
import { useGame } from "@/app/GameProvider";
import { Button } from "@/components/ui/button";
import { openPage } from "@/ui/navigation";
import { firstClickableRef, REF_CHIP } from "@/ui/RefBadge";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BlockNode } from "./BlockNode";
import { MessageNode, ScrollNode } from "./MessageNode";
import { OtherNode } from "./OtherNode";
import { PictureNode } from "./PictureNode";

/**
 * 노드 경로 규칙(검색 색인과 동일): 최상위 [i], 분기 안 [i, 분기, j].
 * basePath는 이 목록의 접두 경로이고 j번째 노드의 경로는 [...basePath, j].
 */
export function ScriptView({ nodes, basePath, onRefClick, pageKey, location }: {
  nodes: ScriptNode[];
  basePath: number[];
  onRefClick?: (ref: Ref) => void;
  /** 최상위 ScriptView에만 준다. 검색 강조가 이 페이지 안에서만 노드를 찾도록 data-page-key로 붙는다. */
  pageKey?: string;
  /** 최상위 ScriptView에만 준다. 하위 노드가 ScriptLocation context로 읽는다. */
  location?: Location;
}) {
  const view = (
    // 띄어쓰기 없는 긴 대사·스크립트도 폭 안에서 줄바꿈한다
    <div className="space-y-2 wrap-anywhere" data-page-key={pageKey}>
      {nodes.map((n, j) => {
        const path = [...basePath, j];
        return (
          <div key={j} data-node-path={path.join(".")}>
            <NodeView node={n} path={path} onRefClick={onRefClick} />
          </div>
        );
      })}
    </div>
  );
  return location ? <ScriptLocation.Provider value={location}>{view}</ScriptLocation.Provider> : view;
}

/** 긴 공통 이벤트·맵 이름 링크가 한 줄로 늘어나지 않게 줄바꿈한다 */
const LINK_WRAP = "h-auto min-w-0 shrink whitespace-normal text-left wrap-anywhere";

function NodeView({ node, path, onRefClick }: { node: ScriptNode; path: number[]; onRefClick?: (ref: Ref) => void }) {
  const { data, index } = useGame();
  switch (node.kind) {
    case "message": return <MessageNode node={node} />;
    case "scroll": return <ScrollNode node={node} />;
    case "choices":
    case "conditional":
    case "loop":
      return (
        <BlockNode
          node={node} path={path} onRefClick={onRefClick}
          renderBody={(nodes, bp) => <ScriptView nodes={nodes} basePath={bp} onRefClick={onRefClick} />}
        />
      );
    case "call":
      // TemplateEvent 호출: 불린 목록의 대본. 본 대사·선택은 그 목록 위치로 찾는다.
      return (
        <div className="rounded-md border">
          <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-1.5 text-sm font-medium">↪ {node.label}</div>
          <div className="px-3 py-2">
            {node.nodes.length === 0
              ? <span className="text-sm text-muted-foreground">(명령 없음)</span>
              : (
                <ScriptLocation.Provider value={node.location}>
                  <ScriptView nodes={node.nodes} basePath={[...path, 0]} onRefClick={onRefClick} />
                </ScriptLocation.Provider>
              )}
          </div>
        </div>
      );
    case "picture": return <PictureNode node={node} />;
    case "other": return <OtherNode node={node} />;
    case "stateChange": {
      const target = onRefClick ? firstClickableRef(node.refs) : undefined;
      return (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          {target ? (
            // 눌리는 참조는 칩 전체가 단추(조건 칩과 같은 모양)
            <Badge asChild variant="outline" className={cn(REF_CHIP, "text-muted-foreground")}>
              <button type="button" title="쓰는 곳 보기" onClick={() => onRefClick!(target)}>
                ⚙ {node.description}
                <ArrowUpRight data-icon="inline-end" aria-hidden />
              </button>
            </Badge>
          ) : <span className="min-w-0">⚙ {node.description}</span>}
        </div>
      );
    }
    case "commonEvent": {
      const name = data?.commonEvents[node.commonEventId]?.name || `#${node.commonEventId}`;
      return (
        <div className="flex flex-wrap items-center text-sm">
          <span>↪ 공통 이벤트</span>
          <Button variant="link" size="sm" className={LINK_WRAP} onClick={() => openPage({ source: "common", commonEventId: node.commonEventId })}>{name}</Button>
          <span>실행</span>
        </div>
      );
    }
    case "transfer": {
      if (node.mapId === null) return <div className="text-sm">🚪 이동 → (변수로 지정된 위치)</div>;
      const mapId = node.mapId;
      const name = data?.mapInfos[mapId]?.name || `#${mapId}`;
      const target = index?.pages.find((p) => p.location.source === "map" && p.location.mapId === mapId);
      return (
        <div className="flex flex-wrap items-center text-sm">
          <span>🚪 이동 →</span>
          <Button variant="link" size="sm" className={LINK_WRAP} disabled={!target} onClick={() => target && openPage(target.location)}>{name}</Button>
          <span>({node.x ?? "?"}, {node.y ?? "?"})</span>
        </div>
      );
    }
  }
}
