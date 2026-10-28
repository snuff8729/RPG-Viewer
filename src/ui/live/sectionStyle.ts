import { Check, Lock, MessageCircle, Repeat, type LucideIcon } from "lucide-react";
import type { Section } from "@/core/live/mapChecklist";

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
}

// Tailwind가 볼 수 있게 클래스 문자열은 전부 정적으로 쓴다.
const STYLES: Record<Section, SectionStyle> = {
  now: { label: "지금 할 수 있음", Icon: MessageCircle, text: "text-chart-2", border: "border-chart-2", bg: "bg-chart-2", fill: "fill-chart-2" },
  repeat: { label: "반복하면 달라짐", Icon: Repeat, text: "text-chart-1", border: "border-chart-1", bg: "bg-chart-1", fill: "fill-chart-1" },
  locked: { label: "잠김", Icon: Lock, text: "text-muted-foreground", border: "border-muted-foreground", bg: "bg-muted-foreground", fill: "fill-muted-foreground" },
  done: { label: "다 봄", Icon: Check, text: "text-border", border: "border-border", bg: "bg-border", fill: "fill-border" },
};

/** 구역별 이름·아이콘·색(카드·맵·사이드바가 같이 쓴다). */
export function sectionStyle(section: Section): SectionStyle {
  return STYLES[section];
}
