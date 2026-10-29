import { useCallback, useEffect, useState } from "react";
import { useAddons } from "@/app/AddonsProvider";
import { useGame } from "@/app/GameProvider";
import { useLive } from "@/app/LiveProvider";
import type { BundledAdapter } from "@/core/adapters/bundle";
import {
  getAdapterInstallStatus, installAdapter, uninstallAdapter, unknownTokensNote, type AdapterInstallResult, type AdapterInstallStatus,
} from "@/core/adapters/install";
import { isWritableFolder } from "@/core/fs/folder";
import { isRemoteFolder } from "@/app/serverFolder";
import { versionAtLeast } from "@/core/live/assist";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const MIN_BRIDGE = "1.13.0";

/** 게임 쪽 확장(bridge.js) 설치 상태와 설치·제거 */
function useAdapterInstall(adapter: BundledAdapter) {
  const { folder, data } = useGame();
  // 휴대폰 보기에서는 게임 쪽 확장(plugins.js)을 설치·제거하지 않는다
  const wfolder = folder && isWritableFolder(folder) && !isRemoteFolder(folder) ? folder : null;
  const dataRoot = data?.dataRoot ?? null;
  const { id, label } = adapter.manifest;
  const script = adapter.script;
  // 읽은 상태와 그때의 폴더(다른 게임의 상태는 쓰지 않는다)
  const [read, setRead] = useState<{ folder: unknown; status: AdapterInstallStatus } | null>(null);
  const refresh = useCallback(async () => {
    if (!wfolder || dataRoot === null || script === null) return;
    const status = await getAdapterInstallStatus(wfolder, dataRoot, id, script);
    setRead({ folder: wfolder, status });
  }, [wfolder, dataRoot, id, script]);
  useEffect(() => {
    let cancelled = false;
    if (!wfolder || dataRoot === null || script === null) return;
    void getAdapterInstallStatus(wfolder, dataRoot, id, script).then((status) => { if (!cancelled) setRead({ folder: wfolder, status }); });
    return () => { cancelled = true; };
  }, [wfolder, dataRoot, id, script]);
  const status = read && read.folder === wfolder && script !== null ? read.status : null;
  /** 클릭 핸들러 안에서 부를 것(쓰기 권한 요청) */
  const run = useCallback(async (on: boolean): Promise<AdapterInstallResult> => {
    if (!wfolder || dataRoot === null || script === null) return { ok: false, message: "폴더 열기로 연 게임에서만 설치할 수 있어요" };
    let granted = false;
    try { granted = await wfolder.requestWrite(); } catch { granted = false; }
    if (!granted) return { ok: false, message: "쓰기 권한이 필요해요" };
    const r = on ? await installAdapter(wfolder, dataRoot, id, label, script) : await uninstallAdapter(wfolder, dataRoot, id);
    await refresh();
    return r;
  }, [wfolder, dataRoot, id, label, script, refresh]);
  return { status, run, canInstall: wfolder !== null, remote: isRemoteFolder(folder) };
}

/** 이 게임에 맞는 게임 전용 어댑터 하나(게임 설정 Sheet) */
export function AdapterCard({ adapter }: { adapter: BundledAdapter }) {
  const { isAdapterOn, setAdapterOn, isAdapterOptionOn, setAdapterOption } = useAddons();
  const { connection, live } = useLive();
  const { status, run, canInstall, remote } = useAdapterInstall(adapter);
  const [result, setResult] = useState<AdapterInstallResult | null>(null);
  const [busy, setBusy] = useState(false);
  const { id, label, description } = adapter.manifest;
  const on = isAdapterOn(id);
  const hasScript = adapter.script !== null;
  const htmlId = `adapter-${id}`;

  const toggle = (v: boolean) => {
    setAdapterOn(id, v);
    setResult(null);
    if (!hasScript || !canInstall) return;
    setBusy(true);
    void run(v).then(setResult).finally(() => setBusy(false));
  };
  const reinstall = () => {
    setBusy(true);
    setResult(null);
    void run(true).then(setResult).finally(() => setBusy(false));
  };

  const applied = Array.isArray(live?.assist?.extensions) && live.assist.extensions.includes(id);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Label htmlFor={htmlId}>{label}</Label>
          <Badge>이 게임 전용</Badge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Switch id={htmlId} checked={on} disabled={busy} onCheckedChange={toggle} />
        </CardAction>
      </CardHeader>
      {on && (
        <CardContent className="flex flex-col gap-3 text-sm">
          {(adapter.manifest.options ?? []).map((o) => {
            const oid = `${htmlId}-${o.id}`;
            return (
              <div key={o.id} className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={oid}>{o.label}</Label>
                  {o.description && <p className="text-muted-foreground">{o.description}</p>}
                </div>
                <Switch id={oid} checked={isAdapterOptionOn(id, o.id)} onCheckedChange={(v) => setAdapterOption(id, o.id, v)} />
              </div>
            );
          })}
          {hasScript && !canInstall && (
            <Alert>
              <AlertDescription>
                {remote ? "게임 쪽 확장은 PC에서 설치해 주세요." : "게임 쪽 확장은 폴더 열기로 연 게임에서만 설치할 수 있어요."}
              </AlertDescription>
            </Alert>
          )}
          {hasScript && canInstall && status?.state === "installed" && status.outdated && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">게임 쪽 확장이 예전 것이에요.</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={reinstall}>업데이트</Button>
            </div>
          )}
          {hasScript && canInstall && status?.state === "notInstalled" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">게임 쪽 확장이 설치되지 않았어요.</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={reinstall}>설치</Button>
            </div>
          )}
          {result && (
            <Alert variant={result.ok ? "default" : "destructive"}>
              <AlertDescription>
                {result.ok ? "게임 쪽 확장을 설치했어요. 게임을 다시 시작하면 적용돼요." : result.message}
              </AlertDescription>
            </Alert>
          )}
          {result?.ok && result.unknownTokens !== undefined && (
            <Alert>
              <AlertDescription>{unknownTokensNote(result.unknownTokens)}</AlertDescription>
            </Alert>
          )}
          {hasScript && connection === "connected" && live && !versionAtLeast(live.pluginVersion, MIN_BRIDGE) && (
            <Alert>
              <AlertDescription>
                게임의 기록 플러그인({live.pluginVersion || "?"})이 {MIN_BRIDGE}보다 낮아요. 기록 플러그인을 업데이트하고 게임을 다시 실행해 주세요.
              </AlertDescription>
            </Alert>
          )}
          {hasScript && connection === "connected" && live && versionAtLeast(live.pluginVersion, MIN_BRIDGE) && (
            <p className="text-muted-foreground">{applied ? "게임에 적용됐어요." : "게임을 다시 시작하면 적용돼요."}</p>
          )}
          {!hasScript && <p className="text-muted-foreground">켜져 있어요. 그림 구분 기본값과 필요한 부가 기능이 적용됐어요.</p>}
        </CardContent>
      )}
    </Card>
  );
}
