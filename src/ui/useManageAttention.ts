import { useDiagnosis } from "@/app/DiagnosisProvider";
import { useLive } from "@/app/LiveProvider";
import { computeManageAttention } from "./manageAttention";
import { useLoadErrors } from "./useLoadErrors";

export function useManageAttention() {
  const errors = useLoadErrors();
  const { report } = useDiagnosis();
  const { install } = useLive();
  return computeManageAttention({ loadErrors: errors.length, findings: report?.findings, install });
}
