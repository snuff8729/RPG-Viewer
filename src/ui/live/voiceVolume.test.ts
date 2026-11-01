import { describe, expect, it } from "vitest";
import { clampVoiceVolume, DEFAULT_VOICE_VOLUME, parseVoiceVolume, toggleVoiceMute, voiceGain } from "./voiceVolume";

describe("voice volume", () => {
  it("clamps to an integer 0–100, defaulting to 100", () => {
    expect(clampVoiceVolume(55.4)).toBe(55);
    expect(clampVoiceVolume(-3)).toBe(0);
    expect(clampVoiceVolume(250)).toBe(100);
    expect(clampVoiceVolume("40")).toBe(40);
    expect(clampVoiceVolume("x")).toBe(100);
    expect(clampVoiceVolume(undefined)).toBe(100);
  });
  it("parses stored text and falls back on anything broken", () => {
    expect(parseVoiceVolume(null)).toEqual(DEFAULT_VOICE_VOLUME);
    expect(parseVoiceVolume("{")).toEqual(DEFAULT_VOICE_VOLUME);
    expect(parseVoiceVolume("3")).toEqual(DEFAULT_VOICE_VOLUME);
    expect(parseVoiceVolume('{"volume":30,"muted":true}')).toEqual({ volume: 30, muted: true });
    expect(parseVoiceVolume('{"volume":999,"muted":"yes"}')).toEqual({ volume: 100, muted: false });
  });
  it("turns into a playback gain and toggles mute", () => {
    expect(voiceGain({ volume: 50, muted: false })).toBe(0.5);
    expect(voiceGain({ volume: 50, muted: true })).toBe(0);
    expect(toggleVoiceMute({ volume: 50, muted: false })).toEqual({ volume: 50, muted: true });
    expect(toggleVoiceMute({ volume: 50, muted: true })).toEqual({ volume: 50, muted: false });
    expect(toggleVoiceMute({ volume: 0, muted: false })).toEqual({ volume: 100, muted: false });
  });
});
