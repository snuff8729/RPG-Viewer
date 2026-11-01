import { useDiagnosis } from "@/app/DiagnosisProvider";
import { useLive } from "@/app/LiveProvider";
import { attentionCount } from "@/core/diagnose";
import { useLoadErrors } from "./useLoadErrors";

export function useManageAttention() {
  const errors = useLoadErrors();
  const { report } = useDiagnosis();
  const { install } = useLive();
  return {
    count:
      errors.length +
      (report ? attentionCount(report) : 0) +
      (install?.state === "installed" && install.outdated ? 1 : 0),
    variant:
      errors.length > 0 || report?.findings.some((f) => f.status === "unsupported")
        ? ("destructive" as const)
        : ("warning" as const),
  };
}
