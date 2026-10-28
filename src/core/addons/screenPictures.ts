import { parsePluginsJs } from "../live/installer";
import type { LogRecord } from "../live/types";
import { withoutMenuRecords, type MenuCommonEvents } from "../live/menuScenes";
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
  /**
   * 1.10.0+: "sprite" = 그림 명령이 아니라 다른 플러그인이 직접 띄운 그림(전투 컷인 등). id는 1000부터 그리는 순서로 붙인
   * 임시 번호라 그림 구분은 이름(spriteKeyOf)으로 고른다. 위치·크기·각도는 화면 기준(부모 변환을 모두 더한 것).
   */
  kind?: "sprite";
  /** 1.13.0+: 게임 전용 확장이 붙인 정보(예: CharacterPictureManager 스탠딩의 배우·겹 이름). 없으면 없음. */
  tag?: PictureTag;
}

/** 게임 전용 확장이 그림에 붙인 정보(기록 index 14). role = 확장이 정한 기본 구분. */
export interface PictureTag {
  adapter?: string; actorId?: number; actorName?: string; layer?: string; role?: PictureRole;
}

function parseTag(v: unknown): PictureTag | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const tag: PictureTag = {};
  const text = (x: unknown) => (typeof x === "string" && x.trim() !== "" ? x.slice(0, 60) : null);
  const adapter = text(o.adapter), actorName = text(o.actorName), layer = text(o.layer);
  if (adapter) tag.adapter = adapter;
  if (typeof o.actorId === "number" && Number.isInteger(o.actorId) && o.actorId > 0) tag.actorId = o.actorId;
  if (actorName) tag.actorName = actorName;
  if (layer) tag.layer = layer;
  if (isPictureRole(o.role)) tag.role = o.role;
  return Object.keys(tag).length > 0 ? tag : null;
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
  if (e[13] === "sprite") p.kind = "sprite";
  const tag = parseTag(e[14]);
  if (tag) p.tag = tag;
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
 * 메뉴 화면 그림을 뺀 기록(menu 화면 기록, MenuCommonEvent 커먼 이벤트의 그림 — core/live/menuScenes).
 * keepMenu(어댑터의 `메뉴 화면 그림도 기록`)면 그대로(같은 배열). 예외를 던지지 않는다.
 */
export function withoutMenuScreens(path: LogRecord[], keepMenu: boolean, menu?: MenuCommonEvents | null): LogRecord[] {
  return withoutMenuRecords(path, keepMenu, menu);
}

/**
 * 경로 기록(seq 순)을 따라가며 대사마다 그때 화면 그림 묶음을 만든다: message seq → 그림 묶음.
 * - `pics`가 있으면 그것으로 바꾸고, `picsSame`이면 앞의 것을 그대로 쓴다(같은 배열).
 * - 둘 다 없는 대사(기능이 꺼졌거나 구버전·전투 중)는 모름 — 지도에 넣지 않고 앞의 묶음도 잊는다.
 * - 갈래 시작(branchStart)은 앞의 묶음을 잊는다(플러그인도 갈래마다 처음부터 쓴다).
 * - 선택지(choices)의 `pics`는 묶음만 바꾼다.
 * - 1.8.0 전투 시작·끝(battle)·전투 로그(battlelog)도 pics/picsSame이 있으면 그 seq에 넣는다(없으면 묶음은 그대로).
 * - 1.10.0 화면 기록(screen, 대사 사이에 잠깐 보인 그림)도 같다.
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
      if (r.type === "battle" || r.type === "battlelog" || r.type === "screen") {
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
/** 게임별 플러그인이 띄운 그림(kind "sprite")의 이름 열쇠(spriteKeyOf) → 직접 고른 구분 */
export type SpriteRoles = Record<string, PictureRole>;

/**
 * 플러그인이 띄운 그림의 구분 열쇠: 폴더 안 그림이면 폴더("organ/"), 아니면 끝의 번호를 뺀 이름
 * ("actor01_cutin_A_0001" → "actor01_cutin_A"). 같은 컷인의 여러 장이 한 열쇠로 묶인다.
 */
