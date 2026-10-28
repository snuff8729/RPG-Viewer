import type { GameData } from "../types";
import type { LiveActor, LiveSnapshot } from "./types";

/**
 * 치트(뷰어 → 게임, control.json `command { kind: "cheat", ops }`, 플러그인 1.14.0+).
 * 플러그인은 ops를 모두 검사한 뒤(하나라도 틀리면 아무것도 안 바꾸고 `id:failed:<번호>`) 차례로 적용한다.
 */
export const CHEAT_MIN_VERSION = "1.14.0";
/** 명령 하나에 실을 수 있는 op 수(플러그인과 같다) */
export const CHEAT_OPS_MAX = 50;
/** 숫자 한계(플러그인과 같다) */
export const CHEAT_NUM_MAX = 999_999_999;
export const CHEAT_STR_MAX = 1000;
const ID_MAX = 99_999;

export type ItemType = "item" | "weapon" | "armor";
export type CheatOp =
  | { op: "gainItem"; type: ItemType; id: number; amount: number }
  | { op: "setItem"; type: ItemType; id: number; count: number }
  | { op: "gold"; set: number }
  | { op: "gold"; add: number }
  | { op: "level"; actorId: number; level: number }
  | { op: "exp"; actorId: number; add: number }
  | { op: "param"; actorId: number; paramId: number; add: number }
  | { op: "recover"; actorId: number | null }
  | { op: "learnSkill" | "forgetSkill"; actorId: number; skillId: number }
  | { op: "addState" | "removeState"; actorId: number; stateId: number }
  | { op: "switch"; id: number; value: boolean }
  | { op: "variable"; id: number; value: number | string }
  | { op: "selfSwitch"; mapId: number; eventId: number; letter: "A" | "B" | "C" | "D"; value: boolean };

/** 능력치 이름(paramId 0~7) */
export const PARAM_NAMES = ["최대 HP", "최대 MP", "공격력", "방어력", "마법 공격력", "마법 방어력", "민첩성", "운"] as const;
export const ITEM_TYPE_LABEL: Record<ItemType, string> = { item: "아이템", weapon: "무기", armor: "방어구" };

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** 이 id의 데이터베이스 항목이 있는가(목록이 없으면 판단하지 않고 범위만 본다) */
function exists(list: readonly unknown[] | undefined, id: unknown): boolean {
  if (!isInt(id, 1, ID_MAX)) return false;
  if (!list) return true;
  return id < list.length && !!list[id];
}

function itemList(data: GameData | null, type: unknown): readonly unknown[] | undefined | false {
  if (type !== "item" && type !== "weapon" && type !== "armor") return false;
  if (!data) return undefined;
  return type === "item" ? data.items : type === "weapon" ? data.weapons : data.armors;
}

function systemMax(names: unknown): number {
  return Array.isArray(names) && names.length > 1 ? names.length - 1 : ID_MAX;
}

/**
 * 플러그인이 받아들일 op인가(모양·범위·데이터베이스에 있는 id). data가 없으면 id 존재는 보지 않는다. 예외를 던지지 않는다.
 */
