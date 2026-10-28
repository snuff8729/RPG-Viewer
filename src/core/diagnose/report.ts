import { DIAGNOSE_AREAS, type DiagnoseAction, type DiagnoseStatus, type DiagnosisReport } from "./types";

/** 상태 → 보일 이름 */
export const STATUS_LABELS: Record<DiagnoseStatus, string> = {
  ok: "괜찮아요", "auto-fixed": "자동 처리", "needs-addon": "켜면 돼요", unsupported: "아직 안 돼요", unknown: "확인 필요",
};

/** 사용자가 살펴볼 것인가(켜면 되는 것·아직 안 되는 것·확인이 필요한 것) */
export const needsAttention = (s: DiagnoseStatus): boolean => s === "needs-addon" || s === "unsupported" || s === "unknown";

/** 확인할 것 수 */
export function attentionCount(report: DiagnosisReport | null | undefined): number {
  try {
    return (report?.findings ?? []).filter(f => needsAttention(f.status)).length;
  } catch {
    return 0;
  }
}

const actionKey = (a: DiagnoseAction): string => {
  switch (a.kind) {
    case "enable-addon": return `addon:${a.addon}`;
    case "enable-adapter": return `adapter:${a.adapter}`;
    case "set-role": return a.target === "sprite" ? `sprite:${a.role}:${a.keys.join("|")}` : `picture:${a.role}:${a.ids.join("|")}`;
    case "none": return "none";
  }
};

/** `추천 설정 모두 적용`이 할 일(켜면 되는 것의 설정, 같은 것은 한 번). 예외를 던지지 않는다. */
export function recommendedActions(report: DiagnosisReport | null | undefined): DiagnoseAction[] {
  const out: DiagnoseAction[] = [];
  const seen = new Set<string>();
  try {
    for (const f of report?.findings ?? []) {
      if (f.status !== "needs-addon" || !f.action || f.action.kind === "none") continue;
      const k = actionKey(f.action);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f.action);
    }
  } catch { /* 모은 데까지 */ }
  return out;
}

const oneLine = (s: string): string => String(s ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();

/** 개발용 보고서(마크다운): Claude Code에 붙여 넣어 어댑터를 만들 때 쓴다. 예외를 던지지 않는다. */
export function reportMarkdown(report: DiagnosisReport): string {
  try {
    const lines: string[] = [];
    const n = attentionCount(report);
    lines.push(`# 게임 진단: ${oneLine(report.gameTitle) || "(제목 없음)"} (${report.engine})`, "");
    const by = (s: DiagnoseStatus) => report.findings.filter(f => f.status === s).length;
    lines.push(`- 확인할 것: ${n}개 (켜면 돼요 ${by("needs-addon")}, 아직 안 돼요 ${by("unsupported")}, 확인 필요 ${by("unknown")})`);
    const u = report.used;
    lines.push(
      `- 본 것: 게임 데이터, 플러그인 본문 ${u.pluginSources ? "있음" : "없음"}, 그림 목록 ${u.files ? "있음" : "없음"}, `
      + `플레이 기록 ${u.log ? `${u.logRecords}줄` : "없음"}`,
    );
    for (const area of DIAGNOSE_AREAS) {
      const list = report.findings.filter(f => f.area === area);
      if (list.length === 0) continue;
      lines.push("", `## ${area}`, "");
      for (const f of list) {
        lines.push(`- [${STATUS_LABELS[f.status]}] \`${f.id}\` ${oneLine(f.title)} — ${oneLine(f.detail)}`);
        if (f.action && f.action.kind !== "none") lines.push(`  - 추천 설정: \`${JSON.stringify(f.action)}\``);
        for (const e of f.evidence) lines.push(`  - ${oneLine(e)}`);
      }
    }
    if (report.unknownPlugins.length > 0) {
      lines.push("", "## 모르는 플러그인", "", "| 플러그인 | 짐작 | 열쇠말 | 함수 |", "| --- | --- | --- | --- |");
      for (const p of report.unknownPlugins) {
        lines.push(`| ${oneLine(p.name)} | ${p.areas.join(", ")} | ${oneLine(p.keywords.join(", "))} | ${oneLine(p.functions.join(", "))} |`);
      }
    }
    lines.push(
      "", "## 다음 단계", "",
      "Claude Code에서 `onboard-game` 스킬로 이 게임 폴더를 진단하고, `확인 필요`·`아직 안 돼요` 항목마다 어댑터(adapters/)를 만들어 주세요.",
    );
    return lines.join("\n") + "\n";
  } catch {
    return "# 게임 진단\n\n보고서를 만들지 못했어요.\n";
  }
}
