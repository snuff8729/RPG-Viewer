import { BookOpen, CircleCheck, DoorOpen, Gift, Hand, Lock, MessageCircle, Repeat, type LucideIcon } from "lucide-react";
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

// 색은 src/index.css의 --section-* 토큰(밝은·어두운 테마 각각). Tailwind가 볼 수 있게 클래스 문자열은 전부 정적으로 쓴다.
const STYLES: Record<Section, SectionStyle> = {
  now: { label: "안 본 내용 있음", Icon: MessageCircle, text: "text-section-now", border: "border-section-now", bg: "bg-section-now", fill: "fill-section-now", cssVar: "--section-now" },
  item: { label: "아이템", Icon: Gift, text: "text-section-item", border: "border-section-item", bg: "bg-section-item", fill: "fill-section-item", cssVar: "--section-item" },
  repeat: { label: "반복하면 달라짐", Icon: Repeat, text: "text-section-repeat", border: "border-section-repeat", bg: "bg-section-repeat", fill: "fill-section-repeat", cssVar: "--section-repeat" },
  exit: { label: "다른 곳으로 이동", Icon: DoorOpen, text: "text-section-exit", border: "border-section-exit", bg: "bg-section-exit", fill: "fill-section-exit", cssVar: "--section-exit" },
  talk: { label: "다 봄 (다시 가능)", Icon: Hand, text: "text-section-talk", border: "border-section-talk", bg: "bg-section-talk", fill: "fill-section-talk", cssVar: "--section-talk" },
  locked: { label: "잠김", Icon: Lock, text: "text-section-locked", border: "border-section-locked", bg: "bg-section-locked", fill: "fill-section-locked", cssVar: "--section-locked" },
  done: { label: "다 봄", Icon: CircleCheck, text: "text-section-done", border: "border-section-done", bg: "bg-section-done", fill: "fill-section-done", cssVar: "--section-done" },
};
/** 이야기·자동 진행(자동 실행·병렬·그래픽 없는 잠긴 것, 직접 갈 수 없는·다른 이벤트가 부르는 것) */
const STORY: SectionStyle = {
  label: "이야기·자동 진행", Icon: BookOpen, text: "text-section-story", border: "border-section-story", bg: "bg-section-story", fill: "fill-section-story", cssVar: "--section-story",
};

/** 구역별 이름·아이콘·색(카드·맵·사이드바·범례가 같이 쓴다). */
export function sectionStyle(section: Section): SectionStyle {
  return STYLES[section];
}

/** 이벤트 하나의 스타일: 이야기·자동 진행이면 따로. */
export function eventStyle(ev: Pick<ChecklistEvent, "section" | "story">): SectionStyle {
  return ev.story ? STORY : STYLES[ev.section];
}

/** 이야기·자동 진행 스타일(범례용). */
export const storyStyle: SectionStyle = STORY;
