import { parsePluginsJs } from "../live/installer";
import type { LogRecord } from "../live/types";
import type { SystemData } from "../types";

/**
 * 화면 그림 따라 그리기(플러그인 1.6.0+): 대사(message)·선택지(choices) 기록의 `pics`(바뀐 그림 전체) / `picsSame`(앞과 같음)을
 * 읽어 대사마다 그때 화면에 떠 있던 그림 묶음을 만든다. 1.6.0은 Game_Picture 값, 1.7.0+는 실제로 그려진 스프라이트 값(크기 포함).
 * 그림은 이벤트 그림(cg)·스탠딩(stand)·화면 장식(hud)·숨김(hidden)으로 나눠 보인다. 모두 예외를 던지지 않는다.
 */

/** 화면에 떠 있는 그림 하나. origin 0 = 왼쪽 위, 1 = 가운데. blendMode 0 보통, 1 더하기, 2 곱하기, 3 스크린. */
export interface ScreenPicture {
  id: number; name: string; origin: number; x: number; y: number;
  scaleX: number; scaleY: number; opacity: number; blendMode: number;
  /** [빨강, 초록, 파랑, 회색] -255~255(회색 0~255). 없으면 색조 없음. */
  tone?: [number, number, number, number];
  /** 회전 각도(도). 없으면 0. */
  angle?: number;
  /** 기준점(0~1). 왼쪽 위(0,0)·가운데(0.5,0.5)가 아닐 때만(1.7.0+ 스프라이트 anchor) */
  anchor?: [number, number];
  /** 그림 크기(px, 1.7.0+). 없으면 그림 파일에서 읽은 크기를 쓴다. */
  w?: number; h?: number;
}

const MAX_PICS = 60;
const fin = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * 기록의 그림 하나(`[id, name, origin, x, y, scaleX, scaleY, opacity, blendMode, tone?, angle?, w?, h?]`) → ScreenPicture.
 * origin은 0·1 또는 [anchorX, anchorY](1.7.0+). 이상하면 null.
 */
export function parsePic(e: unknown): ScreenPicture | null {
  if (!Array.isArray(e)) return null;
  const id = e[0], name = e[1];
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || typeof name !== "string" || name === "") return null;
  let origin = fin(e[2], 0) === 1 ? 1 : 0;
  let anchor: [number, number] | null = null;
  if (Array.isArray(e[2]) && e[2].length >= 2) {
    const ax = fin(e[2][0], 0), ay = fin(e[2][1], 0);
    if (ax === 0.5 && ay === 0.5) origin = 1;
    else if (ax !== 0 || ay !== 0) anchor = [ax, ay];
  }
  const p: ScreenPicture = {
    id, name, origin, x: fin(e[3], 0), y: fin(e[4], 0),
    scaleX: fin(e[5], 100), scaleY: fin(e[6], 100), opacity: Math.max(0, Math.min(255, fin(e[7], 255))),
    blendMode: [0, 1, 2, 3].includes(e[8]) ? e[8] : 0,
  };
  const t = e[9];
  if (Array.isArray(t) && t.length >= 3) {
    const tone: [number, number, number, number] = [fin(t[0], 0), fin(t[1], 0), fin(t[2], 0), fin(t[3], 0)];
    if (tone.some(v => v !== 0)) p.tone = tone;
  }
  const angle = fin(e[10], 0);
  if (angle !== 0) p.angle = angle;
  if (anchor) p.anchor = anchor;
  const w = fin(e[11], 0), h = fin(e[12], 0);
  if (w > 0 && h > 0) { p.w = w; p.h = h; }
  return p;
}

