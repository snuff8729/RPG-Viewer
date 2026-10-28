/**
 * 최근·고정 게임 목록(순수 로직). 저장은 recentGames.ts가 한다.
 *
 * - 서버로 연 게임은 실제 경로로, 브라우저로 연 게임은 폴더 이름 + 게임 키(제목|데이터 폴더)로 같은 게임을 가린다.
 * - 고정한 게임은 따로 보이고 밀려나지 않는다. 최근 목록은 고정하지 않은 것 중 최신 MAX_RECENT개.
 */

export const MAX_RECENT = 5;

export interface RecentItem {
  key: string;
  kind: "server" | "handle";
  /** 서버로 연 게임의 실제 경로 */
  path?: string;
  /** 폴더 이름 */
  name: string;
  /** 게임 제목(모르면 "") */
  title: string;
  /** 제목|데이터 폴더(모르면 "") */
  gameKey: string;
  openedAt: number;
  pinned: boolean;
}

export type RecentInput =
  | { kind: "server"; path: string; name: string; title: string; gameKey: string }
  | { kind: "handle"; name: string; title: string; gameKey: string };

/** Windows 경로는 대소문자·구분자를 가리지 않는다. */
function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function recentKey(input: RecentInput): string {
  return input.kind === "server" ? `server:${normPath(input.path)}` : `handle:${input.name}|${input.gameKey}`;
}

/** 연 게임을 맨 앞으로(고정 여부 유지). 서버로 연 게임은 같은 이름·게임 키의 브라우저 항목을 대신한다. */
export function touchRecent(list: RecentItem[], input: RecentInput, now: number): RecentItem[] {
  const key = recentKey(input);
  const superseded = (it: RecentItem) =>
    it.key === key ||
    // 서버로 다시 연 게임은 예전에 브라우저로 연 같은 게임을 대신한다.
    (input.kind === "server" && it.kind === "handle" && input.gameKey !== "" &&
      it.gameKey === input.gameKey && it.name === input.name) ||
    // 제목을 모르던(옮겨 온) 브라우저 항목은 같은 폴더 이름으로 다시 열면 채운다.
    (input.kind === "handle" && it.kind === "handle" && it.gameKey === "" && it.name === input.name);
  const pinned = list.some((it) => superseded(it) && it.pinned);
  const item: RecentItem = {
    key,
    kind: input.kind,
    ...(input.kind === "server" ? { path: input.path } : {}),
    name: input.name,
    title: input.title,
    gameKey: input.gameKey,
    openedAt: now,
    pinned,
  };
  return [item, ...list.filter((it) => !superseded(it))];
}

export function removeRecent(list: RecentItem[], key: string): RecentItem[] {
  return list.filter((it) => it.key !== key);
}

export function setPinned(list: RecentItem[], key: string, pinned: boolean): RecentItem[] {
  return list.map((it) => (it.key === key ? { ...it, pinned } : it));
}

/** 보여 줄 두 목록. 둘 다 최근에 연 순서. */
export function splitRecent(list: RecentItem[]): { pinned: RecentItem[]; recent: RecentItem[] } {
  const sorted = [...list].sort((a, b) => b.openedAt - a.openedAt);
  return {
    pinned: sorted.filter((it) => it.pinned),
    recent: sorted.filter((it) => !it.pinned).slice(0, MAX_RECENT),
  };
}

/** 고정 전부 + 최근 MAX_RECENT개만 남긴다. 버린 항목도 돌려준다(브라우저 핸들 정리용). */
export function pruneRecent(list: RecentItem[]): { kept: RecentItem[]; dropped: RecentItem[] } {
  const { pinned, recent } = splitRecent(list);
  const keep = new Set([...pinned, ...recent].map((it) => it.key));
  return { kept: list.filter((it) => keep.has(it.key)), dropped: list.filter((it) => !keep.has(it.key)) };
}

/** 저장된 JSON을 검사해 읽는다. 잘못된 항목은 버린다. */
export function parseRecent(text: string | null): RecentItem[] {
  if (!text) return [];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: RecentItem[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "object" || v === null) continue;
    const o = v as Record<string, unknown>;
    if (typeof o.key !== "string" || seen.has(o.key)) continue;
    if (o.kind !== "server" && o.kind !== "handle") continue;
    if (o.kind === "server" && (typeof o.path !== "string" || o.path === "")) continue;
    seen.add(o.key);
    out.push({
      key: o.key,
      kind: o.kind,
      ...(o.kind === "server" ? { path: o.path as string } : {}),
      name: typeof o.name === "string" ? o.name : "",
      title: typeof o.title === "string" ? o.title : "",
      gameKey: typeof o.gameKey === "string" ? o.gameKey : "",
      openedAt: typeof o.openedAt === "number" ? o.openedAt : 0,
      pinned: o.pinned === true,
    });
  }
  return out;
}
