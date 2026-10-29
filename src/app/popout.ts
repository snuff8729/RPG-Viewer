/**
 * 플레이 화면의 기능 하나(맵·치트·보조·읽기)만 따로 띄운 창("새 창으로 떼기").
 * 주소: `<pathname>?module=<m>&game=<최근 게임 key>#/play`. 창 위치·크기는 모듈마다 이 브라우저의 localStorage에 기억한다.
 * 떼어 낸 창은 BroadcastChannel로 "여기 있어요"를 주기적으로 알리고(heartbeat), 원래 창은 그 알림으로 자리를 비워 둔다.
 * 이 파일은 순수 계산만(창·채널은 ui/live/popouts.ts). 모든 함수는 예외를 던지지 않는다.
 */

export const POPOUT_MODULES = ["map", "cheat", "assist", "reader"] as const;
export type PopoutModule = (typeof POPOUT_MODULES)[number];

export const POPOUT_LABEL: Record<PopoutModule, string> = { map: "맵", cheat: "치트", assist: "게임 보조", reader: "읽기" };

export const isPopoutModule = (v: unknown): v is PopoutModule => (POPOUT_MODULES as readonly unknown[]).includes(v);

// ── 주소 ──

export interface ModuleWindowParams {
  module: PopoutModule;
  /** 다시 열 최근 게임 key(모르면 "") */
  game: string;
}

/** 모듈 창이면 모듈과 게임 key, 아니면 null(모르는 모듈 이름도 null). */
export function parseModuleWindow(search: string): ModuleWindowParams | null {
  const p = new URLSearchParams(search);
  const module = p.get("module");
  if (!isPopoutModule(module)) return null;
  return { module, game: p.get("game") ?? "" };
}

/** 모듈 하나만 띄울 주소 */
export function moduleWindowUrl(pathname: string, module: PopoutModule, gameKey: string | undefined): string {
  return `${pathname}?${new URLSearchParams({ module, game: gameKey ?? "" }).toString()}#/play`;
}

/** window.open 창 이름(모듈마다 같은 창을 다시 쓴다) */
export const moduleWindowName = (module: PopoutModule) => `rpgv-popout-${module}`;

// ── 창 위치·크기 ──

/** x·y = 창 바깥 왼쪽 위(screenX/Y), w·h = 창 안 크기(innerWidth/Height — window.open의 width/height와 같은 기준) */
export interface Geometry { x: number; y: number; w: number; h: number }

/** 쓸 수 있는 화면 영역(screen.availLeft/Top/Width/Height) */
export interface ScreenArea { left: number; top: number; width: number; height: number }

export const MIN_POPOUT = { w: 320, h: 240 } as const;

export const geometryKey = (module: PopoutModule) => `rpgv.popout.${module}`;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 저장된 글 → 위치·크기. 없거나 깨졌으면 null. */
export function parseGeometry(raw: string | null | undefined): Geometry | null {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { x, y, w, h } = v as Record<string, unknown>;
    if (!finite(x) || !finite(y) || !finite(w) || !finite(h) || w <= 0 || h <= 0) return null;
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  } catch {
    return null;
  }
}

export const serializeGeometry = (g: Geometry): string => JSON.stringify({ x: g.x, y: g.y, w: g.w, h: g.h });

