import { BookOpen, Check, DoorOpen, Gift, Hand, Lock, MessageCircle, Repeat, type LucideIcon } from "lucide-react";
import type { ChecklistEvent, Section } from "@/core/live/mapChecklist";

export interface SectionStyle {
  label: string;
  Icon: LucideIcon;
  /** 글자 색 */
  text: string;
  /** 테두리 색 */
  border: string;
  /** 배경 색 */
  bg: string;
  /** SVG 채움 색 */
  fill: string;
  /** 캔버스에서 읽을 CSS 변수 */
  cssVar: string;
}

// Tailwind가 볼 수 있게 클래스 문자열은 전부 정적으로 쓴다.
const STYLES: Record<Section, SectionStyle> = {
  now: { label: "새 대화", Icon: MessageCircle, text: "text-chart-2", border: "border-chart-2", bg: "bg-chart-2", fill: "fill-chart-2", cssVar: "--chart-2" },
  item: { label: "아이템", Icon: Gift, text: "text-chart-4", border: "border-chart-4", bg: "bg-chart-4", fill: "fill-chart-4", cssVar: "--chart-4" },
  repeat: { label: "반복하면 달라짐", Icon: Repeat, text: "text-chart-1", border: "border-chart-1", bg: "bg-chart-1", fill: "fill-chart-1", cssVar: "--chart-1" },
  exit: { label: "다른 곳으로 이동", Icon: DoorOpen, text: "text-chart-5", border: "border-chart-5", bg: "bg-chart-5", fill: "fill-chart-5", cssVar: "--chart-5" },
  talk: { label: "조사·대화 가능", Icon: Hand, text: "text-chart-3", border: "border-chart-3", bg: "bg-chart-3", fill: "fill-chart-3", cssVar: "--chart-3" },
  locked: { label: "잠김", Icon: Lock, text: "text-muted-foreground", border: "border-muted-foreground", bg: "bg-muted-foreground", fill: "fill-muted-foreground", cssVar: "--muted-foreground" },
  done: { label: "다 봄", Icon: Check, text: "text-border", border: "border-border", bg: "bg-border", fill: "fill-border", cssVar: "--border" },
};
/** 이야기·자동 진행(자동 실행·병렬·그래픽 없는 잠긴 것, 직접 갈 수 없는·다른 이벤트가 부르는 것) */
const STORY: SectionStyle = {
  label: "이야기·자동 진행", Icon: BookOpen, text: "text-muted-foreground", border: "border-border", bg: "bg-border", fill: "fill-border", cssVar: "--border",
};

/** 구역별 이름·아이콘·색(카드·맵·사이드바가 같이 쓴다). */
export function sectionStyle(section: Section): SectionStyle {
  return STYLES[section];
}

/** 이벤트 하나의 스타일: 이야기·자동 진행이면 따로. */
export function eventStyle(ev: Pick<ChecklistEvent, "section" | "story">): SectionStyle {
  return ev.story ? STORY : STYLES[ev.section];
}