export function spriteKeyOf(name: string): string {
  const n = typeof name === "string" ? name : "";
  const slash = n.lastIndexOf("/");
  if (slash > 0) return n.slice(0, slash + 1);
  const stripped = n.replace(/[_\-\s.]*\d+$/, "");
  return stripped || n;
}

export interface PicSize { w: number; h: number }
/** 그림 이름 → 크기(그림 파일에서 읽은 것). 모르면 null. */
export type SizeOf = (name: string) => PicSize | null | undefined;

/** 그림 구분에 쓰는 것: 화면 크기, 직접 고른 구분, 화면 장식으로 본 그림(hudKeys), 그림 크기 */
export interface PictureContext {
  screen: ScreenSize;
  roles?: PictureRoles | null;
  /** 플러그인이 띄운 그림(1.10.0)의 이름 열쇠별 구분 */
  spriteRoles?: SpriteRoles | null;
  hud?: ReadonlySet<string> | null;
  sizeOf?: SizeOf | null;
  /** 켜진 게임 전용 어댑터가 정한 기본 구분(직접 고른 구분 다음, 자동 판정 전). 없으면 null. */
  defaultRole?: ((p: ScreenPicture) => PictureRole | null | undefined) | null;
  /** 그림 이름 → 투명도 통계(그림 파일을 읽은 뒤). 모르면 null — 그동안은 가림 판정을 하지 않는다. */
  statsOf?: ((name: string) => AlphaStats | null | undefined) | null;
  /** 읽기에서 숨길 그림 이름인가(hiddenImageMatcher). 맞으면 다른 구분보다 먼저 숨김. 없으면 null. */
  hidden?: ((name: string) => boolean) | null;
}

/**
 * 그림 파일의 투명도 통계. opaque = 불투명한(알파 250 이상) 픽셀 비율(0~1),
 * box = 투명하지 않은 픽셀이 있는 부분 [왼, 위, 오른, 아래](그림 크기에 대한 0~1 비율). 다 투명하면 null.
 */
export interface AlphaStats { opaque: number; box: [number, number, number, number] | null }

