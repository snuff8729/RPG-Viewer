import type { Route } from "@/app/route";

export type ViewKind = "play" | "read" | "here" | "history" | "missing" | "explore";

/** 사이드바 "보기" 항목과 헤더 제목이 함께 쓰는 화면 이름 */
export const VIEW_NAMES: Record<ViewKind, string> = {
  play: "플레이", read: "읽기", here: "이 맵", history: "기록", missing: "못 본 것", explore: "찾아보기",
};

/** 라우트가 속한 화면. 홈과 이벤트 페이지는 찾아보기다. */
export function viewOf(route: Route): ViewKind {
  return route.kind === "home" || route.kind === "page" ? "explore" : route.kind;
}
