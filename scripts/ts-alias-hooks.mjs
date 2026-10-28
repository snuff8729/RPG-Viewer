// Node에서 src/의 TypeScript를 바로 돌리기 위한 해석 훅(새 의존성 없이): `@/` → src/, 확장자 없는 상대 경로 → .ts / index.ts.
// 사용: node --import ./scripts/ts-alias-hooks.mjs scripts/diagnose-game.ts <게임 폴더>
import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

const isFile = (p) => {
  try { return existsSync(p) && statSync(p).isFile(); } catch { return false; }
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = null;
    if (specifier.startsWith("@/")) target = path.join(SRC, specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (target !== null && !target.includes(`${path.sep}node_modules${path.sep}`)) {
      for (const c of [target, `${target}.ts`, path.join(target, "index.ts")]) {
        if (isFile(c)) return nextResolve(pathToFileURL(c).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
