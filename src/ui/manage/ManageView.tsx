import { ArrowLeft } from "lucide-react";
import { MANAGE_SECTIONS, type ManageSection } from "@/app/route";
import { isRemoteView } from "@/app/share";
import { useTheme, type Theme } from "@/app/ThemeProvider";
import { useCompact } from "@/hooks/use-compact";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SectionHeader } from "@/ui/SectionHeader";
import { terms } from "@/ui/terms";
import { BackupSection } from "@/ui/live/BackupSection";
import { ShareSection } from "@/ui/live/ShareSection";
import { GameSettingsSection } from "@/ui/addons/GameSettingsSection";
import { DiagnoseView } from "@/ui/diagnose/DiagnoseView";
import { GameActions } from "@/ui/GameActions";
import { useLoadErrors } from "@/ui/useLoadErrors";
import { useManageAttention } from "@/ui/useManageAttention";
import { Badge } from "@/components/ui/badge";
import { ConnectionSection } from "./ConnectionSection";

const sections: Record<ManageSection, { title: string; description: string; pc?: boolean }> = {
  connection: { title: terms.connection, description: "기록 플러그인을 관리하고 게임을 실행해요.", pc: true },
  backups: { title: terms.backups, description: "세이브를 따로 남기고 필요할 때 복원해요.", pc: true },
  share: { title: terms.share, description: "같은 와이파이의 휴대폰에서 이 게임을 봐요.", pc: true },
  settings: { title: terms.settings, description: "이 게임에 필요한 기록과 표시 방법을 정해요." },
  diagnose: { title: terms.diagnose, description: "이 게임을 뷰어가 잘 읽는지 확인해요." },
  appearance: { title: terms.appearance, description: "이 기기에서 사용할 화면 테마를 골라요." },
  games: { title: terms.games, description: "다른 게임을 열거나 지금 게임을 고정해요.", pc: true },
};

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={theme}
      onValueChange={(v) => {
        if (v) setTheme(v as Theme);
      }}
      aria-label="화면 테마"
    >
      <ToggleGroupItem value="system">시스템</ToggleGroupItem>
      <ToggleGroupItem value="light">밝게</ToggleGroupItem>
      <ToggleGroupItem value="dark">어둡게</ToggleGroupItem>
    </ToggleGroup>
  );
}
function DiagnosisSection() {
  // 할 일 수 = 관리 진단 배지 수(useManageAttention과 같은 불러오기 오류·진단 결과를 써요)
  return <DiagnoseView loadErrors={useLoadErrors()} />;
}
export function ManageView({ section }: { section?: ManageSection }) {
  const compact = useCompact();
  const remote = isRemoteView();
  const active = section ?? (compact ? null : "connection");
  const item = active ? sections[active] : null;
  const attention = useManageAttention();
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 min-[900px]:flex-row min-[900px]:p-6">
      {(!compact || !active) && (
        <nav aria-label="관리 섹션" className="flex shrink-0 flex-col gap-1 min-[900px]:w-48">
          {MANAGE_SECTIONS.map((s) => {
            const need = attention.sections[s];
            return (
              <Button
                key={s}
                asChild
                variant={active === s ? "secondary" : "ghost"}
                className={`justify-start ${remote && sections[s].pc ? "text-muted-foreground" : ""}`}
              >
                <a href={`#/manage/${s}`}>
                  {sections[s].title}
                  {need && (
                    <Badge variant={need.variant} className="ml-auto" aria-label={`확인할 것 ${need.count}개`}>
                      {need.count}
                    </Badge>
                  )}
                </a>
              </Button>
            );
          })}
        </nav>
      )}
      {active && item && (
        <section className="min-w-0 flex-1 space-y-6">
          {compact && (
            <Button variant="ghost" size="sm" asChild>
              <a href="#/manage">
                <ArrowLeft />
                관리 목록으로
              </a>
            </Button>
          )}
          <SectionHeader title={item.title} description={item.description} />
          {remote && item.pc ? (
            <Alert>
              <AlertDescription>{terms.pcOnly}</AlertDescription>
            </Alert>
          ) : (
            <>
              {active === "connection" && <ConnectionSection />}
              {active === "backups" && <BackupSection />}
              {active === "share" && <ShareSection />}
              {active === "settings" && <GameSettingsSection />}
              {active === "diagnose" && <DiagnosisSection />}
              {active === "appearance" && <AppearanceSection />}
              {active === "games" && <GameActions />}
            </>
          )}
        </section>
      )}
    </div>
  );
}
