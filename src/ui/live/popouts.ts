import { useEffect, useSyncExternalStore } from "react";
import {
  clampGeometry, defaultGeometry, geometryKey, HEARTBEAT_MS, moduleWindowName, moduleWindowUrl, parseGeometry,
  parsePopoutMessage, POPOUT_CHANNEL, presenceExpire, presenceKey, presenceOpening, presenceReduce, sameGeometry, serializeGeometry, windowFeatures,
  type Geometry, type PopoutMessage, type PopoutModule, type Presence, type ScreenArea,
} from "@/app/popout";
import { safeStore } from "./playLayout";

/**
 * 원래 창 쪽: 어떤 모듈이 따로 창에 떼어져 있는지(BroadcastChannel 알림), 떼기·다시 가져오기·창 보기.
 * 같은 브라우저의 모든 창이 같은 채널을 쓴다. 채널이 없는 브라우저에서는 이 창이 연 창이 열려 있는 동안만 안다.
 */

const store = safeStore();
let channel: BroadcastChannel | null = null;
let presence: Presence = {};
let snapshot = "";
const listeners = new Set<() => void>();
/** 이 창이 연 창(창 보기·닫힘 알아채기) */
const handles = new Map<PopoutModule, Window>();
let ticker: ReturnType<typeof setInterval> | null = null;

function refresh(): void {
  const now = Date.now();
  // 이 창이 연 창이 닫혔으면 바로 돌아온다(닫힘 알림을 못 받아도)
  for (const [m, w] of handles) {
    if (w.closed) {
      handles.delete(m);
      for (const k of Object.keys(presence)) if (k.endsWith(`|${m}`)) presence = presenceReduce(presence, { type: "gone", module: m, game: k.slice(0, k.lastIndexOf("|")) }, now);
    }
  }
  presence = presenceExpire(presence, now);
  const next = Object.keys(presence).sort().join("\n");
  if (next !== snapshot) {
    snapshot = next;
    for (const l of [...listeners]) l();
  }
}

function post(msg: PopoutMessage): void {
  try { channel?.postMessage(msg); } catch { /* 닫힌 채널 */ }
}

function start(): void {
  if (channel !== null || typeof window === "undefined") return;
  try {
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(POPOUT_CHANNEL);
  } catch { channel = null; }
  if (channel) {
    channel.onmessage = (e: MessageEvent) => {
      const msg = parsePopoutMessage(e.data);
      if (!msg) return;
      presence = presenceReduce(presence, msg, Date.now());
      refresh();
    };
    post({ type: "ping" });
  }
  ticker ??= setInterval(refresh, 1000);
}

function subscribe(cb: () => void): () => void {
  start();
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

const getSnapshot = () => snapshot;

/** 이 모듈이 지금 따로 창에 떼어져 있는지(그 게임에서) */
export function usePoppedOut(module: PopoutModule, game: string | undefined): boolean {
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => "");
  // 기한이 지난 항목은 refresh가 1초마다 빼므로 목록에 있으면 떼어져 있다
  return snap !== "" && snap.split("\n").includes(presenceKey(module, game ?? ""));
}

function screenArea(): ScreenArea {
  try {
    const s = window.screen as Screen & { availLeft?: number; availTop?: number };
    return { left: s.availLeft ?? 0, top: s.availTop ?? 0, width: s.availWidth, height: s.availHeight };
  } catch {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
}

/** 이 모듈 창을 띄울 자리: 기억한 자리(없으면 기본)를 화면 안으로 */
export function popoutGeometry(module: PopoutModule): Geometry {
  const screen = screenArea();
  const saved = parseGeometry(store.getItem(geometryKey(module)));
  return saved ? clampGeometry(saved, screen) : defaultGeometry(module, screen);
}

/** 모듈을 따로 창으로 뗀다(이미 떼어져 있으면 그 창을 앞으로). 클릭 핸들러 안에서 부를 것(팝업 차단). */
export function popOut(module: PopoutModule, game: string | undefined): void {
  start();
  const w = window.open(moduleWindowUrl(window.location.pathname, module, game), moduleWindowName(module), windowFeatures(popoutGeometry(module)));
  if (!w) return;
  handles.set(module, w);
  try { w.focus(); } catch { /* 다른 창 */ }
  presence = presenceOpening(presence, module, game ?? "", Date.now());
  refresh();
}

/** 떼어 낸 창을 앞으로(이 창이 연 창일 때만 알 수 있다). 알 수 없으면 false. */
export function focusPopout(module: PopoutModule): boolean {
  const w = handles.get(module);
  if (!w || w.closed) return false;
  try { w.focus(); return true; } catch { return false; }
}

/** 다시 가져오기: 떼어 낸 창을 닫고 원래 자리에 다시 보인다. */
export function reclaim(module: PopoutModule, game: string | undefined): void {
  start();
  const msg: PopoutMessage = { type: "reclaim", module, game: game ?? "" };
  post(msg);
  const w = handles.get(module);
  if (w && !w.closed) { try { w.close(); } catch { /* 이미 닫힘 */ } }
  handles.delete(module);
  presence = presenceReduce(presence, msg, Date.now());
  refresh();
}

// ── 떼어 낸 창 쪽 ──

/** 지금 창 자리(창 안 크기 기준) */
function currentGeometry(): Geometry {
  return { x: Math.round(window.screenX), y: Math.round(window.screenY), w: Math.round(window.innerWidth), h: Math.round(window.innerHeight) };
}

/**
 * 떼어 낸 창: 원래 창에 "여기 있어요"를 알리고(닫힐 때 "닫혀요"), 다시 가져가면 스스로 닫는다.
 * 창 위치·크기는 1초마다 보고 두 번 연속 같으면(움직임이 멈추면) 저장하고, 닫힐 때도 저장한다.
 */
export function useModuleWindow(module: PopoutModule, game: string): void {
  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try { ch = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(POPOUT_CHANNEL); } catch { ch = null; }
    const send = (msg: PopoutMessage) => { try { ch?.postMessage(msg); } catch { /* 닫힌 채널 */ } };
    const here = () => send({ type: "here", module, game });
    if (ch) {
      ch.onmessage = (e: MessageEvent) => {
        const msg = parsePopoutMessage(e.data);
        if (msg?.type === "ping") here();
        else if (msg?.type === "reclaim" && msg.module === module && msg.game === game) window.close();
      };
    }
    here();
    const beat = setInterval(here, HEARTBEAT_MS);

    let saved = parseGeometry(store.getItem(geometryKey(module)));
    let prev: Geometry | null = null;
    const save = (g: Geometry) => {
      if (g.w <= 0 || g.h <= 0 || sameGeometry(g, saved)) return;
      saved = g;
      store.setItem(geometryKey(module), serializeGeometry(g));
    };
    const poll = setInterval(() => {
      const g = currentGeometry();
      if (sameGeometry(g, prev)) save(g);
      prev = g;
    }, 1000);
    const onLeave = () => {
      save(currentGeometry());
      send({ type: "gone", module, game });
    };
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      clearInterval(beat);
      clearInterval(poll);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
      send({ type: "gone", module, game });
      try { ch?.close(); } catch { /* 이미 닫힘 */ }
    };
  }, [module, game]);
}
