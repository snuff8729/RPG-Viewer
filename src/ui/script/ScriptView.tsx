import { ExternalLink } from "lucide-react";
import type { Ref, ScriptNode } from "@/core/types";
import { useGame } from "@/app/GameProvider";
import { Button } from "@/components/ui/button";
import { openPage } from "@/ui/navigation";
import { firstClickableRef } from "@/ui/RefBadge";
import { BlockNode } from "./BlockNode";
import { MessageNode, ScrollNode } from "./MessageNode";
import { OtherNode } from "./OtherNode";
import { PictureNode } from "./PictureNode";

/**
 * 노드 경로 규칙(검색 색인과 동일): 최상위 [i], 분기 안 [i, 분기, j].
 * basePath는 이 목록의 접두 경로이고 j번째 노드의 경로는 [...basePath, j].
 */
export function ScriptView({ nodes, basePath, onRefClick }: {
  nodes: ScriptNode[];
  basePath: number[];
  onRefClick?: (ref: Ref) => void;
}) {
  return (
    <div className="space-y-2">
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
}

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
    case "picture": return <PictureNode node={node} />;
    case "other": return <OtherNode node={node} />;
    case "stateChange": {
      const target = onRefClick ? firstClickableRef(node.refs) : undefined;
      return (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>⚙ {node.description}</span>
          {target && (
            <Button variant="ghost" size="icon-xs" aria-label="참조 보기" onClick={() => onRefClick!(target)}>
              <ExternalLink />
            </Button>
          )}
        </div>
      );
    }
    case "commonEvent": {
      const name = data?.commonEvents[node.commonEventId]?.name || `#${node.commonEventId}`;
      return (
        <div className="flex items-center text-sm">
          <span>↪ 공통 이벤트</span>
          <Button variant="link" size="sm" onClick={() => openPage({ source: "common", commonEventId: node.commonEventId })}>{name}</Button>
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
        <div className="flex items-center text-sm">
          <span>🚪 이동 →</span>
          <Button variant="link" size="sm" disabled={!target} onClick={() => target && openPage(target.location)}>{name}</Button>
          <span>({node.x ?? "?"}, {node.y ?? "?"})</span>
        </div>
      );
    }
  }
}