/** RGBA 픽셀(줄여 읽은 것이어도 된다) → 투명도 통계. 예외를 던지지 않는다. */
export function alphaStatsOf(px: ArrayLike<number> | null | undefined, w: number, h: number): AlphaStats | null {
  try {
    if (!px || !(w > 0) || !(h > 0) || px.length < w * h * 4) return null;
    let opaque = 0, minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = px[(y * w + x) * 4 + 3];
        if (a >= 250) opaque++;
        if (a > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { opaque: opaque / (w * h), box: maxX < 0 ? null : [minX / w, minY / h, (maxX + 1) / w, (maxY + 1) / h] };
  } catch {
    return null;
  }
}

function statsOfPic(p: ScreenPicture, ctx: PictureContext): AlphaStats | null {
  try {
    const s = ctx.statsOf?.(p.name);
    return s && typeof s.opaque === "number" ? s : null;
  } catch {
    return null;
  }
}

/** 이벤트 그림으로 보는 불투명 비율, 아래 그림을 가린다고 보는 불투명 비율 */
const CG_OPAQUE = 0.9, OCCLUDE_OPAQUE = 0.98;

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
export function pictureRect(p: ScreenPicture, sizeOf?: SizeOf | null, box?: [number, number, number, number] | null): Rect | null {
  const s = sizeOfPic(p, sizeOf);
  if (!s) return null;
  const [ax, ay] = p.anchor ?? (p.origin === 1 ? [0.5, 0.5] : [0, 0]);
  const sx = p.scaleX / 100, sy = p.scaleY / 100;
  const rad = ((p.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const [u0, v0, u1, v1] = box ? [box[0] * s.w, box[1] * s.h, box[2] * s.w, box[3] * s.h] : [0, 0, s.w, s.h];
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [u, v] of [[u0, v0], [u1, v0], [u0, v1], [u1, v1]]) {
    const dx = (u - ax * s.w) * sx, dy = (v - ay * s.h) * sy;
    const X = p.x + dx * cos - dy * sin, Y = p.y + dx * sin + dy * cos;
    left = Math.min(left, X); right = Math.max(right, X); top = Math.min(top, Y); bottom = Math.max(bottom, Y);
  }
  return { left, top, right, bottom };
}

/**
 * 그림에서 실제로 보이는 부분(투명하지 않은 부분)이 화면에서 차지하는 사각형. 투명도 통계를 모르면 그림 전체(pictureRect),
 * 다 투명하면 null.
 */
export function contentRect(p: ScreenPicture, ctx: PictureContext): Rect | null {
  const st = statsOfPic(p, ctx);
  if (st && !st.box) return null;
  return pictureRect(p, ctx.sizeOf, st?.box ?? null);
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
const SMALL_SPRITE = 0.05, SMALL_PICTURE = 0.02;

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

/**
 * 그림 하나의 구분: 직접 고른 구분(플러그인이 띄운 그림은 이름 열쇠로) → 게임 전용 어댑터의 기본 구분 → 확장이 붙인 구분 → 화면 장식 → 화면의 80% 이상을 덮으면 이벤트 그림
 * → 나머지는 스탠딩(플러그인 컷인은 겹친 부분만 잘라 보인다)
 */
export function roleOf(p: ScreenPicture, ctx: PictureContext): PictureRole {
  return chosenRole(p, ctx) ?? autoRole(p, ctx).role;
}

/** 직접 고른 구분 → 어댑터 기본 구분 → 확장이 붙인 구분 → 화면 장식으로 본 그림. 없으면 null(자동 판정). */
function chosenRole(p: ScreenPicture, ctx: PictureContext): PictureRole | null {
  try {
    if (ctx.hidden?.(p.name)) return "hidden";
  } catch { /* 숨기지 않음 */ }
  const o = p.kind === "sprite" ? ctx.spriteRoles?.[spriteKeyOf(p.name)] : ctx.roles?.[p.id];
  if (isPictureRole(o)) return o;
  try {
    const d = ctx.defaultRole?.(p);
    if (isPictureRole(d)) return d;
  } catch { /* 기본값 없음 */ }
  if (p.tag?.role) return p.tag.role;
  if (ctx.hud?.has(hudKeyOf(p))) return "hud";
  return null;
}

/**
 * 크기로 정하는 구분. small = 작아서 화면 장식으로 본 것.
 * stacked = 투명도 통계를 아직 모르는 화면 크기 그림인데 같은 자리·크기로 여러 겹 겹쳐 있다(stackedLayers) —
 * 화면 크기의 투명한 겹으로 몸을 나눠 그린 스탠딩으로 본다(통계를 읽으면 그것으로 다시 정한다).
 */
function autoRole(p: ScreenPicture, ctx: PictureContext, stacked = false): { role: PictureRole; small: boolean } {
  // 크기는 실제로 보이는 부분으로 본다: 화면 크기의 투명한 그림 위에 몸 한 부분만 그린 겹(스탠딩 부품)은 이벤트 그림이 아니다
  const r = contentRect(p, ctx);
  if (r) {
    const cover = coverage(r, ctx.screen);
    const st = statsOfPic(p, ctx);
    if (cover >= CG_COVER && (st ? st.opaque >= CG_OPAQUE : !stacked)) return { role: "cg", small: false };
    // 1.10.1: 작은 그림은 화면 장식(플러그인이 띄운 것은 화면의 5%, 그림 명령은 2%보다 작을 때 — 티커 배경 막대 등)
    if (cover < (p.kind === "sprite" ? SMALL_SPRITE : SMALL_PICTURE)) return { role: "hud", small: true };
  }
  return { role: "stand", small: false };
}

/** 같은 자리·크기로 이만큼 이상 겹친 화면 크기 그림은(투명도 통계를 모를 때) 스탠딩 겹으로 본다 */
const STACKED_LAYERS = 3;

/**
 * 투명도 통계를 아직 모르는(암호화된 그림을 읽는 중이거나 읽을 수 없는) 화면 크기 그림 중, 같은 자리·기준점·배율·각도·크기로
 * STACKED_LAYERS개 이상 겹친 것들. 캐릭터를 화면 크기의 투명한 겹(몸·팔·눈·입…)으로 나눠 그리는 게임의 스탠딩이다
 * (이벤트 그림 한 장 + 어둡게 덮는 그림 한 장은 이보다 적다). 예외를 던지지 않는다.
 */
function stackedLayers(pics: ScreenPicture[], ctx: PictureContext): Set<ScreenPicture> {
  const out = new Set<ScreenPicture>();
  try {
    const groups = new Map<string, ScreenPicture[]>();
    for (const p of pics) {
      if (statsOfPic(p, ctx)) continue;
      const s = sizeOfPic(p, ctx.sizeOf);
      const r = s ? pictureRect(p, ctx.sizeOf) : null;
      if (!s || !r || coverage(r, ctx.screen) < CG_COVER) continue;
      const k = [p.origin, p.anchor?.join(",") ?? "", p.x, p.y, p.scaleX, p.scaleY, p.angle ?? 0, s.w, s.h].join("|");
      const g = groups.get(k);
      if (g) g.push(p); else groups.set(k, [p]);
    }
    for (const g of groups.values()) if (g.length >= STACKED_LAYERS) for (const p of g) out.add(p);
  } catch { /* 겹 판정 없음 */ }
  return out;
}

const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * 그림들의 구분(roleOf). 다만 크기만으로 화면 장식으로 본 작은 그림(그림 명령으로 띄운 것)이 그릴 다른 그림과 겹치면
 * 캐릭터의 한 부분(눈·입·볼 겹)으로 보고 스탠딩으로 함께 그린다.
 */
export function rolesOf(pics: ScreenPicture[], ctx: PictureContext): Map<ScreenPicture, PictureRole> {
  const out = new Map<ScreenPicture, PictureRole>();
  const small: ScreenPicture[] = [];
  const drawnRects: Rect[] = [];
  const chosen = new Map(pics.map(p => [p, chosenRole(p, ctx)] as const));
  const stacked = stackedLayers(pics.filter(p => chosen.get(p) === null), ctx);
  for (const p of pics) {
    const c = chosen.get(p);
    const a = c ? { role: c, small: false } : autoRole(p, ctx, stacked.has(p));
    out.set(p, a.role);
    if (a.small && p.kind !== "sprite") small.push(p);
    else if (a.role === "cg" || a.role === "stand") { const r = contentRect(p, ctx); if (r) drawnRects.push(r); }
  }
  for (const p of small) {
    const r = contentRect(p, ctx);
    if (r && drawnRects.some(d => overlaps(r, d))) out.set(p, "stand");
  }
  return out;
}

/** 대사 하나의 보이는 화면: 이벤트 그림과 스탠딩(각각 그리는 순서) */
export interface ScreenScene { cg: ScreenPicture[]; stand: ScreenPicture[] }

/**
 * 그림 묶음 → 보이는 화면. 화면 장식·숨김과 투명도 0은 빼고, 위에(뒤 번호로) 화면의 95% 이상을 덮는
 * 불투명(255·보통 합성) 그림 아래에 완전히 가려진 그림도 뺀다. 덮는 그림은 그림 파일이 거의 다 불투명하다고 알 때만(statsOf —
 * 모르면 가리지 않는다). 구분은 rolesOf(겹친 작은 부품은 스탠딩).
 */
export function sceneOf(pics: ScreenPicture[] | null | undefined, ctx: PictureContext): ScreenScene {
  const scene: ScreenScene = { cg: [], stand: [] };
  try {
    const drawn: { p: ScreenPicture; role: "cg" | "stand"; rect: Rect | null }[] = [];
    const list = [...(pics ?? [])].filter(p => p && p.opacity > 0).sort((a, b) => a.id - b.id);
    const roles = rolesOf(list, ctx);
    for (const p of list) {
      const role = roles.get(p);
      if (role === "cg" || role === "stand") drawn.push({ p, role, rect: contentRect(p, ctx) });
    }
    // 가리는 그림: 그림 파일이 거의 다 불투명하다고 알 때만(투명도 통계를 모르면 가리지 않는다)
    const covers = drawn.map(d => {
      const st = statsOfPic(d.p, ctx);
      return d.rect !== null && !!st && st.opaque >= OCCLUDE_OPAQUE && d.p.opacity >= 255 && d.p.blendMode === 0
        && coverage(d.rect, ctx.screen) >= OCCLUDE_COVER;
    });
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

/**
 * 읽기에 보일 그림: cg = 화면 크기 그대로(위에 보이는 스탠딩 포함), stand = 스탠딩 겹만 잘라서.
 * cg 종류의 cg = pictures 중 이벤트 그림인 것(나머지는 스탠딩). 없으면 모름.
 */
export interface ScreenShot { kind: "cg" | "stand"; pictures: ScreenPicture[]; cg?: ScreenPicture[] }

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
      return { shot: key === prevKey ? null : { kind: "cg", pictures, cg: [...scene.cg] }, key };
    }
    if (scene.stand.length > 0) {
      const key = "stand:" + JSON.stringify(scene.stand);
      return { shot: key === prevKey ? null : { kind: "stand", pictures: scene.stand }, key };
    }
  } catch { /* 없음으로 */ }
  return { shot: null, key: "" };
}

/** 스탠딩 묶음 하나: 배우별(확장이 배우를 붙인 그림) 또는 나머지 */
export interface StandGroup { key: string; actorId?: number; actorName?: string; pictures: ScreenPicture[] }

/**
 * 스탠딩 그림을 배우별로 나눈다(1.13.0 확장이 붙인 actorId 기준, 처음 나온 순서). 배우가 없는 그림은 한 묶음("").
 * 배우가 붙은 그림이 없으면 전체가 한 묶음. 각 묶음 안은 그리는 순서 그대로.
 */
export function standGroups(pictures: ScreenPicture[] | null | undefined): StandGroup[] {
  const out: StandGroup[] = [];
  const byKey = new Map<string, StandGroup>();
  try {
    for (const p of Array.isArray(pictures) ? pictures : []) {
      if (!p) continue;
      const id = p.tag?.actorId;
      const key = typeof id === "number" ? `a${id}` : "";
      let g = byKey.get(key);
      if (!g) {
        g = { key, pictures: [] };
        if (typeof id === "number") g.actorId = id;
        byKey.set(key, g);
        out.push(g);
      }
      if (!g.actorName && p.tag?.actorName) g.actorName = p.tag.actorName;
      g.pictures.push(p);
    }
  } catch { /* 모은 데까지 */ }
  return out;
}

/** 스탠딩 묶음의 이름: "아마네 스탠딩", 이름 모르는 배우는 "배우 3 스탠딩", 배우 없음은 "스탠딩" */
export function standGroupLabel(g: StandGroup): string {
  if (g.actorName) return `${g.actorName} 스탠딩`;
  if (typeof g.actorId === "number") return `배우 ${g.actorId} 스탠딩`;
  return "스탠딩";
}

/** 보이는 그림으로 치는 투명도(255의 10% 초과)와 위치 비교 칸(px) — 1.10.1 화면 기록 겹침 거르기 */
const VISIBLE_OPACITY = 25.5, COARSE_PX = 64;

/** 장면에서 거의 투명한(10% 이하) 그림을 뺀다(사라지는 중인 그림) */
export function visibleScene(scene: ScreenScene | null | undefined): ScreenScene | null {
  if (!scene) return null;
  const vis = (p: ScreenPicture) => p.opacity > VISIBLE_OPACITY;
  return { cg: scene.cg.filter(vis), stand: scene.stand.filter(vis) };
}

/**
 * 보일 그림의 대략적인 열쇠: 종류 + 보이는(투명도 10% 초과) 그림의 이름과 64px 칸 위치. 투명도·색조·작은 움직임은 무시한다
 * (사라지거나 나타나는 중인 그림이 기록마다 새 그림으로 보이지 않게). 없으면 "".
 */
export function coarseShotKey(shot: ScreenShot | null | undefined): string {
  if (!shot) return "";
  try {
    const parts = shot.pictures.filter(p => p.opacity > VISIBLE_OPACITY)
      .map(p => `${p.name}|${Math.round(p.x / COARSE_PX)}|${Math.round(p.y / COARSE_PX)}`).sort();
    return parts.length > 0 ? `${shot.kind}:${parts.join("\n")}` : "";
  } catch {
    return "";
  }
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
const PICS_TYPES = new Set(["message", "choices", "battle", "battlelog", "screen"]);

/** 끝에서부터 pics가 있는 기록의 그림 묶음(최근 것부터, 최대 limit개, picsSame은 앞의 것과 같으므로 뺀다) */
function recentPics(records: LogRecord[], limit: number): ScreenPicture[][] {
  const recent: ScreenPicture[][] = [];
  const list = Array.isArray(records) ? records : [];
  for (let i = list.length - 1; i >= 0 && recent.length < limit; i--) {
    const o = list[i] as unknown as Record<string, unknown> | null;
    if (!o || !PICS_TYPES.has(o.type as string)) continue;
    const p = parsePics(o.pics);
    if (p) recent.push(p);
  }
  return recent;
}

export function seenPictures(records: LogRecord[], ctx: PictureContext, limit = 2000): SeenPicture[] {
  const byId = new Map<number, { names: string[]; last: ScreenPicture }>();
  try {
    for (const pics of recentPics(records, limit)) {
      for (const p of pics) {
        if (p.kind === "sprite") continue; // 플러그인이 띄운 그림은 seenSprites
        const e = byId.get(p.id);
        if (!e) byId.set(p.id, { names: [p.name], last: p });
        else if (e.names.length < 3 && !e.names.includes(p.name)) e.names.push(p.name);
      }
    }
  } catch { /* 모은 데까지 */ }
  const noRoles: PictureContext = { ...ctx, roles: null };
  return [...byId.entries()].sort((a, b) => a[0] - b[0]).map(([id, e]) => ({ id, names: e.names, auto: roleOf(e.last, noRoles) }));
}

/** 설정 화면용: 플러그인이 띄운 그림(1.10.0)의 이름 열쇠와 그 이름들(최근 것부터 최대 3개) */
export interface SeenSprite { key: string; names: string[]; auto: PictureRole }

/** 기록에서 최근 본 플러그인이 띄운 그림을 이름 열쇠(spriteKeyOf)별로(열쇠 순). auto = 가장 최근 모습의 자동 구분. */
export function seenSprites(records: LogRecord[], ctx: PictureContext, limit = 2000): SeenSprite[] {
  const byKey = new Map<string, { names: string[]; last: ScreenPicture }>();
  try {
    for (const pics of recentPics(records, limit)) {
      for (const p of pics) {
        if (p.kind !== "sprite") continue;
        const k = spriteKeyOf(p.name);
        const e = byKey.get(k);
        if (!e) byKey.set(k, { names: [p.name], last: p });
        else if (e.names.length < 3 && !e.names.includes(p.name)) e.names.push(p.name);
      }
    }
  } catch { /* 모은 데까지 */ }
  const noRoles: PictureContext = { ...ctx, roles: null, spriteRoles: null };
  return [...byKey.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, e]) => ({ key, names: e.names, auto: roleOf(e.last, noRoles) }));
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
