/**
 * 가린 사본 API(scripts/maskApi.ts) 클라이언트: AI에게 줄 가린 사본 만들기, AI 답변 속 토큰 풀기.
 * 서버는 폴더 API 세션 id로 게임을 찾는다. 뷰어 서버로 연 게임이면 그 세션을, 브라우저로 연 게임이면 기억한 경로로 세션을 연다.
 */
import { ServerFolder, openFolderOnServer, type FetchFn } from "./serverFolder";

export type MaskExportResult =
  | { ok: true; path: string; files: number; tokens: number; replaced: number; hits: number }
  | { ok: false; error: string };
export type UnmaskResult = { ok: true; text: string; replaced: number; unknown: number } | { ok: false; error: string };

const NETWORK_ERROR = "뷰어 서버에 연결하지 못했어요";
const NO_GAME = "게임 폴더 위치를 알아야 해요";

/** 게임 찾기: 서버로 연 폴더(세션 id) 또는 게임 폴더 경로 */
export interface MaskTarget { folder?: unknown; path: string | null }

const defaultFetch: FetchFn = (input, init) => fetch(input, init);

async function post(fetchFn: FetchFn, route: "export" | "unmask", target: MaskTarget, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const server = target.folder instanceof ServerFolder && !target.folder.readOnly ? target.folder : null;
  const path = server?.root ?? target.path;
  const openId = async () => {
    if (!path) return null;
    const r = await openFolderOnServer(path, fetchFn);
    return r.ok && "session" in r ? r.session.id : null;
  };
  const call = (id: string) => fetchFn(`/api/mask/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, id }),
  });
  let id = server?.sessionId ?? (await openId());
  if (id === null) return { ok: false, error: NO_GAME };
  let r = await call(id);
  // 서버가 다시 시작돼 세션을 잊었으면 한 번 다시 연다
  if (r.status === 410 && (id = await openId()) !== null) r = await call(id);
  const j = (await r.json()) as Record<string, unknown>;
  return j && typeof j === "object" ? j : { ok: false, error: NETWORK_ERROR };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const errorOf = (j: Record<string, unknown>) => ({ ok: false as const, error: typeof j.error === "string" ? j.error : NETWORK_ERROR });

/** 가린 사본을 만든다(문서 폴더의 RPG-Viewer-Masked 아래). note: 사용자가 쓴 문제 설명 */
export async function exportMasked(target: MaskTarget, note: string, fetchFn: FetchFn = defaultFetch): Promise<MaskExportResult> {
  try {
    const j = await post(fetchFn, "export", target, { note });
    if (j.ok !== true || typeof j.path !== "string") return errorOf(j);
    return { ok: true, path: j.path, files: num(j.files), tokens: num(j.tokens), replaced: num(j.replaced), hits: num(j.hits) };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

/** 글 속 토큰을 이 게임의 원래 글로 푼다 */
export async function unmaskWithGame(target: MaskTarget, text: string, fetchFn: FetchFn = defaultFetch): Promise<UnmaskResult> {
  try {
    const j = await post(fetchFn, "unmask", target, { text });
    if (j.ok !== true || typeof j.text !== "string") return errorOf(j);
    return { ok: true, text: j.text, replaced: num(j.replaced), unknown: num(j.unknown) };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

/** Claude Code에 붙여 넣을 한 줄 */
export const agentInstruction = (path: string): string =>
  `가린 사본 ${path} 를 onboard-game으로 봐줘. REPORT.md에 문제 설명이 있어.`;
