import { createContext, useContext } from "react";
import type { ReaderItem } from "@/core/live/reader";
import type { HideRule } from "@/core/live/readerFile";
import { NOTICE_KIND_LABELS, type NoticeKind } from "@/core/addons/notices";

/**
 * 읽기 줄 숨김 판정(숨김 규칙, core/live/hideRules). 맨 위 줄은 읽기 화면이 `숨긴 문구 N줄`로 묶고,
 * 전투 안·다시 본 대화 안의 줄은 ReaderItemView가 이것으로 뺀다. 숨긴 줄을 펼쳐 볼 때는 NEVER_HIDDEN을 준다.
 */
export const NEVER_HIDDEN = (): boolean => false;
export const ReaderHideContext = createContext<(item: ReaderItem) => boolean>(NEVER_HIDDEN);
export const useLineHidden = () => useContext(ReaderHideContext);

/** 줄 종류 이름(`… 모두 숨기기`, 숨긴 문구 목록) */
export function hideTypeLabel(type: string): string {
  if (type === "plugin-tech") return "기술 플러그인 명령";
  if (type.startsWith("plugin:")) return `플러그인 명령(${type.slice(7)})`;
  if (type === "notice") return "알림 문구";
  if (type.startsWith("notice-kind:")) {
    const k = type.slice(12) as NoticeKind;
    const label = NOTICE_KIND_LABELS[k] ?? k;
    return label === "알림" ? "일반 알림" : `${label} 알림`;
  }
  if (type.startsWith("notice-source:")) return `출처가 ${type.slice(14)}인 알림`;
  if (type === "battle") return "전투";
  if (type === "battlelog") return "전투 로그 줄";
  return type;
}

const clip = (s: string, n: number) => { const c = [...s]; return c.length > n ? `${c.slice(0, n).join("")}…` : s; };

/** 숨긴 문구 목록에 보일 규칙 설명 */
export function hideRuleLabel(r: HideRule): { title: string; kind: string } {
  if (r.kind === "exact") return { title: `“${clip(r.text, 60)}”`, kind: "이 문장" };
  if (r.kind === "digits") return { title: `“${clip(r.pattern.replace(/#/g, "○"), 60)}”`, kind: "숫자만 다른 문장도" };
  return { title: hideTypeLabel(r.type), kind: "이 종류 모두" };
}
