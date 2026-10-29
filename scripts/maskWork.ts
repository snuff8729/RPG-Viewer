// 뷰어 서버의 가린 사본 일(scripts/maskApi.ts가 처음 쓸 때 불러온다 — src/core를 끌어오므로 vite 설정에 묶지 않는다).
import path from "node:path";
import { buildFreeTextIndex, maskFreeText, maskString, unmaskText } from "../src/core/mask/index.ts";
import { readAdapterManifests } from "./diagnose-game.ts";
import { exportMirror, runMaskPass } from "./mask-game.ts";
import type { MaskWork } from "./maskApi.ts";

const pad = (n: number) => String(n).padStart(2, "0");

/** 게임 폴더 이름(가림) + -YYYYMMDD-HHMMSS. 원래 이름의 가릴 낱말은 토큰으로 바뀐다. 파일 이름에 못 쓰는 글자는 `_`. */
export function maskedFolderName(gameRoot: string, now: Date): string {
  const raw = path.basename(path.resolve(gameRoot));
  let name = maskString(raw).replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").replace(/[. ]+$/, "").trim();
  if (name === "" || /^\.+$/.test(name)) name = "game";
  if (name.length > 80) name = name.slice(0, 80);
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${name}-${stamp}`;
}

export const work: MaskWork = {
  maskedFolderName,
  async exportMirror(root, out, note) {
    const r = await exportMirror(root, out, note, readAdapterManifests());
    if (!r.ok) return r;
    const s = r.summary;
    return { ok: true, path: r.out, files: s.textFiles + s.placeholders, tokens: s.tokens, replaced: s.replaced, hits: s.scan.count };
  },
  async dictionary(root) {
    const pass = await runMaskPass(root, readAdapterManifests());
    // 보고서에서만 생긴 토큰(REPORT.md)도 풀 수 있게 같은 방법으로 더한다
    if (pass.report !== null) maskFreeText(pass.report, buildFreeTextIndex(pass.ctx.dict), pass.ctx);
    return pass.ctx.dict;
  },
  unmask(text, dict) {
    const r = unmaskText(text, dict);
    return { text: r.text, replaced: r.replaced, unknown: r.unknown.length };
  },
};
