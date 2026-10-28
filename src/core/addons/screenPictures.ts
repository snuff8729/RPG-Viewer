import { parsePluginsJs } from "../live/installer";
import type { LogRecord } from "../live/types";
import type { SystemData } from "../types";

/**
 * 화면 그림 따라 그리기(플러그인 1.6.0+): 대사(message)·선택지(choices) 기록의 `pics`(바뀐 그림 전체) / `picsSame`(앞과 같음)을
 * 읽어 대사마다 그때 화면에 떠 있던 그림 묶음을 만든다. 모두 예외를 던지지 않는다.
 */

/** 화면에 떠 있는 그림 하나(Game_Picture 값). origin 0 = 왼쪽 위, 1 = 가운데. blendMode 0 보통, 1 더하기, 2 곱하기, 3 스크린. */
export interface ScreenPicture {
  id: number; name: string; origin: number; x: number; y: number;
  scaleX: number; scaleY: number; opacity: number; blendMode: number;
  /** [빨강, 초록, 파랑, 회색] -255~255(회색 0~255). 없으면 색조 없음. */
  tone?: [number, number, number, number];
  /** 회전 각도(도). 없으면 0. */
  angle?: number;
}

const MAX_PICS = 60;
const fin = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** 기록의 그림 하나(`[id, name, origin, x, y, scaleX, scaleY, opacity, blendMode, tone?, angle?]`) → ScreenPicture. 이상하면 null. */
export function parsePic(e: unknown): ScreenPicture | null {
  if (!Array.isArray(e)) return null;
  const id = e[0], name = e[1];
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || typeof name !== "string" || name === "") return null;
  const p: ScreenPicture = {
    id, name, origin: fin(e[2], 0) === 1 ? 1 : 0, x: fin(e[3], 0), y: fin(e[4], 0),
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
  return p;
}

/** 기록의 `pics` 배열 → 그림 번호 순 묶음(최대 60개, 같은 번호는 뒤의 것). 배열이 아니면 null. */
export function parsePics(v: unknown): ScreenPicture[] | null {
  if (!Array.isArray(v)) return null;
  const byId = new Map<number, ScreenPicture>();
  for (const e of v.slice(0, MAX_PICS)) {
    const p = parsePic(e);
    if (p) byId.set(p.id, p);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * 경로 기록(seq 순)을 따라가며 대사마다 그때 화면 그림 묶음을 만든다: message seq → 그림 묶음.
 * - `pics`가 있으면 그것으로 바꾸고, `picsSame`이면 앞의 것을 그대로 쓴다.
 * - 둘 다 없는 대사(기능이 꺼졌거나 구버전·전투 중)는 모름 — 지도에 넣지 않고 앞의 묶음도 잊는다.
 * - 갈래 시작(branchStart)은 앞의 묶음을 잊는다(플러그인도 갈래마다 처음부터 쓴다).
 * - 선택지(choices)의 `pics`는 묶음만 바꾼다.
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
