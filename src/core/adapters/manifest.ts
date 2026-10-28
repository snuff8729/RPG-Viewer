import { isAddonId, type AddonId, type AddonState } from "../addons/registry";
import { isPictureRole, spriteKeyOf, type PictureRole, type ScreenPicture } from "../addons/screenPictures";
import { parsePluginsJs } from "../live/installer";

/**
 * 게임 전용 어댑터(저장소의 adapters/<id>/manifest.json). 게임에 맞는 어댑터를 찾아 게임 설정에서 켜고,
 * 켜면 기본값(애드온 켜기·그림 구분)을 적용하고 게임 쪽 확장(bridge.js)을 설치한다. 모두 예외를 던지지 않는다.
 */
export interface AdapterMatch {
  /** 켜진 플러그인 이름(대소문자 무시) */
  plugins?: string[];
  /** plugins를 모두(all, 기본) 또는 하나라도(any) 켜야 맞는다 */
  pluginsMode?: "all" | "any";
  /** 게임 제목(System.json gameTitle)에 들어 있는 글자 중 하나 */
  gameTitle?: string[];
}

/** 그림 번호 범위 → 구분 */
export interface PictureRoleRule { from: number; to: number; role: PictureRole }
/** 플러그인이 띄운 그림 이름 규칙 → 구분. "폴더/"는 그 폴더 안 그림, *는 아무 글자, 나머지는 이름 열쇠(spriteKeyOf)와 같은 것 */
export interface SpriteRoleRule { pattern: string; role: PictureRole }

export interface AdapterDefaults {
  addons?: Partial<Record<AddonId, boolean>>;
  pictureRoles?: PictureRoleRule[];
  spriteRoles?: SpriteRoleRule[];
}

export interface AdapterManifest {
  id: string;
  label: string;
  description: string;
  match: AdapterMatch;
  /** 게임 쪽 확장 파일 이름(어댑터 폴더 안) */
  bridgeScript?: string;
  defaults?: AdapterDefaults;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const RULES_MAX = 200;

const strings = (v: unknown, max = 50): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map(s => s.trim()).slice(0, max) : [];

/** "decoration"은 화면 장식(hud)과 같다 */
function roleOfText(v: unknown): PictureRole | null {
  if (v === "decoration") return "hud";
  return isPictureRole(v) ? v : null;
}

function pictureRules(v: unknown): PictureRoleRule[] {
  const out: PictureRoleRule[] = [];
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, r] of Object.entries(v as Record<string, unknown>)) {
    if (out.length >= RULES_MAX) break;
    const role = roleOfText(r);
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(k);
    if (!role || !m) continue;
    const from = Number(m[1]), to = m[2] === undefined ? from : Number(m[2]);
    if (from >= 1 && to >= from && to <= 100000) out.push({ from, to, role });
  }
  return out;
}

function spriteRules(v: unknown): SpriteRoleRule[] {
  const out: SpriteRoleRule[] = [];
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, r] of Object.entries(v as Record<string, unknown>)) {
    if (out.length >= RULES_MAX) break;
    const role = roleOfText(r);
    if (role && k !== "" && k.length <= 200 && k !== "__proto__") out.push({ pattern: k, role });
  }
  return out;
}

/** manifest.json 본문(또는 읽은 값) → 어댑터. id(영문 소문자·숫자·-)·이름·설명·match가 없으면 null. */
export function parseManifest(v: unknown): AdapterManifest | null {
  try {
    const raw = typeof v === "string" ? JSON.parse(v) as unknown : v;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== "string" || !ID_RE.test(o.id)) return null;
    if (typeof o.label !== "string" || o.label.trim() === "") return null;
    const m = o.match;
    if (!m || typeof m !== "object" || Array.isArray(m)) return null;
    const mm = m as Record<string, unknown>;
    const match: AdapterMatch = {};
    const plugins = strings(mm.plugins), titles = strings(mm.gameTitle);
    if (plugins.length > 0) match.plugins = plugins;
    if (mm.pluginsMode === "any" || mm.pluginsMode === "all") match.pluginsMode = mm.pluginsMode;
    if (titles.length > 0) match.gameTitle = titles;
    if (!match.plugins && !match.gameTitle) return null;
    const out: AdapterManifest = {
      id: o.id, label: o.label.trim(), description: typeof o.description === "string" ? o.description : "", match,
    };
    if (typeof o.bridgeScript === "string" && /^[A-Za-z0-9_.-]+\.js$/.test(o.bridgeScript)) out.bridgeScript = o.bridgeScript;
    const d = o.defaults;
    if (d && typeof d === "object" && !Array.isArray(d)) {
      const dd = d as Record<string, unknown>;
      const defaults: AdapterDefaults = {};
      if (dd.addons && typeof dd.addons === "object" && !Array.isArray(dd.addons)) {
        const addons: Partial<Record<AddonId, boolean>> = {};
        for (const [k, b] of Object.entries(dd.addons as Record<string, unknown>)) if (isAddonId(k) && typeof b === "boolean") addons[k] = b;
        if (Object.keys(addons).length > 0) defaults.addons = addons;
      }
      const pr = pictureRules(dd.pictureRoles), sr = spriteRules(dd.spriteRoles);
      if (pr.length > 0) defaults.pictureRoles = pr;
      if (sr.length > 0) defaults.spriteRoles = sr;
      if (Object.keys(defaults).length > 0) out.defaults = defaults;
    }
    return out;
  } catch {
    return null;
  }
}