export const sameGeometry = (a: Geometry | null, b: Geometry | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/** 처음 띄울 자리: 화면 왼쪽 위에서 모듈마다 조금씩 비켜서, 모듈에 맞는 크기 */
export function defaultGeometry(module: PopoutModule, screen: ScreenArea): Geometry {
  const size: Record<PopoutModule, { w: number; h: number }> = {
    map: { w: 720, h: 720 }, cheat: { w: 560, h: 860 }, assist: { w: 420, h: 860 }, reader: { w: 560, h: 900 },
  };
  const i = POPOUT_MODULES.indexOf(module);
  return clampGeometry({ x: screen.left + 40 + i * 32, y: screen.top + 40 + i * 32, ...size[module] }, screen);
}

/** 화면 밖·화면보다 큰 자리를 화면 안으로(크기를 먼저 줄이고 위치를 옮긴다). 화면을 모르면(0) 크기 최소값만 지킨다. */
export function clampGeometry(g: Geometry, screen: ScreenArea, min: { w: number; h: number } = MIN_POPOUT): Geometry {
  if (!(screen.width > 0) || !(screen.height > 0)) return { ...g, w: Math.max(min.w, g.w), h: Math.max(min.h, g.h) };
  const w = Math.min(Math.max(min.w, g.w), screen.width);
  const h = Math.min(Math.max(min.h, g.h), screen.height);
  const x = Math.min(Math.max(screen.left, g.x), screen.left + screen.width - w);
  const y = Math.min(Math.max(screen.top, g.y), screen.top + screen.height - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** window.open 세 번째 인자 */
export const windowFeatures = (g: Geometry): string => `popup,left=${g.x},top=${g.y},width=${g.w},height=${g.h}`;

// ── 떼어 낸 창 알림(BroadcastChannel) ──

export const POPOUT_CHANNEL = "rpgv-popout";
/** 떼어 낸 창이 "여기 있어요"를 보내는 간격 */
export const HEARTBEAT_MS = 1500;
/** 이만큼 소식이 없으면 닫힌 것으로 본다 */
export const PRESENCE_TTL_MS = 5000;
/** 막 연 창이 뜨는 동안(첫 알림 전) 기다려 주는 시간 */
export const OPENING_GRACE_MS = 20_000;

export type PopoutMessage =
  /** 떼어 낸 창: 여기 있어요 */
  | { type: "here"; module: PopoutModule; game: string }
  /** 떼어 낸 창: 닫혀요 */
  | { type: "gone"; module: PopoutModule; game: string }
  /** 원래 창: 떼어 낸 창은 알려 주세요 */
  | { type: "ping" }
  /** 원래 창: 그 모듈을 다시 가져가요(떼어 낸 창은 닫는다) */
  | { type: "reclaim"; module: PopoutModule; game: string };

export function parsePopoutMessage(v: unknown): PopoutMessage | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.type === "ping") return { type: "ping" };
  if ((o.type === "here" || o.type === "gone" || o.type === "reclaim") && isPopoutModule(o.module) && typeof o.game === "string") {
    return { type: o.type, module: o.module, game: o.game };
  }
  return null;
}

/** 떼어 낸 모듈: "게임 key|모듈" → 이때까지 있다고 본다(ms) */
export type Presence = Readonly<Record<string, number>>;

export const presenceKey = (module: PopoutModule, game: string) => `${game}|${module}`;

/** 알림 하나를 반영한다. 바뀌지 않으면 같은 객체. */
export function presenceReduce(p: Presence, msg: PopoutMessage, now: number): Presence {
  if (msg.type === "here") return { ...p, [presenceKey(msg.module, msg.game)]: now + PRESENCE_TTL_MS };
  if (msg.type === "gone" || msg.type === "reclaim") {
    const k = presenceKey(msg.module, msg.game);
    if (!(k in p)) return p;
    const next = { ...p };
    delete next[k];
    return next;
  }
  return p;
}

/** 막 연 창: 첫 알림 전에도 떼어 낸 것으로 본다(창이 안 뜨면 OPENING_GRACE_MS 뒤에 돌아온다) */
export function presenceOpening(p: Presence, module: PopoutModule, game: string, now: number): Presence {
  const k = presenceKey(module, game);
  return { ...p, [k]: Math.max(p[k] ?? 0, now + OPENING_GRACE_MS) };
}

/** 기한이 지난 항목을 뺀다. 바뀌지 않으면 같은 객체. */
export function presenceExpire(p: Presence, now: number): Presence {
  const dead = Object.keys(p).filter((k) => p[k] <= now);
  if (dead.length === 0) return p;
  const next = { ...p };
  for (const k of dead) delete next[k];
  return next;
}

export const isPoppedOut = (p: Presence, module: PopoutModule, game: string, now: number): boolean =>
  (p[presenceKey(module, game)] ?? 0) > now;
