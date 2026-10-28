import type { CommonEvent } from "../types";
import { parsePluginsJs } from "./installer";
import type { LogRecord } from "./types";

/**
 * 메뉴 화면에서 도는 커먼 이벤트(MenuCommonEvent 플러그인).
 * direct = 플러그인 설정에 적힌 것, called = 그것들이 (커먼 이벤트 호출로) 부르는 것까지 모두(direct 포함).
 */
export interface MenuCommonEvents { direct: ReadonlySet<number>; called: ReadonlySet<number> }

const positiveId = (v: unknown): number | null => {
  const s = String(v ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
};
/** 플러그인 파라미터 값(JSON 글로 겹겹이 싼 것)을 푼다. 못 풀면 그대로. */
const unwrap = (v: unknown): unknown => {
  let cur = v;
  for (let i = 0; i < 3 && typeof cur === "string"; i++) {
    try { cur = JSON.parse(cur); } catch { break; }
  }
  return cur;
};

/**
 * plugins.js 텍스트에서 켜진 MenuCommonEvent의 커먼 이벤트 id들(`CommonEventInfo` / `コモンイベント情報` 목록의
 * CommonEventId). 없으면 []. 예외를 던지지 않는다.
 */
export function menuCommonEventIdsFromPlugins(text: string | null | undefined): number[] {
  try {
    if (typeof text !== "string") return [];
    const out = new Set<number>();
    for (const e of parsePluginsJs(text) ?? []) {
      if (!e || typeof e !== "object" || e.status !== true || typeof e.name !== "string") continue;
      if (!/MenuCommonEvent/i.test(e.name)) continue;
      const params = e.parameters && typeof e.parameters === "object" ? e.parameters as Record<string, unknown> : {};
      const list = unwrap(params.CommonEventInfo ?? params["コモンイベント情報"]);
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const o = unwrap(item);
        if (!o || typeof o !== "object") continue;
        const rec = o as Record<string, unknown>;
        const id = positiveId(rec.CommonEventId ?? rec["コモンイベントID"]);
        if (id !== null) out.add(id);
      }
    }
    return [...out].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** 메뉴 커먼 이벤트 id와 그것들이 부르는 커먼 이벤트(117)까지. id가 없으면 null. 예외를 던지지 않는다. */
export function menuCommonEventsOf(
  ids: readonly number[] | null | undefined, commonEvents: readonly (CommonEvent | null)[] | null | undefined,
): MenuCommonEvents | null {
  try {
    const direct = new Set((Array.isArray(ids) ? ids : []).filter(n => Number.isInteger(n) && n > 0));
    if (direct.size === 0) return null;
    const called = new Set<number>();
    const queue = [...direct];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (called.has(id)) continue;
      called.add(id);
      const ce = Array.isArray(commonEvents) ? commonEvents[id] : null;
      for (const c of Array.isArray(ce?.list) ? ce.list : []) {
        if (c && c.code === 117 && Array.isArray(c.parameters)) {
          const next = positiveId(c.parameters[0]);
          if (next !== null && !called.has(next)) queue.push(next);
        }
      }
    }
    return { direct, called };
  } catch {
    return null;
  }
}

/** 1.17.0+ 기록 플러그인이 메뉴 등(맵·전투가 아닌) 화면에서 쓴 기록 */
const taggedMenu = (r: LogRecord): boolean => {
  const s = (r as { scene?: unknown }).scene;
  return s !== undefined && s !== "map" && s !== "battle";
};

const commonIdOf = (r: LogRecord): number | null | undefined => {
  const src = (r as { src?: unknown }).src;
  if (src === undefined) return undefined;
  if (!src || typeof src !== "object") return null;
  const s = src as { source?: unknown; commonEventId?: unknown };
  return s.source === "common" && typeof s.commonEventId === "number" ? s.commonEventId : null;
};
/** 출처가 없는 기록 중 메뉴를 벗어났다고 볼 것(장소 이동·전투·갈래 시작·맵·전투 화면 기록) */
const ENDS_MENU = new Set(["transfer", "battle", "branchStart", "screen"]);

/**
 * 메뉴 화면의 그림을 뺀 기록. keepMenu(어댑터의 `메뉴 화면 그림도 기록`)면 그대로(같은 배열).
 * - 메뉴 화면 기록(1.17.0+ scene "menu", 예전 screen scene "menu"): 그림 명령(picture)·화면 기록(screen)은 빼고,
 *   대사·선택지·전투 기록은 글은 남기고 그림 묶음만 버린다(대사는 앞 묶음 그대로 = picsSame).
 *   메뉴에서 그림을 지우거나 띄워도 맵의 그림 묶음은 메뉴 전 그대로 이어진다.
 * - 예전 기록(scene 표시 없음): MenuCommonEvent가 부르는 커먼 이벤트(menu.direct)에서 나온 기록부터 메뉴로 보고,
 *   그 뒤 그것들이 부르는 커먼 이벤트(menu.called)의 기록까지 메뉴로 본다. 다른 출처의 기록이 나오면 끝.
 * 예외를 던지지 않는다.
 */
export function withoutMenuRecords(path: LogRecord[], keepMenu: boolean, menu?: MenuCommonEvents | null): LogRecord[] {
  if (!Array.isArray(path)) return [];
  if (keepMenu) return path;
  const out: LogRecord[] = [];
  let changed = false;
  let inMenu = false;
  for (const r of path) {
    try {
      if (!r || typeof r !== "object") { out.push(r); continue; }
      let isMenu = false;
      if (taggedMenu(r)) isMenu = true;
      else {
        const ce = commonIdOf(r);
        if (ce === undefined) {
          if (ENDS_MENU.has(r.type)) inMenu = false;
        } else if (ce !== null && menu && menu.direct.has(ce)) {
          inMenu = true;
        } else if (ce !== null && menu && inMenu && menu.called.has(ce)) {
          /* 메뉴 커먼 이벤트가 부른 것 */
        } else {
          inMenu = false;
        }
        isMenu = inMenu;
      }
      if (!isMenu) { out.push(r); continue; }
      changed = true;
      if (r.type === "picture" || r.type === "screen") continue;
      const o = r as unknown as Record<string, unknown>;
      if (r.type === "message") {
        const { pics: _p, ...rest } = o;
        out.push({ ...rest, picsSame: true } as unknown as LogRecord);
      } else if ("pics" in o || "picsSame" in o) {
        const { pics: _p, picsSame: _s, ...rest } = o;
        out.push(rest as unknown as LogRecord);
      } else {
        out.push(r);
      }
    } catch {
      out.push(r);
    }
  }
  return changed ? out : path;
}
