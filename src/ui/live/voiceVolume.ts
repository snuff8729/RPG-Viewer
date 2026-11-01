import { useCallback, useSyncExternalStore } from "react";
import type { StoreLike } from "./readPosition";

/**
 * 읽기 음성 소리(이 브라우저 전체에 하나). 0–100 + 음소거. 모든 음성 재생(다시 듣기·자동 재생)에 곱한다.
 * 같은 브라우저의 다른 창(따로 띄운 읽기 창 등)과는 storage 이벤트로 맞춘다.
 */
export interface VoiceVolume { volume: number; muted: boolean }

export const VOICE_VOLUME_KEY = "rpgv.voiceVolume";
export const DEFAULT_VOICE_VOLUME: VoiceVolume = { volume: 100, muted: false };

/** 0–100 정수로. 숫자가 아니면 기본값(100). */
export function clampVoiceVolume(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_VOICE_VOLUME.volume;
  return Math.round(Math.min(100, Math.max(0, n)));
}

/** 저장 글 → 값. 깨졌거나 없으면 기본값. */
export function parseVoiceVolume(raw: string | null): VoiceVolume {
  if (!raw) return DEFAULT_VOICE_VOLUME;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return DEFAULT_VOICE_VOLUME;
    const o = v as { volume?: unknown; muted?: unknown };
    return { volume: clampVoiceVolume(o.volume), muted: o.muted === true };
  } catch { return DEFAULT_VOICE_VOLUME; }
}

/** 재생에 곱할 배율(0–1) */
export function voiceGain(v: VoiceVolume): number {
  return v.muted ? 0 : v.volume / 100;
}

/** 음소거 단추: 끄면 음소거, 켜면 풀되 0이었으면 100으로. */
export function toggleVoiceMute(v: VoiceVolume): VoiceVolume {
  if (v.muted || v.volume === 0) return { volume: v.volume === 0 ? 100 : v.volume, muted: false };
  return { ...v, muted: true };
}

function defaultStore(): StoreLike | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

const listeners = new Set<() => void>();
let current: VoiceVolume | null = null;

function load(): VoiceVolume {
  try { return parseVoiceVolume(defaultStore()?.getItem(VOICE_VOLUME_KEY) ?? null); } catch { return DEFAULT_VOICE_VOLUME; }
}
function emit(): void { listeners.forEach(fn => fn()); }

let watching = false;
function watchOtherWindows(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("storage", e => {
    if (e.key !== VOICE_VOLUME_KEY && e.key !== null) return;
    current = load();
    emit();
  });
}

export function getVoiceVolume(): VoiceVolume {
  if (current === null) current = load();
  return current;
}

export function subscribeVoiceVolume(fn: () => void): () => void {
  watchOtherWindows();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function setVoiceVolume(next: VoiceVolume): void {
  const v = { volume: clampVoiceVolume(next.volume), muted: next.muted };
  const prev = getVoiceVolume();
  if (prev.volume === v.volume && prev.muted === v.muted) return;
  current = v;
  try { defaultStore()?.setItem(VOICE_VOLUME_KEY, JSON.stringify(v)); } catch { /* 저장소 사용 불가 */ }
  emit();
}

export function useVoiceVolume(): [VoiceVolume, (v: VoiceVolume) => void] {
  const v = useSyncExternalStore(subscribeVoiceVolume, getVoiceVolume);
  const set = useCallback((next: VoiceVolume) => setVoiceVolume(next), []);
  return [v, set];
}
