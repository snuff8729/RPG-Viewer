import { useMemo } from "react";
import { useAddons } from "@/app/AddonsProvider";
import { useLive } from "@/app/LiveProvider";
import { groupById, isPictureRole, seenPictures, type PictureRole } from "@/core/addons/screenPictures";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { usePictureContext } from "./pictureContext";

const ROLE_LABEL: Record<PictureRole, string> = {
  cg: "이벤트 그림",
  stand: "스탠딩",
  hud: "화면 장식(숨김)",
  hidden: "숨김",
};
const ROLE_ORDER: PictureRole[] = ["cg", "stand", "hud", "hidden"];

function RoleSelect({ id, value, auto, onChange, label }: {
  id: string; value: PictureRole | "auto" | "mixed"; auto: string; onChange: (v: PictureRole | null) => void; label: string;
}) {
  return (
    <Select value={value === "mixed" ? "" : value}onValueChange={(v) => onChange(isPictureRole(v) ? v : null)}>
      <SelectTrigger id={id} size="sm" className="w-40 shrink-0" aria-label={label}>
        <SelectValue placeholder="여러 가지" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">자동 ({auto})</SelectItem>
        {ROLE_ORDER.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * 게임 설정 › 화면 그림 따라 그리기 › 그림 구분: 최근 기록에서 본 그림 번호마다 구분을 고른다
 * (자동 / 이벤트 그림 / 스탠딩 / 화면 장식(숨김) / 숨김). 번호가 이어지는 그림끼리 묶고, 묶음 전체도 한 번에 바꿀 수 있다.
 */
export function PictureRolesSection() {
  const { records } = useLive();
  const { pictureRoles, setPictureRole } = useAddons();
  const ctx = usePictureContext(records, true);
  const seen = useMemo(() => (ctx ? seenPictures(records, ctx) : []), [records, ctx]);
  const groups = useMemo(() => groupById(seen), [seen]);
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">아직 기록된 그림이 없어요. 게임에서 대사가 나오면 여기에 그림 번호가 보여요.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">그림 구분</p>
        <p className="text-sm text-muted-foreground">
          이벤트 그림은 화면 그대로, 스탠딩은 겹친 부분만 작게 보여요. 화면 장식과 숨김은 그리지 않아요. 자동이 틀리면 직접 골라 주세요.
        </p>
      </div>
      {groups.map((g) => {
        const first = g[0].id, last = g[g.length - 1].id;
        const values = g.map((p) => pictureRoles[p.id] ?? "auto");
        const groupValue = values.every((v) => v === values[0]) ? values[0] : "mixed";
        const groupAuto = g.every((p) => p.auto === g[0].auto) ? ROLE_LABEL[g[0].auto] : "그림마다";
        return (
          <div key={first} className="flex flex-col gap-2">
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`pic-group-${first}`} className="font-medium">
                {g.length > 1 ? `그림 ${first}–${last} (${g.length}개)` : `그림 ${first}`}
              </Label>
              {g.length > 1 && (
                <RoleSelect
                  id={`pic-group-${first}`} value={groupValue} auto={groupAuto} label={`그림 ${first}–${last} 모두`}
                  onChange={(r) => setPictureRole(g.map((p) => p.id), r)}
                />
              )}
              {g.length === 1 && (
                <RoleSelect
                  id={`pic-group-${first}`} value={values[0]} auto={ROLE_LABEL[g[0].auto]} label={`그림 ${first}`}
                  onChange={(r) => setPictureRole([first], r)}
                />
              )}
            </div>
            {g.length > 1 && g.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 pl-2">
                <Label htmlFor={`pic-${p.id}`} className="min-w-0 flex-col items-start gap-0 font-normal">
                  <span>{p.id}</span>
                  <span className="truncate text-xs text-muted-foreground" title={p.names.join(", ")}>{p.names.join(", ")}</span>
                </Label>
                <RoleSelect
                  id={`pic-${p.id}`} value={pictureRoles[p.id] ?? "auto"} auto={ROLE_LABEL[p.auto]} label={`그림 ${p.id}`}
                  onChange={(r) => setPictureRole([p.id], r)}
                />
              </div>
            ))}
            {g.length === 1 && (
              <p className="truncate text-xs text-muted-foreground" title={g[0].names.join(", ")}>{g[0].names.join(", ")}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
