// 다음 이야기 단계를 화면 글로(UI와 무관). 예외를 던지지 않는다.
import type { Confidence, StepKind, StoryStep } from "./nextStep";
import type { MapPath } from "./transfer";

export const KIND_LABEL: Record<StepKind, string> = {
  talk: "말 걸기", check: "조사", touch: "밟기", enter: "맵에 들어가기", auto: "자동", battle: "전투", common: "공통 이벤트",
};
export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "높음", mid: "보통", low: "낮음" };

/** 무엇을 하는지 한 줄: `숲 · 노인에게 말 걸기`, `숲 · 상자 조사`, `숲에 들어가기` … */
export function stepAction(s: StoryStep): string {
  const where = s.mapName ? `${s.mapName} · ` : "";
  switch (s.kind) {
    case "talk": return `${where}${s.eventName}에게 말 걸기`;
    case "check": return `${where}${s.eventName} 조사`;
    case "touch": return `${where}${s.eventName} 밟기`;
    case "enter": return s.mapName ? `${s.mapName}에 들어가기` : `${s.eventName} (자동 시작)`;
    case "auto": return s.mapName ? `${s.mapName}에 들어가면 자동으로 시작` : `${s.eventName} (자동 시작)`;
    case "battle": return `${s.eventName}에서 진행`;
    case "common": return `${s.eventName} 실행`;
  }
}

/** 제목 한 줄: 할 일 + 첫 대사 미리보기 */
export function stepTitle(s: StoryStep): string {
  return s.preview ? `${stepAction(s)} — “${s.preview}”` : stepAction(s);
}

/** 지금 맵에 그릴 표시: 갈 곳이 이 맵이면 그 이벤트에 별(star), 아니면 그쪽으로 가는 출구(exit). 없으면 null */
export interface StoryMark { kind: "star" | "exit"; eventId: number; x: number; y: number }
export function storyMark(s: StoryStep | undefined, mapId: number): StoryMark | null {
  if (!s) return null;
  if (s.goal && s.goal.mapId === mapId) return { kind: "star", eventId: s.goal.eventId, x: s.goal.x, y: s.goal.y };
  const exit = s.path?.firstExit;
  if (exit && s.path!.maps[0] === mapId) return { kind: "exit", eventId: exit.eventId, x: exit.x, y: exit.y };
  return null;
}

/** `가는 길: 이 맵 → 숲 → 동굴`. 같은 맵이면 `이 맵에 있어요`, 모르면 null */
export function pathText(p: MapPath | null): string | null {
  if (!p) return null;
  if (p.maps.length <= 1) return "이 맵에 있어요";
  return ["이 맵", ...p.names.slice(1)].join(" → ") + (p.locked ? " (지금은 닫힌 출구를 지나요)" : "");
}