export function validCheatOp(op: unknown, data: GameData | null = null): op is CheatOp {
  try {
    if (!isObj(op)) return false;
    const N = CHEAT_NUM_MAX;
    switch (op.op) {
      case "gainItem":
      case "setItem": {
        const list = itemList(data, op.type);
        if (list === false || !exists(list, op.id)) return false;
        return op.op === "gainItem" ? isInt(op.amount, -N, N) : isInt(op.count, 0, N);
      }
      case "gold": {
        const s = has(op, "set"), a = has(op, "add");
        if (s === a) return false;
        return s ? isInt(op.set, 0, N) : isInt(op.add, -N, N);
      }
      case "recover":
        return op.actorId === null || exists(data?.actors, op.actorId);
      case "level":
        return exists(data?.actors, op.actorId) && isInt(op.level, 1, 9999);
      case "exp":
        return exists(data?.actors, op.actorId) && isInt(op.add, -N, N);
      case "param":
        return exists(data?.actors, op.actorId) && isInt(op.paramId, 0, 7) && isInt(op.add, -N, N);
      case "learnSkill":
      case "forgetSkill":
        return exists(data?.actors, op.actorId) && exists(data?.skills, op.skillId);
      case "addState":
      case "removeState":
        return exists(data?.actors, op.actorId) && exists(data?.states, op.stateId);
      case "switch":
        return isInt(op.id, 1, systemMax(data?.system?.switches)) && typeof op.value === "boolean";
      case "variable":
        return isInt(op.id, 1, systemMax(data?.system?.variables))
          && (isInt(op.value, -N, N) || (typeof op.value === "string" && op.value.length <= CHEAT_STR_MAX));
      case "selfSwitch":
        return isInt(op.mapId, 1, ID_MAX) && isInt(op.eventId, 1, ID_MAX)
          && (op.letter === "A" || op.letter === "B" || op.letter === "C" || op.letter === "D") && typeof op.value === "boolean";
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/** control.json에 실을 ops: 배열이고 1~50개, 모두 올바르면 그대로, 아니면 null. */
export function cheatOpsForControl(ops: unknown): CheatOp[] | null {
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > CHEAT_OPS_MAX) return null;
  return ops.every((o) => validCheatOp(o)) ? (ops as CheatOp[]) : null;
}

const nameOf = (list: readonly unknown[] | undefined, id: number, fallback: string): string => {
  const e = list?.[id];
  const n = isObj(e) && typeof e.name === "string" && e.name.trim() !== "" ? e.name : null;
  return n ?? `${fallback} ${id}`;
};
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** 사람이 읽는 op 설명(기록 목록용). 예외를 던지지 않는다. */
export function describeCheatOp(op: CheatOp, data: GameData | null): string {
  try {
    const actor = (id: number) => nameOf(data?.actors, id, "캐릭터");
    switch (op.op) {
      case "gainItem": return `${nameOf(itemList(data, op.type) || undefined, op.id, ITEM_TYPE_LABEL[op.type])} ${signed(op.amount)}`;
      case "setItem": return `${nameOf(itemList(data, op.type) || undefined, op.id, ITEM_TYPE_LABEL[op.type])} → ${op.count}개`;
      case "gold": return "set" in op ? `돈 → ${op.set}` : `돈 ${signed(op.add)}`;
      case "level": return `${actor(op.actorId)} 레벨 → ${op.level}`;
      case "exp": return `${actor(op.actorId)} 경험치 ${signed(op.add)}`;
      case "param": return `${actor(op.actorId)} ${PARAM_NAMES[op.paramId] ?? "능력치"} ${signed(op.add)}`;
      case "recover": return op.actorId === null ? "파티 전부 회복" : `${actor(op.actorId)} 전부 회복`;
      case "learnSkill": return `${actor(op.actorId)} ${nameOf(data?.skills, op.skillId, "기술")} 배우기`;
      case "forgetSkill": return `${actor(op.actorId)} ${nameOf(data?.skills, op.skillId, "기술")} 잊기`;
      case "addState": return `${actor(op.actorId)} ${nameOf(data?.states, op.stateId, "상태")} 걸기`;
      case "removeState": return `${actor(op.actorId)} ${nameOf(data?.states, op.stateId, "상태")} 풀기`;
      case "switch": return `스위치 ${op.id} ${op.value ? "켜기" : "끄기"}`;
      case "variable": return `변수 ${op.id} = ${typeof op.value === "string" ? JSON.stringify(op.value) : op.value}`;
      case "selfSwitch": return `셀프 스위치 ${op.mapId}-${op.eventId}-${op.letter} ${op.value ? "켜기" : "끄기"}`;
    }
  } catch {
    /* 아래 */
  }
  return "치트";
}

/** live.json의 지금 개수(없으면 0) */
export function liveCount(live: LiveSnapshot | null, type: ItemType, id: number): number {
  const m = type === "item" ? live?.items : type === "weapon" ? live?.weapons : live?.armors;
  const v = isObj(m) ? m[String(id)] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * 되돌리기 op: 적용 전 live 상태(before) 기준. 아이템·돈·스위치·변수·셀프 스위치는 그때 값으로 되돌리고,
 * 능력치는 반대로 더한다. 레벨·경험치·회복·기술·상태는 되돌릴 수 없다 → 하나라도 있으면 null.
 * before가 없으면(연결 안 됨) 능력치만 되돌릴 수 있다. 예외를 던지지 않는다.
 */
export function inverseCheatOps(ops: readonly CheatOp[], before: LiveSnapshot | null): CheatOp[] | null {
  try {
    const out: CheatOp[] = [];
    const seen = new Set<string>();
    for (const op of ops) {
      if (op.op === "param") {
        out.push({ op: "param", actorId: op.actorId, paramId: op.paramId, add: -op.add });
        continue;
      }
      if (!before) return null;
      // 같은 대상을 여러 번 바꿔도 처음 값 하나로 되돌린다
      let key: string;
      let inv: CheatOp;
      if (op.op === "gainItem" || op.op === "setItem") {
        key = `item:${op.type}:${op.id}`;
        inv = { op: "setItem", type: op.type, id: op.id, count: liveCount(before, op.type, op.id) };
      } else if (op.op === "gold") {
        key = "gold";
        inv = { op: "gold", set: typeof before.gold === "number" && before.gold >= 0 ? before.gold : 0 };
      } else if (op.op === "switch") {
        key = `switch:${op.id}`;
        inv = { op: "switch", id: op.id, value: Array.isArray(before.switches) && before.switches.includes(op.id) };
      } else if (op.op === "variable") {
        key = `variable:${op.id}`;
        const v = isObj(before.variables) ? before.variables[String(op.id)] : undefined;
        inv = { op: "variable", id: op.id, value: typeof v === "number" && Number.isFinite(v) ? v : 0 };
      } else if (op.op === "selfSwitch") {
        key = `self:${op.mapId},${op.eventId},${op.letter}`;
        inv = { op: "selfSwitch", mapId: op.mapId, eventId: op.eventId, letter: op.letter, value: Array.isArray(before.selfSwitches) && before.selfSwitches.includes(key.slice(5)) };
      } else {
        return null;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(inv);
    }
    return out.length > 0 ? out.reverse() : null;
  } catch {
    return null;
  }
}

/** 되돌릴 수 없는 op 종류가 있는가(레벨 등) — 기록 목록에 "되돌릴 수 없어요"를 보인다 */
export const undoable = (ops: readonly CheatOp[]): boolean =>
  ops.every((o) => o.op === "param" || o.op === "gainItem" || o.op === "setItem" || o.op === "gold" || o.op === "switch" || o.op === "variable" || o.op === "selfSwitch");

// ── 검색 ──

export interface SearchEntry { id: number; name: string; description?: string; iconIndex?: number }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/**
 * 이름·설명·아이콘 번호·id로 찾는다. 순위: id나 이름이 같음 → 이름이 그걸로 시작 → 이름에 들어 있음 → 설명에 들어 있음 → 아이콘 번호.
 * 같은 순위는 id 순. 빈 검색어면 이름 있는 항목 전부(id 순). 이름 없는 항목은 검색어가 id일 때만. 예외를 던지지 않는다.
 */
export function searchEntries<T extends SearchEntry>(list: readonly (T | null | undefined)[] | undefined, query: string, limit = 200): T[] {
  return scoreAll(list, norm(typeof query === "string" ? query : ""))
    .sort((a, b) => a.s - b.s || a.e.id - b.e.id)
    .slice(0, Math.max(0, limit)).map((x) => x.e);
}

/** 검색 순위(작을수록 앞, -1 = 안 맞음). q는 norm한 검색어. */
function score(e: SearchEntry, q: string): number {
  const n = norm(typeof e.name === "string" ? e.name : "");
  if (q === "") return n === "" ? -1 : 0;
  if (String(e.id) === q || n === q) return 0;
  if (n !== "" && n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  if (typeof e.description === "string" && norm(e.description).includes(q)) return 3;
  if (typeof e.iconIndex === "number" && String(e.iconIndex) === q) return 4;
  return -1;
}

function scoreAll<T extends SearchEntry>(list: readonly (T | null | undefined)[] | undefined, q: string): { e: T; s: number }[] {
  const out: { e: T; s: number }[] = [];
  for (const e of list ?? []) {
    if (!isObj(e) || typeof e.id !== "number") continue;
    const s = score(e, q);
    if (s >= 0) out.push({ e, s });
  }
  return out;
}

export interface ItemHit { type: ItemType; entry: SearchEntry }
const ITEM_TYPES: readonly ItemType[] = ["item", "weapon", "armor"];

/** 아이템·무기·방어구를 함께(또는 한 종류만) 찾는다. 순위는 searchEntries와 같고, 같은 순위는 아이템 → 무기 → 방어구, id 순. */
export function searchItems(data: GameData | null, type: ItemType | "all", query: string, limit = 200): ItemHit[] {
  try {
    const q = norm(typeof query === "string" ? query : "");
    const all: { hit: ItemHit; s: number; t: number }[] = [];
    ITEM_TYPES.forEach((t, ti) => {
      if (type !== "all" && type !== t) return;
      const list = itemList(data, t);
      for (const { e, s } of scoreAll((list || undefined) as readonly (SearchEntry | null)[] | undefined, q)) all.push({ hit: { type: t, entry: e }, s, t: ti });
    });
    all.sort((a, b) => a.s - b.s || a.t - b.t || a.hit.entry.id - b.hit.entry.id);
    return all.slice(0, Math.max(0, limit)).map((x) => x.hit);
  } catch {
    return [];
  }
}

/** "모든 아이템 99개": 이름 있는 항목 전부를 99개로 */
export function fillAllOps(data: GameData | null, type: ItemType, count = 99): CheatOp[] {
  const list = itemList(data, type) || [];
  const ops: CheatOp[] = [];
  for (const e of list) {
    if (isObj(e) && typeof e.id === "number" && typeof e.name === "string" && e.name.trim() !== "") ops.push({ op: "setItem", type, id: e.id, count });
  }
  return ops;
}

/** 스위치·변수 이름 목록(System.json) → 검색 항목(빈 이름도 id로 찾을 수 있게 포함) */
export function systemEntries(names: readonly unknown[] | undefined): SearchEntry[] {
  const out: SearchEntry[] = [];
  if (!Array.isArray(names)) return out;
  for (let i = 1; i < names.length; i++) out.push({ id: i, name: typeof names[i] === "string" ? (names[i] as string) : "" });
  return out;
}

/** 스위치·변수 검색: 빈 이름도 보인다(이름 있는 것 먼저). */
export function searchSystem(names: readonly unknown[] | undefined, query: string, limit = 200): SearchEntry[] {
  const all = systemEntries(names);
  const q = norm(query);
  if (q === "") return [...all].sort((a, b) => Number(a.name === "") - Number(b.name === "") || a.id - b.id).slice(0, limit);
  return searchEntries(all, query, limit);
}

// ── 캐릭터 값 ──

/** live.json의 캐릭터(없으면 null) */
export function liveActor(live: LiveSnapshot | null, actorId: number): LiveActor | null {
  const list = Array.isArray(live?.actors) ? live.actors : [];
  return list.find((a) => isObj(a) && a.id === actorId) ?? null;
}

/** 데이터베이스 기본 능력치(직업 곡선, 레벨): 연결 정보가 없을 때 보인다. 없으면 null. */
export function baseParams(data: GameData | null, actorId: number, level?: number): number[] | null {
  try {
    const a: any = data?.actors?.[actorId];
    if (!isObj(a)) return null;
    const cls: any = data?.classes?.[a.classId];
    const lv = typeof level === "number" ? level : typeof a.initialLevel === "number" ? a.initialLevel : 1;
    if (!isObj(cls) || !Array.isArray(cls.params)) return null;
    const out: number[] = [];
    for (let p = 0; p < 8; p++) {
      const row = cls.params[p];
      const v = Array.isArray(row) ? row[lv] : undefined;
      out.push(typeof v === "number" ? v : 0);
    }
    return out;
  } catch {
    return null;
  }
}

// ── 보낸 명령과 응답 ──

export type CheatStatus = "queued" | "sent" | "applied" | "ignored" | "failed" | "notApplied" | "noResponse";
export const CHEAT_STATUS_TEXT: Record<CheatStatus, string> = {
  queued: "기다리는 중…",
  sent: "보냄…",
  applied: "적용됨",
  ignored: "게임에서 무시함",
  failed: "실패",
  notApplied: "적용 안 됨",
  noResponse: "응답 없음",
};

/** 한 번에 보낸 명령: 여러 기록(entry)의 ops를 이어 붙인 것. entry마다 ops 범위 [from, to). */
export interface CheatBatch { id: string; at: number; ops: CheatOp[]; entries: { key: string; from: number; to: number }[] }

/**
 * 기다리는 기록들을 명령 하나로 묶는다(앞에서부터 ops 합이 CHEAT_OPS_MAX를 넘지 않을 때까지, 최소 한 기록).
 * 기록 하나가 50개를 넘으면 그 기록은 앞 50개만 싣지 않고 통째로 뺀다 → 호출하는 쪽이 미리 나눈다(splitOps).
 */
export function makeBatch(queue: readonly { key: string; ops: CheatOp[] }[], id: string, at: number): { batch: CheatBatch; rest: { key: string; ops: CheatOp[] }[] } | null {
  const ops: CheatOp[] = [];
  const entries: CheatBatch["entries"] = [];
  let i = 0;
  for (; i < queue.length; i++) {
    const q = queue[i];
    if (q.ops.length === 0 || q.ops.length > CHEAT_OPS_MAX) continue;
    if (ops.length + q.ops.length > CHEAT_OPS_MAX) break;
    entries.push({ key: q.key, from: ops.length, to: ops.length + q.ops.length });
    ops.push(...q.ops);
  }
  if (entries.length === 0) return null;
  return { batch: { id, at, ops, entries }, rest: queue.slice(i) };
}

/** ops를 CHEAT_OPS_MAX개씩 나눈다 */
export function splitOps(ops: readonly CheatOp[]): CheatOp[][] {
  const out: CheatOp[][] = [];
  for (let i = 0; i < ops.length; i += CHEAT_OPS_MAX) out.push(ops.slice(i, i + CHEAT_OPS_MAX));
  return out;
}

/**
 * live.json `assist.lastCommand`로 묶음의 기록별 결과. 아직 응답이 없으면 null.
 * failed:<k>: op k를 담은 기록은 실패, 나머지는 적용 안 됨(플러그인은 검사에서 하나라도 틀리면 아무것도 바꾸지 않는다.
 * 드물게 적용 중 게임 오류로 멈추면 k 앞 op는 이미 적용됐을 수 있지만 응답으로는 구분하지 못한다).
 */
export function batchResults(batch: CheatBatch, lastCommand: unknown): Map<string, CheatStatus> | null {
  if (typeof lastCommand !== "string") return null;
  const out = new Map<string, CheatStatus>();
  if (lastCommand === batch.id) {
    for (const e of batch.entries) out.set(e.key, "applied");
    return out;
  }
  if (lastCommand === `${batch.id}:ignored`) {
    for (const e of batch.entries) out.set(e.key, "ignored");
    return out;
  }
  const m = lastCommand.startsWith(`${batch.id}:failed`) ? /^:failed(?::(\d+))?$/.exec(lastCommand.slice(batch.id.length)) : null;
  if (!m) return null;
  const k = m[1] === undefined ? -1 : Number(m[1]);
  for (const e of batch.entries) out.set(e.key, k >= e.from && k < e.to ? "failed" : "notApplied");
  return out;
}
