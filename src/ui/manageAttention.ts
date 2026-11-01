import { MANAGE_SECTIONS, type ManageSection } from "@/app/route";
import { needsAttention, type DiagnoseStatus } from "@/core/diagnose";
import type { InstallStatus } from "@/core/live/installer";

export type AttentionVariant = "destructive" | "warning";
export interface SectionAttention {
  count: number;
  variant: AttentionVariant;
}
export interface ManageAttention {
  /** 확인할 것이 있는 섹션만 들어 있어요 */
  sections: Partial<Record<ManageSection, SectionAttention>>;
  /** 머리줄 배지 숫자 = 섹션 숫자의 합 */
  count: number;
  variant: AttentionVariant;
  /** 관리 목록 순서로 처음 확인할 섹션 */
  first: ManageSection | null;
  /** 관리 링크 주소: 확인할 것이 있으면 그 섹션으로 바로 가요 */
  href: string;
}

export interface ManageAttentionInput {
  loadErrors: number;
  findings: readonly { status: DiagnoseStatus }[] | null | undefined;
  install: InstallStatus | null | undefined;
}

/** 플러그인 설치·업데이트가 필요한가 */
export function pluginNeedsAction(install: InstallStatus | null | undefined): boolean {
  return install?.state === "notInstalled" || (install?.state === "installed" && install.outdated);
}

export function computeManageAttention({ loadErrors, findings, install }: ManageAttentionInput): ManageAttention {
  const sections: ManageAttention["sections"] = {};
  if (pluginNeedsAction(install)) sections.connection = { count: 1, variant: "warning" };
  const list = findings ?? [];
  const diag = loadErrors + list.filter((f) => needsAttention(f.status)).length;
  if (diag > 0) {
    sections.diagnose = {
      count: diag,
      variant: loadErrors > 0 || list.some((f) => f.status === "unsupported") ? "destructive" : "warning",
    };
  }
  const present = MANAGE_SECTIONS.filter((s) => sections[s]);
  const count = present.reduce((n, s) => n + sections[s]!.count, 0);
  const first = present[0] ?? null;
  return {
    sections,
    count,
    variant: present.some((s) => sections[s]!.variant === "destructive") ? "destructive" : "warning",
    first,
    href: first ? `#/manage/${first}` : "#/manage",
  };
}
