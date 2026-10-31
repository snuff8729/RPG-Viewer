import { describe, expect, it } from "vitest";
import { loadVoiceAuto, saveVoiceAuto, shouldAutoPlayVoice, VoiceAutoPosition } from "./voiceAuto";

const ready = { enabled: true, key: "r2", lastPlayed: null, hidden: false, hasVoice: true, now: 1400, settledSince: 1000 };
describe("reader voice auto-play", () => {
  it("allows replay after leaving a line and suppresses pending auto-play after manual playback", () => {
    const position = new VoiceAutoPosition();
    expect(position.observe("r2")).toBe(true);
    position.markPlayed();
    expect(position.observe("r2")).toBe(false);
    expect(shouldAutoPlayVoice({ ...ready, lastPlayed: position.lastPlayed() })).toBe(false);
    position.observe("silent"); position.observe("r2");
    expect(shouldAutoPlayVoice({ ...ready, lastPlayed: position.lastPlayed() })).toBe(true);
    position.markPlayed();
    expect(shouldAutoPlayVoice({ ...ready, lastPlayed: position.lastPlayed() })).toBe(false);
  });
  it("waits 400ms and plays only a new current line", () => {
    expect(shouldAutoPlayVoice({ ...ready, now: 1399 })).toBe(false);
    expect(shouldAutoPlayVoice(ready)).toBe(true);
    expect(shouldAutoPlayVoice({ ...ready, lastPlayed: "r2", now: 5000 })).toBe(false);
    expect(shouldAutoPlayVoice({ ...ready, lastPlayed: "r1" })).toBe(true);
  });
  it("defers on every fast-scroll update, even within the same long line", () => {
    for (const now of [1100, 1200, 1300, 1400]) expect(shouldAutoPlayVoice({ ...ready, now, settledSince: now - 100 })).toBe(false);
    expect(shouldAutoPlayVoice({ ...ready, now: 1800, settledSince: 1400 })).toBe(true);
  });
  it("keeps the settle clock through unrelated record updates and resets it on actual scroll", () => {
    const position = new VoiceAutoPosition();
    position.observe("r2", 1000);
    position.observe("r2", 1200); // same position, another record arrived
    expect(position.settledSince()).toBe(1000);
    position.observe("r2", 1300, true);
    expect(position.settledSince()).toBe(1300);
    expect(shouldAutoPlayVoice({ ...ready, now: 1699, settledSince: position.settledSince() })).toBe(false);
    expect(shouldAutoPlayVoice({ ...ready, now: 1700, settledSince: position.settledSince() })).toBe(true);
  });
  it("never auto-plays disabled, hidden, silent or absent lines", () => {
    for (const patch of [{ enabled: false }, { hidden: true }, { hasVoice: false }, { key: null }]) expect(shouldAutoPlayVoice({ ...ready, ...patch })).toBe(false);
  });
  it("defaults on, persists per viewer and tolerates unavailable storage", () => {
    const values = new Map<string, string>();
    const store = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
    expect(loadVoiceAuto(store)).toBe(true);
    saveVoiceAuto(false, store); expect(loadVoiceAuto(store)).toBe(false);
    saveVoiceAuto(true, store); expect(loadVoiceAuto(store)).toBe(true);
    const broken = { getItem: () => { throw new Error(); }, setItem: () => { throw new Error(); } };
    expect(loadVoiceAuto(broken)).toBe(true);
    expect(() => saveVoiceAuto(false, broken)).not.toThrow();
    expect(loadVoiceAuto(null)).toBe(true);
  });
});
