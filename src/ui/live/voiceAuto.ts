import type { StoreLike } from "./readPosition";

export const VOICE_SETTLE_MS = 400;
/** 위치 변화만 재생을 다시 허용한다. 수동 재생은 현재 위치의 자동 재생 대기도 함께 끝낸다. */
export class VoiceAutoPosition {
  private key: string | null = null;
  private played: string | null = null;
  private motionAt = 0;
  observe(key: string | null, now = Date.now(), scrolling = false): boolean {
    if (scrolling || key !== this.key) this.motionAt = now;
    if (this.key === key) return false;
    this.key = key;
    this.played = null;
    return true;
  }
  markPlayed(): void { this.played = this.key; }
  lastPlayed(): string | null { return this.played; }
  settledSince(): number { return this.motionAt; }
}
const KEY = "rpgv.voiceAuto";
function defaultStore(): StoreLike | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
export function loadVoiceAuto(store: StoreLike | null = defaultStore()): boolean {
  try { return store?.getItem(KEY) !== "0"; } catch { return true; }
}
export function saveVoiceAuto(on: boolean, store: StoreLike | null = defaultStore()): void {
  try { store?.setItem(KEY, on ? "1" : "0"); } catch { /* 저장소 사용 불가 */ }
}

/** 현재 줄이 바뀌었거나 스크롤한 뒤 충분히 멈춘 경우만. 숨긴 줄은 펼쳐도 자동 재생하지 않는다. */
export function shouldAutoPlayVoice(input: {
  enabled: boolean; key: string | null; lastPlayed: string | null; hidden: boolean; hasVoice: boolean;
  now: number; settledSince: number;
}): boolean {
  return input.enabled && input.key !== null && input.key !== input.lastPlayed && !input.hidden && input.hasVoice
    && input.now - input.settledSince >= VOICE_SETTLE_MS;
}
