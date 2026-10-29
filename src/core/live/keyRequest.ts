/**
 * 게임 창 단축키로 누른 백업·복원(플러그인 1.21.0). 게임은 백업 API를 부를 수 없어서 rpg-viewer/request.json에
 * { v: 1, id, kind, at }을 쓰고, 뷰어(PC)가 id마다 한 번 처리한 뒤 control.json `keyReply`로 게임에 결과를 알린다.
 */

export type KeyRequestKind = "backup" | "restore";
export interface KeyRequest { id: string; kind: KeyRequestKind; at: number }
/** control.json `keyReply`: 게임은 같은 id에서 n이 바뀔 때마다 text를 화면에 잠깐 띄운다. */
export interface KeyReply { id: string; n: number; text: string }

/** 이보다 오래된 요청(뷰어를 늦게 켰거나 예전 세션)은 하지 않는다. */
export const KEY_REQUEST_MAX_AGE_MS = 10_000;
/** 게임에 보내는 답은 이 시간 동안만 control.json에 남긴다. */
export const KEY_REPLY_TTL_MS = 15_000;
/** 복원 안내를 게임 화면에서 읽을 시간(플러그인은 control.json을 1초마다 읽는다) */
export const RESTORE_NOTICE_MS = 1_500;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** request.json 글 → 요청. 깨졌거나 모르는 종류면 null. 예외를 던지지 않는다. */
export function parseKeyRequest(text: string | null | undefined): KeyRequest | null {
  if (typeof text !== "string" || text === "") return null;
  let o: unknown;
  try { o = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch { return null; }
  if (!isObj(o) || o.v !== 1 || typeof o.id !== "string" || o.id === "" || o.id.length > 100) return null;
  if (o.kind !== "backup" && o.kind !== "restore") return null;
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return null;
  return { id: o.id, kind: o.kind, at: o.at };
}

/** 지금 처리할 만큼 새 요청인가(같은 PC의 시계: 앞뒤로 10초 안). */
export const keyRequestFresh = (req: KeyRequest, now: number): boolean => Math.abs(now - req.at) <= KEY_REQUEST_MAX_AGE_MS;

const DONE_KEY = "rpgv.keyRequestsDone";
const DONE_MAX = 20;

/**
 * 이 요청을 이 창이 맡는다(PC에 뷰어 창이 둘이어도 한 번만): 처리한 id 목록(localStorage)에 없으면 넣고 true.
 * localStorage를 못 쓰면 이 창 기억(memory)만으로 판단한다.
 */
export function claimKeyRequest(id: string, memory: Set<string>, storage: Pick<Storage, "getItem" | "setItem"> | null): boolean {
  if (memory.has(id)) return false;
  memory.add(id);
  if (!storage) return true;
  try {
    const raw: unknown = JSON.parse(storage.getItem(DONE_KEY) ?? "[]");
    const done = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
    if (done.includes(id)) return false;
    storage.setItem(DONE_KEY, JSON.stringify([...done, id].slice(-DONE_MAX)));
  } catch { /* 이 창 기억만 */ }
  return true;
}