/** 기록의 `pics` 배열 → 그림 번호 순 묶음(최대 60개, 같은 번호는 뒤의 것, 투명도 0은 안 보이므로 뺀다). 배열이 아니면 null. */
export function parsePics(v: unknown): ScreenPicture[] | null {
  if (!Array.isArray(v)) return null;
  const byId = new Map<number, ScreenPicture>();
  for (const e of v.slice(0, MAX_PICS)) {
    const p = parsePic(e);
    if (p && p.opacity > 0) byId.set(p.id, p);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * 경로 기록(seq 순)을 따라가며 대사마다 그때 화면 그림 묶음을 만든다: message seq → 그림 묶음.
 * - `pics`가 있으면 그것으로 바꾸고, `picsSame`이면 앞의 것을 그대로 쓴다(같은 배열).
 * - 둘 다 없는 대사(기능이 꺼졌거나 구버전·전투 중)는 모름 — 지도에 넣지 않고 앞의 묶음도 잊는다.
 * - 갈래 시작(branchStart)은 앞의 묶음을 잊는다(플러그인도 갈래마다 처음부터 쓴다).
 * - 선택지(choices)의 `pics`는 묶음만 바꾼다.
 * - 1.8.0 전투 시작·끝(battle)·전투 로그(battlelog)도 pics/picsSame이 있으면 그 seq에 넣는다(없으면 묶음은 그대로).
 */
export function picturesBySeq(path: LogRecord[]): Map<number, ScreenPicture[]> {
  const out = new Map<number, ScreenPicture[]>();
  let cur: ScreenPicture[] | null = null;
  for (const r of Array.isArray(path) ? path : []) {
    try {
      if (!r || typeof r !== "object") continue;
      const o = r as unknown as Record<string, unknown>;
      if (r.type === "branchStart") { cur = null; continue; }
      if (r.type === "choices") {
        const p = parsePics(o.pics);
        if (p) cur = p;
        continue;
      }
      // 1.8.0 전투: 시작·끝은 pics/picsSame, 전투 로그 줄은 그림이 바뀌었을 때만 pics. 둘 다 없으면 묶음은 그대로(지도에 안 넣음)
      if (r.type === "battle" || r.type === "battlelog") {
        const p = parsePics(o.pics);
        if (p) cur = p;
        if (cur && (p || o.picsSame === true)) out.set(r.seq, cur);
        continue;
      }
      if (r.type !== "message") continue;
      const p = parsePics(o.pics);
      if (p) cur = p;
      else if (o.picsSame !== true) cur = null;
      if (cur) out.set(r.seq, cur);
    } catch { /* 깨진 기록은 건너뛴다 */ }
  }
  return out;
}

/** 두 묶음이 같은 화면인가 */
export function samePictures(a: ScreenPicture[] | null | undefined, b: ScreenPicture[] | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface ScreenSize { width: number; height: number }
/** MV·MZ 기본 화면 크기 */
export const DEFAULT_SCREEN: ScreenSize = { width: 816, height: 624 };

// ---------------------------------------------------------------- 그림 구분

/** 그림 구분. cg = 이벤트 그림(화면 대부분을 덮는 그림), stand = 스탠딩, hud = 화면 장식(그리지 않음), hidden = 숨김 */
export type PictureRole = "cg" | "stand" | "hud" | "hidden";
/** 게임별 그림 번호 → 직접 고른 구분(자동이면 없음) */
export type PictureRoles = Record<number, PictureRole>;
export const PICTURE_ROLES: readonly PictureRole[] = ["cg", "stand", "hud", "hidden"];
export const isPictureRole = (v: unknown): v is PictureRole => PICTURE_ROLES.includes(v as PictureRole);

export interface PicSize { w: number; h: number }
/** 그림 이름 → 크기(그림 파일에서 읽은 것). 모르면 null. */
export type SizeOf = (name: string) => PicSize | null | undefined;

/** 그림 구분에 쓰는 것: 화면 크기, 직접 고른 구분, 화면 장식으로 본 그림(hudKeys), 그림 크기 */
export interface PictureContext {
  screen: ScreenSize;
  roles?: PictureRoles | null;
  hud?: ReadonlySet<string> | null;
  sizeOf?: SizeOf | null;
}

interface Rect { left: number; top: number; right: number; bottom: number }

function sizeOfPic(p: ScreenPicture, sizeOf: SizeOf | null | undefined): PicSize | null {
  if (p.w && p.h) return { w: p.w, h: p.h };
  try {
    const s = sizeOf?.(p.name);
    return s && s.w > 0 && s.h > 0 ? s : null;
  } catch {
    return null;
  }
}

/** 그림이 화면에서 차지하는 사각형(회전 포함). 크기를 모르면 null. */
export function pictureRect(p: ScreenPicture, sizeOf?: SizeOf | null): Rect | null {
  const s = sizeOfPic(p, sizeOf);
  if (!s) return null;
  const [ax, ay] = p.anchor ?? (p.origin === 1 ? [0.5, 0.5] : [0, 0]);
  const sx = p.scaleX / 100, sy = p.scaleY / 100;
  const rad = ((p.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [u, v] of [[0, 0], [s.w, 0], [0, s.h], [s.w, s.h]]) {
    const dx = (u - ax * s.w) * sx, dy = (v - ay * s.h) * sy;
    const X = p.x + dx * cos - dy * sin, Y = p.y + dx * sin + dy * cos;
    left = Math.min(left, X); right = Math.max(right, X); top = Math.min(top, Y); bottom = Math.max(bottom, Y);
  }
  return { left, top, right, bottom };
}

function clip(r: Rect, screen: ScreenSize): Rect | null {
  const c = { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(screen.width, r.right), bottom: Math.min(screen.height, r.bottom) };
  return c.right > c.left && c.bottom > c.top ? c : null;
}

/** 사각형이 화면을 덮는 비율(0~1) */
function coverage(r: Rect, screen: ScreenSize): number {
  const c = clip(r, screen);
  const area = screen.width * screen.height;
  return c && area > 0 ? ((c.right - c.left) * (c.bottom - c.top)) / area : 0;
}

/** 화면 장식 판정에 쓰는 그림 열쇠: 번호·이름·위치가 같으면 같은 장식 */
export const hudKeyOf = (p: ScreenPicture): string => `${p.id}|${p.name}|${p.x}|${p.y}`;

const HUD_SHARE = 0.7, HUD_AREA = 0.15, HUD_MIN_SNAPSHOTS = 5, CG_COVER = 0.8, OCCLUDE_COVER = 0.95;

/**
 * 게임 기록 전체(갈래마다 따로 따라간다)의 대사별 화면 그림 묶음과 그 수: 묶음(같은 배열) → 그 묶음이 보인 대사 수.
 * 화면 장식 판정과 설정 화면의 `최근 본 그림`에 쓴다.
 */
export function snapshotCounts(records: LogRecord[]): Map<ScreenPicture[], number> {
  const byBranch = new Map<number, LogRecord[]>();
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r !== "object") continue;
    const list = byBranch.get(r.branch);
    if (list) list.push(r); else byBranch.set(r.branch, [r]);
  }
  const out = new Map<ScreenPicture[], number>();
  for (const list of byBranch.values()) {
    for (const pics of picturesBySeq(list).values()) out.set(pics, (out.get(pics) ?? 0) + 1);
  }
  return out;
}

/**
 * 화면 장식(HUD): 같은 번호·이름·위치로 대사 묶음의 70% 이상에 떠 있고 화면의 15%보다 작은 그림(크기를 모르면 아님).
 * 대사가 5개보다 적으면 판정하지 않는다.
 */
export function hudKeys(counts: Map<ScreenPicture[], number>, screen: ScreenSize, sizeOf?: SizeOf | null): Set<string> {
  const out = new Set<string>();
  try {
    let total = 0;
    const seen = new Map<string, { n: number; p: ScreenPicture }>();
    for (const [pics, n] of counts) {
      total += n;
      for (const p of pics) {
        const k = hudKeyOf(p);
        const e = seen.get(k);
        if (e) e.n += n; else seen.set(k, { n, p });
      }
    }
    if (total < HUD_MIN_SNAPSHOTS) return out;
    for (const [k, { n, p }] of seen) {
      if (n / total < HUD_SHARE) continue;
      const r = pictureRect(p, sizeOf);
      if (!r) continue;
      const area = screen.width * screen.height;
      const own = (r.right - r.left) * (r.bottom - r.top);
      if (area > 0 && own / area < HUD_AREA) out.add(k);
    }
  } catch { /* 판정 없음 */ }
  return out;
}

/** 그림 하나의 구분: 직접 고른 구분 → 화면 장식 → 화면의 80% 이상을 덮으면 이벤트 그림 → 나머지는 스탠딩 */
export function roleOf(p: ScreenPicture, ctx: PictureContext): PictureRole {
  const o = ctx.roles?.[p.id];
  if (isPictureRole(o)) return o;
  if (ctx.hud?.has(hudKeyOf(p))) return "hud";
  const r = pictureRect(p, ctx.sizeOf);
  if (r && coverage(r, ctx.screen) >= CG_COVER) return "cg";
  return "stand";
}

/** 대사 하나의 보이는 화면: 이벤트 그림과 스탠딩(각각 그리는 순서) */
export interface ScreenScene { cg: ScreenPicture[]; stand: ScreenPicture[] }

/**
 * 그림 묶음 → 보이는 화면. 화면 장식·숨김과 투명도 0은 빼고, 위에(뒤 번호로) 화면의 95% 이상을 덮는
 * 불투명(255·보통 합성) 그림 아래에 완전히 가려진 그림도 뺀다(덮는 그림의 투명한 부분은 알 수 없어 아래 그림만 가린다고 본다).
 */
export function sceneOf(pics: ScreenPicture[] | null | undefined, ctx: PictureContext): ScreenScene {
  const scene: ScreenScene = { cg: [], stand: [] };
  try {
    const drawn: { p: ScreenPicture; role: "cg" | "stand"; rect: Rect | null }[] = [];
    for (const p of [...(pics ?? [])].sort((a, b) => a.id - b.id)) {
      if (!p || p.opacity <= 0) continue;
      const role = roleOf(p, ctx);
      if (role === "cg" || role === "stand") drawn.push({ p, role, rect: pictureRect(p, ctx.sizeOf) });
    }
    const covers = drawn.map(d => d.rect !== null && d.p.opacity >= 255 && d.p.blendMode === 0 && coverage(d.rect, ctx.screen) >= OCCLUDE_COVER);
    for (let i = 0; i < drawn.length; i++) {
      const own = drawn[i].rect ? clip(drawn[i].rect!, ctx.screen) : null;
      let hidden = false;
      for (let j = i + 1; j < drawn.length && !hidden; j++) {
        if (!covers[j]) continue;
        const c = drawn[j].rect!;
        // 크기를 모르는 그림이나 화면 밖 그림은 거의 전체를 덮는 그림 아래에서 가려진 것으로 본다
        hidden = !own || (own.left >= c.left - 1 && own.top >= c.top - 1 && own.right <= c.right + 1 && own.bottom <= c.bottom + 1);
      }
      if (!hidden) scene[drawn[i].role].push(drawn[i].p);
    }
  } catch { /* 보이는 것 없음 */ }
  return scene;
}

/** 대사별 화면 그림 묶음 → 대사별 보이는 화면(같은 묶음은 한 번만 계산한다) */
export function scenesBySeq(pictures: Map<number, ScreenPicture[]>, ctx: PictureContext): Map<number, ScreenScene> {
  const out = new Map<number, ScreenScene>();
  const cache = new Map<ScreenPicture[], ScreenScene>();
  for (const [seq, pics] of pictures) {
    let s = cache.get(pics);
    if (!s) { s = sceneOf(pics, ctx); cache.set(pics, s); }
    out.set(seq, s);
  }
  return out;
}

/** 읽기에 보일 그림: cg = 화면 크기 그대로(위에 보이는 스탠딩 포함), stand = 스탠딩 겹만 잘라서 */
export interface ScreenShot { kind: "cg" | "stand"; pictures: ScreenPicture[] }

/**
 * 앞에 보인 것(key)과 비교해 이 대사에 새로 보일 그림을 정한다.
 * - 이벤트 그림이 있으면: 이벤트 그림 + 그 위에 보이는 스탠딩을 화면 그대로. 둘 중 하나라도 바뀌면 다시 보인다.
 * - 이벤트 그림이 없고 스탠딩만 있으면: 스탠딩 겹(이름·투명도·위치…)이 바뀔 때만 다시 보인다(다른 그림 변화는 무시).
 * - 아무것도 없으면 보이지 않고, 다음에 나타날 때 다시 보인다. scene이 null(모름)이면 key도 null.
 */
export function nextShot(prevKey: string | null, scene: ScreenScene | null | undefined): { shot: ScreenShot | null; key: string | null } {
  if (!scene) return { shot: null, key: null };
  try {
    if (scene.cg.length > 0) {
      const pictures = [...scene.cg, ...scene.stand].sort((a, b) => a.id - b.id);
      const key = "cg:" + JSON.stringify(pictures);
      return { shot: key === prevKey ? null : { kind: "cg", pictures }, key };
    }
    if (scene.stand.length > 0) {
      const key = "stand:" + JSON.stringify(scene.stand);
      return { shot: key === prevKey ? null : { kind: "stand", pictures: scene.stand }, key };
    }
  } catch { /* 없음으로 */ }
  return { shot: null, key: "" };
}

/** 두 보일 그림이 같은가 */
export function sameShot(a: ScreenShot | null | undefined, b: ScreenShot | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.kind === b.kind && samePictures(a.pictures, b.pictures);
}

/** 설정 화면용: 최근 본 그림 번호와 이름들(최근 것부터, 번호마다 이름 최대 3개) */
export interface SeenPicture { id: number; names: string[]; auto: PictureRole }

/**
 * 기록에서 최근 본 그림 번호 목록(번호 순). auto = 직접 고르지 않았을 때의 자동 구분(가장 최근 모습 기준).
 * limit: 최근 대사 묶음 몇 개까지 볼지.
 */
export function seenPictures(records: LogRecord[], ctx: PictureContext, limit = 2000): SeenPicture[] {
  const byId = new Map<number, { names: string[]; last: ScreenPicture }>();
  try {
    const recent: ScreenPicture[][] = [];
    const list = Array.isArray(records) ? records : [];
    // 끝에서부터 pics가 있는 기록만 모은다(picsSame은 앞의 것과 같다)
    for (let i = list.length - 1; i >= 0 && recent.length < limit; i--) {
      const o = list[i] as unknown as Record<string, unknown> | null;
      if (!o || (o.type !== "message" && o.type !== "choices" && o.type !== "battle" && o.type !== "battlelog")) continue;
      const p = parsePics(o.pics);
      if (p) recent.push(p);
    }
    for (const pics of recent) {
      for (const p of pics) {
        const e = byId.get(p.id);
        if (!e) byId.set(p.id, { names: [p.name], last: p });
        else if (e.names.length < 3 && !e.names.includes(p.name)) e.names.push(p.name);
      }
    }
  } catch { /* 모은 데까지 */ }
  const noRoles: PictureContext = { ...ctx, roles: null };
  return [...byId.entries()].sort((a, b) => a[0] - b[0]).map(([id, e]) => ({ id, names: e.names, auto: roleOf(e.last, noRoles) }));
}

/** 번호가 이어지는(간격 2 이하) 그림끼리 묶는다: 60 | 101–103 | 111–143 */
export function groupById<T extends { id: number }>(items: T[]): T[][] {
  const out: T[][] = [];
  for (const it of [...items].sort((a, b) => a.id - b.id)) {
    const last = out[out.length - 1];
    if (last && it.id - last[last.length - 1].id <= 2) last.push(it);
    else out.push([it]);
  }
  return out;
}

/** PNG 머리(IHDR)에서 크기를 읽는다. PNG가 아니면 null. */
export function pngSize(bytes: Uint8Array | null | undefined): PicSize | null {
  if (!bytes || bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;
  const u32 = (o: number) => ((bytes[o] << 24) >>> 0) + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3];
  const w = u32(16), h = u32(20);
  return w > 0 && h > 0 && w <= 65535 && h <= 65535 ? { w, h } : null;
}

const dim = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 100 && n <= 8192 ? Math.round(n) : null;
};

/**
 * 게임 화면 크기: MZ System.json `advanced.screenWidth/Height` → plugins.js의 켜진 플러그인 파라미터
 * (YEP_CoreEngine `Screen Width/Height`, Community_Basic `screenWidth/Height` 등 이름에 screen·width/height가 든 것) → 기본 816×624.
 */
export function screenSizeOf(system: SystemData | null | undefined, pluginsText: string | null | undefined): ScreenSize {
  try {
    const adv = system?.advanced as Record<string, unknown> | undefined;
    if (adv && typeof adv === "object") {
      const w = dim(adv.screenWidth), h = dim(adv.screenHeight);
      if (w && h) return { width: w, height: h };
    }
    const entries = typeof pluginsText === "string" ? parsePluginsJs(pluginsText) ?? [] : [];
    for (const e of entries) {
      if (!e || typeof e !== "object" || e.status !== true || !e.parameters || typeof e.parameters !== "object") continue;
      let w: number | null = null, h: number | null = null;
      for (const [k, v] of Object.entries(e.parameters as Record<string, unknown>)) {
        const key = k.replace(/[\s_]/g, "").toLowerCase();
        if (key === "screenwidth") w = dim(v);
        else if (key === "screenheight") h = dim(v);
      }
      if (w && h) return { width: w, height: h };
    }
  } catch { /* 기본값 */ }
  return DEFAULT_SCREEN;
}
