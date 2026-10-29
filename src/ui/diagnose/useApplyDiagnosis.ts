import { useCallback } from "react";
import { useAddons } from "@/app/AddonsProvider";
import { useGame } from "@/app/GameProvider";
import { BUNDLED_ADAPTERS } from "@/app/adapterBundle";
import { installAdapter, unknownTokensNote } from "@/core/adapters/install";
import type { DiagnoseAction } from "@/core/diagnose";
import { isWritableFolder } from "@/core/fs/folder";

/** 진단의 추천 설정을 적용한다(부가 기능·어댑터 켜기, 그림 구분). 클릭 핸들러 안에서 부를 것. 돌려주는 값: 안내 글(없으면 null) */
export function useApplyDiagnosis(): (actions: readonly DiagnoseAction[]) => Promise<string | null> {
  const { setOn, setAdapterOn, setSpriteRole, setPictureRole } = useAddons();
  const { folder, data } = useGame();
  return useCallback(async (actions) => {
    const installs: { id: string; label: string; script: string }[] = [];
    for (const a of actions) {
      if (a.kind === "enable-addon") setOn(a.addon, true);
      else if (a.kind === "enable-adapter") {
        setAdapterOn(a.adapter, true);
        const b = BUNDLED_ADAPTERS.find((x) => x.manifest.id === a.adapter);
        if (b?.script) installs.push({ id: b.manifest.id, label: b.manifest.label, script: b.script });
      } else if (a.kind === "set-role") {
        if (a.target === "sprite") setSpriteRole(a.keys, a.role);
        else setPictureRole(a.ids, a.role);
      }
    }
    if (installs.length === 0) return null;
    if (!folder || !data || !isWritableFolder(folder)) return "게임 쪽 확장은 폴더 열기로 연 게임에서만 설치할 수 있어요. 게임 설정에서 다시 확인해 주세요.";
    let granted = false;
    try { granted = await folder.requestWrite(); } catch { granted = false; }
    if (!granted) return "게임 쪽 확장을 설치하려면 쓰기 권한이 필요해요.";
    const failed: string[] = [], warned: string[] = [];
    for (const i of installs) {
      const r = await installAdapter(folder, data.dataRoot, i.id, i.label, i.script);
      if (!r.ok) failed.push(`${i.label}: ${r.message}`);
      else if (r.unknownTokens !== undefined) warned.push(`${i.label}: ${unknownTokensNote(r.unknownTokens)}`);
    }
    if (failed.length > 0) return [...failed, ...warned].join("\n");
    return ["게임 쪽 확장을 설치했어요. 게임을 다시 시작하면 적용돼요.", ...warned].join("\n");
  }, [setOn, setAdapterOn, setSpriteRole, setPictureRole, folder, data]);
}
