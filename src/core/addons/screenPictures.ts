import { parsePluginsJs } from "../live/installer";
import type { LogRecord } from "../live/types";
import { withoutMenuRecords, type MenuCommonEvents } from "../live/menuScenes";
import type { SystemData } from "../types";
import { sameMotion, type PictureMotion } from "./pictureMotion";

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
  /**
   * 그리는 크기(px, 1.7.0+, 배율 전). 없으면 그림 파일에서 읽은 크기를 쓴다. crop이 없으면 그림 전체를 이 크기로 늘려 그린다
   * (그림 파일 크기와 다르면 늘린 것으로 본다 — 원본을 자르지 않는다).
   */
  w?: number; h?: number;
  /**
   * 1.18.1+: 그림 파일에서 보이는 부분 [x, y, 폭, 높이, 그림 폭, 그림 높이](기록 index 15, 그림 파일 px). 플러그인 캔버스의
   * 일부(스프라이트 frame)만 보이거나 캔버스 일부에 그려진 그림. w·h에 이 부분을 늘려 그린다. 없으면 그림 전체.
   */
  crop?: [number, number, number, number, number, number];
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
  const crop = parseCrop(e[15]);
  if (crop) p.crop = crop;
  return p;
}

/** 기록 index 15 [x, y, 폭, 높이, 그림 폭, 그림 높이] → crop. 이상하면 null. */
function parseCrop(v: unknown): [number, number, number, number, number, number] | null {
  if (!Array.isArray(v) || v.length < 6) return null;
  const n = v.slice(0, 6).map(x => fin(x, Number.NaN));
  if (n.some(x => Number.isNaN(x))) return null;
  const [x, y, w, h, iw, ih] = n;
  if (!(w > 0 && h > 0 && iw > 0 && ih > 0)) return null;
  return [x, y, w, h, iw, ih];
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
  const st = newPicturesState();
  for (const r of Array.isArray(path) ? path : []) picturesStep(st, r, out);
  return out;
}

/** picturesBySeq를 기록 하나씩 이어 하는 상태(지금 묶음) */
export interface PicturesState { cur: ScreenPicture[] | null }
export const newPicturesState = (): PicturesState => ({ cur: null });

