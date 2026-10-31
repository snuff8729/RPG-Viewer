import type { AssetStore } from "./assets";
import type { VoiceSound } from "../live/types";

/** 한 뷰어의 음성 재생. 새 요청·정지·언마운트는 읽는 중인 파일도 취소한다. */
export class VoicePlayer {
  private generation = 0;
  private playing = new Set<{ audio: HTMLAudioElement; url: string }>();
  private blocked: readonly VoiceSound[] | null = null;

  private assets: AssetStore;
  constructor(assets: AssetStore) { this.assets = assets; }

  stop(): void {
    this.generation++;
    this.blocked = null;
    for (const clip of this.playing) {
      clip.audio.onended = null; clip.audio.onerror = null;
      clip.audio.pause();
      clip.audio.removeAttribute("src");
      clip.audio.load();
      URL.revokeObjectURL(clip.url);
    }
    this.playing.clear();
  }

  /** 첫 클릭·키 입력에서 브라우저가 막았던 현재 줄만 다시 시도한다. */
  unlock(): void {
    const sounds = this.blocked;
    if (sounds) void this.play(sounds);
  }

  async play(sounds: readonly VoiceSound[]): Promise<void> {
    this.stop();
    const generation = this.generation;
    await Promise.all(sounds.map(async sound => {
      const blob = await this.assets.audio(sound.folder, sound.name);
      if (!blob || generation !== this.generation) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const clip = { audio, url };
      const release = () => {
        if (!this.playing.delete(clip)) return;
        audio.onended = null; audio.onerror = null;
        audio.removeAttribute("src");
        audio.load();
        URL.revokeObjectURL(url);
      };
      this.playing.add(clip);
      audio.onended = release;
      audio.onerror = release;
      audio.volume = Math.max(0, Math.min(1, sound.volume / 100));
      audio.playbackRate = Math.max(0.25, Math.min(4, sound.pitch / 100));
      audio.preservesPitch = false;
      try { await audio.play(); } catch (error) {
        if (generation === this.generation && error instanceof Error && error.name === "NotAllowedError") this.blocked = sounds;
        release(); // 첫 사용자 동작 전 브라우저가 막으면 조용히 둔다
      }
    }));
  }
}
