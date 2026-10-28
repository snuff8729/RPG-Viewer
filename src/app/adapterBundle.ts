import { buildAdapterBundle, type BundledAdapter } from "@/core/adapters/bundle";

/** 저장소의 adapters/ 폴더(게임 전용 어댑터)를 빌드할 때 묶는다. 새 어댑터는 폴더만 더하면 된다(adapters/README.md). */
const manifests = import.meta.glob("../../adapters/*/manifest.json", { eager: true, import: "default" });
const scripts = import.meta.glob("../../adapters/*/*.js", { eager: true, query: "?raw", import: "default" });
const viewers = import.meta.glob("../../adapters/*/viewer.ts", { eager: true });

export const BUNDLED_ADAPTERS: readonly BundledAdapter[] = buildAdapterBundle(manifests, scripts, viewers);