/** picturesBySeq의 기록 하나. 예외를 던지지 않는다. */
export function picturesStep(st: PicturesState, r: LogRecord, out: Map<number, ScreenPicture[]>): void {
  try {
    if (!r || typeof r !== "object") return;
    const o = r as unknown as Record<string, unknown>;
    if (r.type === "branchStart") { st.cur = null; return; }
    if (r.type === "choices") {
      const p = parsePics(o.pics);
      if (p) st.cur = p;
      return;
    }
    // 1.8.0 전투: 시작·끝은 pics/picsSame, 전투 로그 줄은 그림이 바뀌었을 때만 pics. 둘 다 없으면 묶음은 그대로(지도에 안 넣음)
    if (r.type === "battle" || r.type === "battlelog" || r.type === "screen") {
      const p = parsePics(o.pics);
      if (p) st.cur = p;
      if (st.cur && (p || o.picsSame === true)) out.set(r.seq, st.cur);
      return;
    }
    if (r.type !== "message") return;
    const p = parsePics(o.pics);
    if (p) st.cur = p;
    else if (o.picsSame !== true) st.cur = null;
    if (st.cur) out.set(r.seq, st.cur);
  } catch { /* 깨진 기록은 건너뛴다 */ }
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
  /** 화면 크기(실제 크기를 모를 때 쓰는 것 — live.json 또는 게임 설정에서 짐작한 크기) */
  screen: ScreenSize;
  /** 1.18.2+: 기록에서 안 실제 화면 크기(screenSizeMarks). 기록마다 그 seq 이하의 마지막 것을 쓴다(knownScreenAt). */
  sizes?: ScreenSizeMark[] | null;
  /** 1.18.2+: live.json이 알려 준 지금 실제 화면 크기(기록에 크기가 없는 앞부분에 쓴다) */
  liveScreen?: ScreenSize | null;
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

/** 한 가지 색 그림 판정: 읽는 크기(긴 변 px 이상), 덮는 비율, 같은 색 비율, 같은 색으로 보는 채널 차이 */
export const FLAT_SAMPLE = 64;
const FLAT_COVER = 0.95, FLAT_SAME = 0.99, FLAT_DIST = 8, FLAT_ALPHA = 250;

/**
 * 화면을 한 가지 색으로 덮는 그림인가(Darkness 같은 전환용 칠): 불투명한(알파 250 이상) 픽셀이 95% 이상이고, 그중 99% 이상이
 * 대표 색(채널별 중앙값)과 채널마다 8 이내. 투명한 부분이 있는 실루엣(투명 바탕 위 그림자 모양)은 절대 한 가지 색이 아니다.
 * px: RGBA(FLAT_SAMPLE 이상으로 줄여 읽은 것). 읽을 수 없으면 false. 예외를 던지지 않는다.
 */
export function isFlatPixels(px: ArrayLike<number> | null | undefined, w: number, h: number): boolean {
  try {
    const n = w * h;
    if (!px || !(n > 0) || px.length < n * 4) return false;
    const opaque: number[] = [];
    for (let i = 0; i < n; i++) if (px[i * 4 + 3] >= FLAT_ALPHA) opaque.push(i * 4);
    if (opaque.length < n * FLAT_COVER) return false;
    const ref = [0, 1, 2].map(k => {
      const v = opaque.map(o => px[o + k]).sort((a, b) => a - b);
      return v[v.length >> 1];
    });
    let same = 0;
    for (const o of opaque) if (ref.every((r, k) => Math.abs(px[o + k] - r) <= FLAT_DIST)) same++;
    return same >= opaque.length * FLAT_SAME;
  } catch {
    return false;
  }
}

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

/** 그림의 기준점(0~1) */
const anchorOf = (p: ScreenPicture): [number, number] => p.anchor ?? (p.origin === 1 ? [0.5, 0.5] : [0, 0]);

/**
 * 그림 파일 안의 사각형(그림 크기에 대한 0~1 비율 [왼, 위, 오른, 아래]) → 그리는 크기 s(배율 전, 왼쪽 위 0) 안의 사각형.
 * crop이 있으면 그 부분만 s로 늘린 것(밖은 잘린다), 없으면 그림 전체를 s로 늘린 것. 보이는 부분 밖이면 null.
 */
function boxInPicture(p: ScreenPicture, s: PicSize, box: [number, number, number, number]): [number, number, number, number] | null {
  if (!p.crop) return [box[0] * s.w, box[1] * s.h, box[2] * s.w, box[3] * s.h];
  const [cx, cy, cw, ch, iw, ih] = p.crop;
  const x0 = Math.max(box[0] * iw, cx), y0 = Math.max(box[1] * ih, cy);
  const x1 = Math.min(box[2] * iw, cx + cw), y1 = Math.min(box[3] * ih, cy + ch);
  if (!(x1 > x0 && y1 > y0)) return null;
  const kx = s.w / cw, ky = s.h / ch;
  return [(x0 - cx) * kx, (y0 - cy) * ky, (x1 - cx) * kx, (y1 - cy) * ky];
}

/** 그림 한 장을 그리는 법: 그림 파일의 source 사각형(sx…sh)을 그림 자리 기준(배율·회전 전) dest 사각형(dx…dh)에 */
export interface PictureDraw { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }

/**
 * 불러온 그림 파일(natural: 그 크기)을 그리는 사각형들. 화면 사각형(pictureRect)과 같은 크기 기준:
 * 그리는 크기 = 기록의 w·h(없으면 그림 파일 크기), crop이 있으면 그 부분만(그림 파일 크기가 기록 때와 다르면 비율로 맞춘다),
 * 없으면 그림 전체를 그 크기로 늘린다. 그릴 것이 없으면 null.
 */
export function pictureDraw(p: ScreenPicture, natural: PicSize): PictureDraw | null {
  try {
    if (!(natural.w > 0 && natural.h > 0)) return null;
    const s = p.w && p.h ? { w: p.w, h: p.h } : natural;
    const [ax, ay] = anchorOf(p);
    const ox = ax ? -ax * s.w : 0, oy = ay ? -ay * s.h : 0;
    if (!p.crop) return { sx: 0, sy: 0, sw: natural.w, sh: natural.h, dx: ox, dy: oy, dw: s.w, dh: s.h };
    const [cx, cy, cw, ch, iw, ih] = p.crop;
    const kx = natural.w / iw, ky = natural.h / ih;
    // 그림 파일 밖은 잘라 낸다(dest도 같은 비율로)
    const x0 = Math.max(0, cx), y0 = Math.max(0, cy), x1 = Math.min(iw, cx + cw), y1 = Math.min(ih, cy + ch);
    if (!(x1 > x0 && y1 > y0)) return null;
    const dkx = s.w / cw, dky = s.h / ch;
    return {
      sx: x0 * kx, sy: y0 * ky, sw: (x1 - x0) * kx, sh: (y1 - y0) * ky,
      dx: ox + (x0 - cx) * dkx, dy: oy + (y0 - cy) * dky, dw: (x1 - x0) * dkx, dh: (y1 - y0) * dky,
    };
  } catch {
    return null;
  }
}

/**
 * 그림이 화면에서 차지하는 사각형(회전 포함). 크기를 모르면 null. box: 그림 파일 안의 보이는 부분(투명도 통계, 0~1 비율) —
 * 그리는 크기 기준으로 옮겨 쓴다(crop 밖이면 그 그림 자리의 크기 0 사각형).
 */
export function pictureRect(p: ScreenPicture, sizeOf?: SizeOf | null, box?: [number, number, number, number] | null): Rect | null {
  const s = sizeOfPic(p, sizeOf);
  if (!s) return null;
  const [ax, ay] = anchorOf(p);
  const sx = p.scaleX / 100, sy = p.scaleY / 100;
  const rad = ((p.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const [u0, v0, u1, v1] = box ? boxInPicture(p, s, box) ?? [0, 0, 0, 0] : [0, 0, s.w, s.h];
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
  if (st?.box && p.crop && !boxInPicture(p, { w: 1, h: 1 }, st.box)) return null; // 보이는 부분이 다 투명
  return pictureRect(p, ctx.sizeOf, st?.box ?? null);
}

/** 그림들을 그릴 화면 부분(게임 화면 좌표) */
export interface PictureView { left: number; top: number; width: number; height: number }

/** 스탠딩을 잘라 보이는 부분의 최대 크기(px) */
const STAND_VIEW_MAX = 8192;

/**
 * 스탠딩을 잘라 보일 부분: 그림들의 보이는(투명하지 않은) 부분을 합친 곳. 그리는 것(pictureDraw)과 같은 크기 기준 —
 * naturalOf(이름) = 불러온 그림 파일 크기, 기록에 크기가 없으면 이것. statsOf = 그림 파일의 투명도 통계(box는 그림 파일 비율).
 * 화면 왼쪽·위(0) 밖은 자르지만 오른쪽·아래는 화면 크기로 자르지 않는다 — 화면 크기는 게임 파일에서 짐작한 값이라
 * 실제보다 작으면(해상도를 코드로 바꾼 게임) 화면 오른쪽의 스탠딩이 반쯤 잘린다. 그림 파일을 모르면 화면 전체.
 */
export function standViewOf(
  pictures: ScreenPicture[], screen: ScreenSize,
  naturalOf: (name: string) => PicSize | null | undefined, statsOf?: (name: string) => AlphaStats | null | undefined,
): PictureView {
  const full = { left: 0, top: 0, width: screen.width, height: screen.height };
  try {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const p of pictures) {
      const nat = naturalOf(p.name);
      if (!nat || !(nat.w > 0 && nat.h > 0)) return full;
      const st = statsOf?.(p.name) ?? null;
      if (st && !st.box) continue; // 다 투명한 겹
      if (st?.box && p.crop && !boxInPicture(p, { w: 1, h: 1 }, st.box)) continue; // 보이는 부분이 다 투명
      const r = pictureRect(p, () => nat, st?.box ?? null);
      if (!r) return full;
      left = Math.min(left, r.left); top = Math.min(top, r.top); right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
    }
    left = Math.max(0, Math.floor(left)); top = Math.max(0, Math.floor(top));
    right = Math.min(left + STAND_VIEW_MAX, Math.ceil(right)); bottom = Math.min(top + STAND_VIEW_MAX, Math.ceil(bottom));
    if (!(right > left && bottom > top)) return full;
    return { left, top, width: right - left, height: bottom - top };
  } catch {
    return full;
  }
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
  try {
    let total = 0;
    const seen: HudTally = new Map();
    for (const [pics, n] of counts) {
      total += n;
      for (const p of pics) {
        const k = hudKeyOf(p);
        const e = seen.get(k);
        if (e) e.n += n; else seen.set(k, { n, p });
      }
    }
    return hudKeysOfTally(seen, total, screen, sizeOf);
  } catch {
    return new Set();
  }
}

/** 화면 장식 열쇠 → 그 열쇠의 그림이 보인 대사 수와 (갈래 순으로) 처음 본 그림 */
export type HudTally = Map<string, { n: number; p: ScreenPicture }>;

/** hudKeys를 미리 모은 수(tally, total = 대사 묶음 수 합)로 판정한다(core/addons/pictureScans가 이어 모은다). */
export function hudKeysOfTally(seen: HudTally, total: number, screen: ScreenSize, sizeOf?: SizeOf | null): Set<string> {
  const out = new Set<string>();
  try {
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
export interface ScreenScene {
  cg: ScreenPicture[]; stand: ScreenPicture[];
  /** 이 화면을 나눈 게임의 실제 화면 크기(1.18.2 기록·live.json에서 안 것). 없으면 모름(게임 설정에서 짐작한 크기를 쓴다). */
  screen?: ScreenSize;
}

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
  const cache: SceneCache = new Map();
  for (const [seq, pics] of pictures) out.set(seq, sceneOfCached(pics, ctx, seq, cache));
  return out;
}

/** 그림 묶음(같은 배열) → 화면 크기별 보이는 화면 */
export type SceneCache = Map<ScreenPicture[], { known: unknown; scene: ScreenScene }[]>;

/** seq 대사의 묶음 pics → 보이는 화면. 같은 묶음·같은 화면 크기는 cache에서(scenesBySeq 한 칸). cache는 같은 ctx에만 쓴다. */
export function sceneOfCached(pics: ScreenPicture[], ctx: PictureContext, seq: number, cache: SceneCache): ScreenScene {
  // 1.18.2: 그 대사 때 게임의 실제 화면 크기로 나눈다(같은 묶음·같은 크기는 한 번만)
  const known = knownScreenAt(ctx, seq);
  const list = cache.get(pics) ?? [];
  let hit = list.find(x => sameSize(x.known as ScreenSize | null, known));
  if (!hit) {
    hit = { known, scene: withScreen(sceneOf(pics, known ? { ...ctx, screen: known } : ctx), known) };
    list.push(hit);
    cache.set(pics, list);
  }
  return hit.scene;
}

// ---------------------------------------------------------------- 실제 화면 크기(1.18.2)

/** 기록에서 안 게임의 실제 화면 크기: 이 seq부터(다음 표시 전까지) */
export interface ScreenSizeMark { seq: number; size: ScreenSize }

const realDim = (v: unknown): number | null =>
  (typeof v === "number" && Number.isFinite(v) && v >= 16 && v <= 16384 ? Math.round(v) : null);

const sameSize = (a: ScreenSize | null | undefined, b: ScreenSize | null | undefined): boolean =>
  (!a || !b ? !a && !b : a.width === b.width && a.height === b.height);

/**
 * 기록(1.18.2+)의 sw·sh(게임의 실제 화면 크기 — 바뀔 때만 적힌다)를 seq 순 표시로 모은다. 없으면(구버전) 빈 목록.
 * 예외를 던지지 않는다.
 */
export function screenSizeMarks(records: LogRecord[]): ScreenSizeMark[] {
  const out: ScreenSizeMark[] = [];
  try {
    for (const r of Array.isArray(records) ? records : []) {
      const m = screenSizeMarkOf(r);
      if (m) out.push(m);
    }
    out.sort((a, b) => a.seq - b.seq);
  } catch { /* 모은 데까지 */ }
  return out;
}

/** 기록 하나의 화면 크기 표시(screenSizeMarks 한 칸). 없으면 null. */
export function screenSizeMarkOf(r: LogRecord): ScreenSizeMark | null {
  if (!r || typeof r !== "object" || typeof r.seq !== "number") return null;
  const o = r as unknown as Record<string, unknown>;
  const w = realDim(o.sw), h = realDim(o.sh);
  if (w === null || h === null) return null;
  return { seq: r.seq, size: { width: w, height: h } };
}

/** live.json의 screen(1.18.2+ { w, h }) → 화면 크기. 없거나 이상하면 null. */
export function liveScreenSize(live: unknown): ScreenSize | null {
  try {
    const s = live && typeof live === "object" ? (live as Record<string, unknown>).screen : null;
    if (!s || typeof s !== "object") return null;
    const w = realDim((s as Record<string, unknown>).w), h = realDim((s as Record<string, unknown>).h);
    return w !== null && h !== null ? { width: w, height: h } : null;
  } catch {
    return null;
  }
}

/** seq 때 게임의 실제 화면 크기: 그 seq 이하의 마지막 기록 표시 → live.json의 크기 → 모름(null) */
export function knownScreenAt(ctx: PictureContext | null | undefined, seq: number | null | undefined): ScreenSize | null {
  try {
    const marks = ctx?.sizes;
    if (marks && marks.length > 0 && typeof seq === "number" && Number.isFinite(seq)) {
      let lo = 0, hi = marks.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (marks[mid].seq <= seq) { found = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (found >= 0) return marks[found].size;
    }
    return ctx?.liveScreen ?? null;
  } catch {
    return null;
  }
}

/** seq 때 그림 구분에 쓸 화면 크기: 실제 크기(knownScreenAt)를 모르면 ctx.screen(짐작한 크기) */
export function screenAt(ctx: PictureContext | null | undefined, seq: number | null | undefined): ScreenSize {
  return knownScreenAt(ctx, seq) ?? ctx?.screen ?? DEFAULT_SCREEN;
}

/** seq 때의 그림 구분 문맥(화면 크기만 그때 것으로). 같으면 같은 객체. */
export function ctxAt(ctx: PictureContext, seq: number | null | undefined): PictureContext {
  const size = screenAt(ctx, seq);
  return sameSize(size, ctx?.screen) ? ctx : { ...ctx, screen: size };
}

/** 마지막으로 안 실제 화면 크기(기록 표시 → live.json), 모르면 null */
export function latestKnownScreen(ctx: Pick<PictureContext, "sizes" | "liveScreen">): ScreenSize | null {
  const marks = ctx.sizes;
  return marks && marks.length > 0 ? marks[marks.length - 1].size : ctx.liveScreen ?? null;
}

/**
 * 읽기에 보일 그림: cg = 화면 크기 그대로(위에 보이는 스탠딩 포함), stand = 스탠딩 겹만 잘라서.
 * cg 종류의 cg = pictures 중 이벤트 그림인 것(나머지는 스탠딩). 없으면 모름.
 */
export interface ScreenShot {
  kind: "cg" | "stand"; pictures: ScreenPicture[]; cg?: ScreenPicture[];
  /** 그때 게임의 실제 화면 크기(ScreenScene.screen). 없으면 게임 설정에서 짐작한 크기. */
  screen?: ScreenSize;
  /** 앞 대사부터 이 그림이 되기까지의 그림 움직임(core/addons/pictureMotion). 움직인 것이 없으면 없다. */
  motion?: PictureMotion;
}

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
      return { shot: key === prevKey ? null : withScreen<ScreenShot>({ kind: "cg", pictures, cg: [...scene.cg] }, scene.screen), key };
    }
    if (scene.stand.length > 0) {
      // 묶음(스탠딩·컷인·배우별)마다 따로: 앞에 보인 것과 겹이 달라진 묶음만 다시 보인다
      const groups = standGroups(scene.stand);
      const keys = groups.map(g => JSON.stringify(g.pictures));
      const key = STAND_KEY + JSON.stringify(keys);
      const before = shownGroupKeys(prevKey);
      const changed = groups.filter((_, i) => !before.has(keys[i]));
      if (changed.length === 0) return { shot: null, key };
      const pictures = changed.length === groups.length ? scene.stand : changed.flatMap(g => g.pictures);
      return { shot: withScreen<ScreenShot>({ kind: "stand", pictures }, scene.screen), key };
    }
  } catch { /* 없음으로 */ }
  return { shot: null, key: "" };
}

const STAND_KEY = "stand:";

/** 실제 화면 크기를 알면 붙인다 */
export function withScreen<T extends { screen?: ScreenSize }>(x: T, screen: ScreenSize | null | undefined): T {
  if (screen) x.screen = screen;
  return x;
}

/** 스탠딩만 보인 열쇠(nextShot)에서 그때 보인 묶음들의 열쇠. 다른 열쇠면 빈 집합. */
function shownGroupKeys(prevKey: string | null): Set<string> {
  if (!prevKey || !prevKey.startsWith(STAND_KEY)) return new Set();
  try {
    const v: unknown = JSON.parse(prevKey.slice(STAND_KEY.length));
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * 스탠딩 묶음 하나: 배우별(확장이 배우를 붙인 그림), 컷인(플러그인이 띄운 그림 kind "sprite" 덩어리), 또는 스탠딩(그림 명령 덩어리).
 * kind "cutin" = 컷인 묶음.
 */
export interface StandGroup { key: string; actorId?: number; actorName?: string; kind?: "cutin"; pictures: ScreenPicture[] }

/** 같은 자리로 보는 위치 차이(px)·배율 차이(%) */
const PLACE_PX = 8, PLACE_SCALE = 1;

function samePlacement(a: ScreenPicture, b: ScreenPicture): boolean {
  return a.origin === b.origin && (a.anchor?.join(",") ?? "") === (b.anchor?.join(",") ?? "")
    && Math.abs(a.x - b.x) <= PLACE_PX && Math.abs(a.y - b.y) <= PLACE_PX
    && Math.abs(a.scaleX - b.scaleX) <= PLACE_SCALE && Math.abs(a.scaleY - b.scaleY) <= PLACE_SCALE;
}

/**
 * 겹들을 덩어리로 나눈다: 같은 자리(위치·기준점·배율이 거의 같다)거나 차지하는 사각형(기록의 크기)이 겹치면 같은 덩어리
 * (이어져 있으면 모두 한 덩어리). 덩어리는 처음 나온 순서, 안은 그리는 순서 그대로.
 */
function clusters(pics: ScreenPicture[]): ScreenPicture[][] {
  const parent = pics.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const rects = pics.map(p => pictureRect(p));
  for (let i = 0; i < pics.length; i++) {
    for (let j = i + 1; j < pics.length; j++) {
      const ri = rects[i], rj = rects[j];
      if (samePlacement(pics[i], pics[j]) || (ri && rj && overlaps(ri, rj))) parent[find(j)] = find(i);
    }
  }
  const byRoot = new Map<number, ScreenPicture[]>();
  pics.forEach((p, i) => {
    const r = find(i);
    const g = byRoot.get(r);
    if (g) g.push(p); else byRoot.set(r, [p]);
  });
  return [...byRoot.values()];
}

/**
 * 스탠딩 그림을 따로 보일 묶음으로 나눈다(처음 나온 순서, 각 묶음 안은 그리는 순서 그대로):
 * - 확장이 배우를 붙인 그림(1.13.0 actorId)은 배우별("a{id}").
 * - 나머지는 플러그인이 띄운 그림(kind "sprite" — 컷인)과 그림 명령 그림을 섞지 않고, 각각 덩어리(clusters)로 나눈다.
 *   그림 명령 덩어리는 스탠딩(열쇠 "", 둘째부터 "p1"…), 플러그인 그림 덩어리는 컷인("c0"…, kind "cutin").
 */
export function standGroups(pictures: ScreenPicture[] | null | undefined): StandGroup[] {
  const found: { first: number; g: StandGroup }[] = [];
  try {
    const byActor = new Map<number, StandGroup>();
    const plain: ScreenPicture[] = [], sprites: ScreenPicture[] = [];
    const firstAt = new Map<ScreenPicture, number>();
    (Array.isArray(pictures) ? pictures : []).forEach((p, i) => {
      if (!p) return;
      firstAt.set(p, i);
      const id = p.tag?.actorId;
      if (typeof id !== "number") { (p.kind === "sprite" ? sprites : plain).push(p); return; }
      let g = byActor.get(id);
      if (!g) {
        g = { key: `a${id}`, actorId: id, pictures: [] };
        byActor.set(id, g);
        found.push({ first: i, g });
      }
      if (!g.actorName && p.tag?.actorName) g.actorName = p.tag.actorName;
      g.pictures.push(p);
    });
    clusters(plain).forEach((c, n) => found.push({ first: firstAt.get(c[0]) ?? 0, g: { key: n === 0 ? "" : `p${n}`, pictures: c } }));
    clusters(sprites).forEach((c, n) => found.push({ first: firstAt.get(c[0]) ?? 0, g: { key: `c${n}`, kind: "cutin", pictures: c } }));
  } catch { /* 모은 데까지 */ }
  return found.sort((a, b) => a.first - b.first).map(x => x.g);
}

/** 스탠딩 묶음의 이름: "아마네 스탠딩", 이름 모르는 배우는 "배우 3 스탠딩", 컷인은 "컷인", 배우 없음은 "스탠딩" */
export function standGroupLabel(g: StandGroup): string {
  if (g.actorName) return `${g.actorName} 스탠딩`;
  if (typeof g.actorId === "number") return `배우 ${g.actorId} 스탠딩`;
  if (g.kind === "cutin") return "컷인";
  return "스탠딩";
}

/** 보이는 그림으로 치는 투명도(255의 10% 초과)와 위치 비교 칸(px) — 1.10.1 화면 기록 겹침 거르기 */
const VISIBLE_OPACITY = 25.5, COARSE_PX = 64;

/** 장면에서 거의 투명한(10% 이하) 그림을 뺀다(사라지는 중인 그림) */
export function visibleScene(scene: ScreenScene | null | undefined): ScreenScene | null {
  if (!scene) return null;
  const vis = (p: ScreenPicture) => p.opacity > VISIBLE_OPACITY;
  return withScreen<ScreenScene>({ cg: scene.cg.filter(vis), stand: scene.stand.filter(vis) }, scene.screen);
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
  return a.kind === b.kind && samePictures(a.pictures, b.pictures) && sameMotion(a.motion, b.motion);
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