/** 어댑터를 고르는 데 쓰는 게임 정보: 켜진 플러그인 이름과 게임 제목 */
export interface GameTraits { plugins: readonly string[]; gameTitle?: string | null }

/** plugins.js 본문 → 켜진 플러그인 이름 */
export function enabledPluginsOf(pluginsText: string | null | undefined): string[] {
  try {
    const entries = typeof pluginsText === "string" ? parsePluginsJs(pluginsText) ?? [] : [];
    const out: string[] = [];
    for (const e of entries) {
      if (e && typeof e === "object" && e.status === true && typeof e.name === "string" && e.name.trim() !== "" && !out.includes(e.name.trim())) {
        out.push(e.name.trim());
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** 이 게임에 맞는 어댑터인가: 플러그인 조건(있으면)과 제목 조건(있으면)이 모두 맞아야 한다 */
export function matchesGame(m: AdapterManifest, game: GameTraits): boolean {
  try {
    const have = new Set((game.plugins ?? []).map(p => String(p).trim().toLowerCase()));
    const want = (m.match.plugins ?? []).map(p => p.toLowerCase());
    if (want.length > 0) {
      const ok = m.match.pluginsMode === "any" ? want.some(p => have.has(p)) : want.every(p => have.has(p));
      if (!ok) return false;
    }
    const titles = m.match.gameTitle ?? [];
    if (titles.length > 0) {
      const t = (game.gameTitle ?? "").toLowerCase();
      if (!titles.some(s => t.includes(s.toLowerCase()))) return false;
    }
    return want.length > 0 || titles.length > 0;
  } catch {
    return false;
  }
}

/** 어댑터 목록 중 이 게임에 맞는 것(목록 순서 그대로) */
export function matchingAdapters(list: readonly AdapterManifest[], game: GameTraits): AdapterManifest[] {
  return (Array.isArray(list) ? list : []).filter(m => m && matchesGame(m, game));
}

/** 게임 쪽 확장의 플러그인 이름(js/plugins/<이름>.js, plugins.js의 name) */
export const adapterPluginName = (id: string): string => `RPGViewerBridge_${id}`;

/** 어댑터를 켤 때 애드온 켜짐 상태에 기본값을 더한다(켜기만 한다 — 사용자가 켠 것은 그대로) */
export function applyAddonDefaults(state: AddonState, m: AdapterManifest | null | undefined): AddonState {
  const add = m?.defaults?.addons;
  if (!add) return state;
  const next: AddonState = { ...state };
  let changed = false;
  for (const [k, on] of Object.entries(add)) {
    if (on === true && isAddonId(k) && next[k] !== true) { next[k] = true; changed = true; }
  }
  return changed ? next : state;
}

/** 켜진 어댑터들의 그림 구분 기본값(앞의 어댑터가 먼저) */
export interface RoleDefaults { pictureRoles: PictureRoleRule[]; spriteRoles: SpriteRoleRule[] }

export function roleDefaultsOf(list: readonly AdapterManifest[]): RoleDefaults {
  const out: RoleDefaults = { pictureRoles: [], spriteRoles: [] };
  for (const m of Array.isArray(list) ? list : []) {
    if (m?.defaults?.pictureRoles) out.pictureRoles.push(...m.defaults.pictureRoles);
    if (m?.defaults?.spriteRoles) out.spriteRoles.push(...m.defaults.spriteRoles);
  }
  return out;
}

const globCache = new Map<string, RegExp>();
function globRe(pattern: string): RegExp {
  let re = globCache.get(pattern);
  if (!re) {
    re = new RegExp("^" + pattern.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    if (globCache.size > 500) globCache.clear();
    globCache.set(pattern, re);
  }
  return re;
}

/** 이름 규칙이 그림 이름에 맞는가("폴더/" = 그 폴더 안, * = 아무 글자(이름 또는 이름 열쇠), 나머지 = 이름 열쇠나 이름과 같음) */
export function spritePatternMatches(pattern: string, name: string): boolean {
  if (typeof pattern !== "string" || typeof name !== "string" || pattern === "") return false;
  if (pattern.endsWith("/") && !pattern.includes("*")) return name.startsWith(pattern);
  const key = spriteKeyOf(name);
  if (pattern.includes("*")) {
    const re = globRe(pattern);
    return re.test(name) || re.test(key);
  }
  return pattern === key || pattern === name;
}

/** 어댑터 기본값이 정한 그림 하나의 구분(없으면 null) */
export function defaultRoleOf(p: ScreenPicture, d: RoleDefaults | null | undefined): PictureRole | null {
  if (!d || !p) return null;
  try {
    if (p.kind === "sprite") {
      for (const r of d.spriteRoles) if (spritePatternMatches(r.pattern, p.name)) return r.role;
      return null;
    }
    for (const r of d.pictureRoles) if (p.id >= r.from && p.id <= r.to) return r.role;
  } catch { /* 없음 */ }
  return null;
}
