import type { StandGroup } from "../addons/screenPictures";
import { parseManifest, type AdapterManifest } from "./manifest";

/** 어댑터의 뷰어 쪽 도움(adapters/<id>/viewer.ts의 `viewer`). 모두 순수 함수, 없으면 기본 동작. */
export interface AdapterViewer {
  /** 읽기에서 스탠딩 묶음(배우별) 이름. null이면 기본 이름. */
  standGroupLabel?(g: StandGroup): string | null;
  /** 스탠딩 묶음에 마우스를 올리면 보일 설명(겹 이름 등). null이면 그림 이름. */
  standGroupTitle?(g: StandGroup): string | null;
}

/** 뷰어에 들어 있는 어댑터 하나: manifest, 게임 쪽 확장 본문(없으면 null), 뷰어 쪽 도움(없으면 null) */
export interface BundledAdapter { manifest: AdapterManifest; script: string | null; viewer: AdapterViewer | null }

/** "../../adapters/<폴더>/<파일>" → 폴더 이름 */
function folderOf(path: string): string | null {
  const m = /adapters\/([^/]+)\/[^/]+$/.exec(String(path).replace(/\\/g, "/"));
  return m ? m[1] : null;
}

/**
 * 빌드할 때 모은 adapters/ 파일들(경로 → 내용)로 어댑터 목록을 만든다. 폴더 이름과 id가 다르거나 manifest가 잘못된 것,
 * bridgeScript가 있는데 파일이 없는 것은 뺀다. id 순. 예외를 던지지 않는다.
 */
export function buildAdapterBundle(
  manifests: Record<string, unknown>, scripts: Record<string, unknown>, viewers: Record<string, unknown>,
): BundledAdapter[] {
  const out: BundledAdapter[] = [];
  try {
    for (const [path, raw] of Object.entries(manifests ?? {})) {
      const folder = folderOf(path);
      const manifest = parseManifest(raw);
      if (!folder || !manifest || manifest.id !== folder) continue;
      let script: string | null = null;
      if (manifest.bridgeScript) {
        const hit = Object.entries(scripts ?? {}).find(([p]) => folderOf(p) === folder && p.replace(/\\/g, "/").endsWith(`/${manifest.bridgeScript}`));
        if (!hit || typeof hit[1] !== "string" || hit[1] === "") continue;
        script = hit[1];
      }
      let viewer: AdapterViewer | null = null;
      const v = Object.entries(viewers ?? {}).find(([p]) => folderOf(p) === folder)?.[1];
      if (v && typeof v === "object" && (v as { viewer?: unknown }).viewer && typeof (v as { viewer?: unknown }).viewer === "object") {
        viewer = (v as { viewer: AdapterViewer }).viewer;
      }
      out.push({ manifest, script, viewer });
    }
  } catch { /* 모은 데까지 */ }
  return out.sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : a.manifest.id > b.manifest.id ? 1 : 0));
}
