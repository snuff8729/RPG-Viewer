import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetStore } from "./assets";
import { VoicePlayer } from "./voicePlayer";

const sound = { folder: "se", name: "line", volume: 80, pitch: 120, pan: 50 };
class FakeAudio {
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null; onerror: (() => void) | null = null;
  volume = 1; playbackRate = 1; preservesPitch = true;
  pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn();
  play = vi.fn(async () => {});
  constructor() { FakeAudio.instances.push(this); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); FakeAudio.instances = []; });
function setup(audio: () => Promise<Blob | null> = async () => new Blob(["audio"])) {
  vi.stubGlobal("Audio", FakeAudio);
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice");
  return { player: new VoicePlayer({ audio } as unknown as AssetStore), revoke };
}
describe("voice player lifetime", () => {
  it("applies volume and pitch, then revokes URLs when stopped or finished", async () => {
    const { player, revoke } = setup();
    await player.play([sound]);
    const first = FakeAudio.instances[0];
    expect(first.volume).toBe(0.8); expect(first.playbackRate).toBe(1.2); expect(first.preservesPitch).toBe(false);
    await player.play([sound]);
    expect(first.pause).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledTimes(1);
    FakeAudio.instances[1].onended?.();
    player.stop();
    expect(revoke).toHaveBeenCalledTimes(2);
  });
  it("scales by the global gain, including a clip that is already playing", async () => {
    const { player } = setup();
    player.setGain(0.5);
    await player.play([sound]);
    const clip = FakeAudio.instances[0];
    expect(clip.volume).toBeCloseTo(0.4);
    player.setGain(0);
    expect(clip.volume).toBe(0);
    player.setGain(1);
    expect(clip.volume).toBeCloseTo(0.8);
  });
  it("never starts a stale asynchronous clip after stop or a newer line", async () => {
    let resolve!: (b: Blob) => void;
    const { player, revoke } = setup(() => new Promise(r => { resolve = r; }));
    const pending = player.play([sound]);
    player.stop(); resolve(new Blob(["audio"])); await pending;
    expect(FakeAudio.instances).toHaveLength(0); expect(revoke).not.toHaveBeenCalled();
  });
  it("silently handles autoplay rejection, missing assets and media errors", async () => {
    const { player, revoke } = setup();
    // The element's play promise rejects just as a browser does before activation.
    vi.stubGlobal("Audio", class extends FakeAudio { override play = vi.fn(async () => { throw new DOMException("blocked", "NotAllowedError"); }); });
    await expect(player.play([sound])).resolves.toBeUndefined();
    expect(revoke).toHaveBeenCalledOnce();
    const missing = new VoicePlayer({ audio: async () => null } as unknown as AssetStore);
    await missing.play([sound]); expect(FakeAudio.instances).toHaveLength(1);
    vi.stubGlobal("Audio", FakeAudio);
    await player.play([sound]); FakeAudio.instances[1].onerror?.();
    expect(revoke).toHaveBeenCalledTimes(2);
  });
  it("retries browser-blocked playback on interaction and discards it on stop", async () => {
    const { player } = setup();
    vi.stubGlobal("Audio", class extends FakeAudio { override play = vi.fn(async () => { throw new DOMException("blocked", "NotAllowedError"); }); });
    await player.play([sound]);
    vi.stubGlobal("Audio", FakeAudio);
    player.unlock(); await Promise.resolve(); await Promise.resolve();
    expect(FakeAudio.instances).toHaveLength(2);
    player.stop(); player.unlock();
    expect(FakeAudio.instances).toHaveLength(2);
  });
});
