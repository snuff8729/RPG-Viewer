import type { EventCommand, GameData, Location } from "../types";
import { pageList } from "./mismatch";
import { extendsArray } from "./lineage";
import type { LogRecord, RecordOf, VoiceSound } from "./types";

const DISPLAY = new Set([101, 102, 103, 104, 105]);
export const NO_VOICES: readonly VoiceSound[] = [];

export function voiceSound(value: unknown, folder = "se"): VoiceSound | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Partial<VoiceSound>;
  if (typeof s.name !== "string" || !s.name || typeof folder !== "string" || !folder) return null;
  const num = (v: unknown, fallback: number) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return { folder, name: s.name, volume: num(s.volume, 90), pitch: num(s.pitch, 100), pan: num(s.pan, 0) };
}

/** 옛 기록: 표시 명령 전까지 거슬러 Play SE를 찾되, 실제 재생 순서로 돌려준다. */
export function playSeBefore(list: readonly EventCommand[] | null, cmd: number | null): VoiceSound[] {
  if (!list || cmd === null || !Number.isInteger(cmd) || cmd < 0 || list[cmd]?.code !== 101) return [];
  const sounds: VoiceSound[] = [];
  for (let i = cmd - 1; i >= 0; i--) {
    const c = list[i];
    if (!c || DISPLAY.has(c.code)) break;
    if (c.code === 250) {
      const sound = voiceSound(c.parameters?.[0]);
      if (sound) sounds.push(sound);
    }
  }
  return sounds.reverse();
}

export function fallbackVoices(data: GameData | undefined | null, src: Location | null, cmd: number | null): VoiceSound[] {
  return data && src ? playSeBefore(pageList(data, src), cmd) : [];
}

export class VoiceFallbackCache {
  private data: GameData | null | undefined;
  private cache = new Map<string, readonly VoiceSound[]>();
  constructor(data: GameData | null | undefined) { this.data = data; }
  get(src: Location | null, cmd: number | null): readonly VoiceSound[] {
    const key = JSON.stringify([src, cmd]);
    if (!this.cache.has(key)) this.cache.set(key, fallbackVoices(this.data, src, cmd));
    return this.cache.get(key)!;
  }
}

/** 대사 뒤에 도착한 voice도 연결한다. 같은 seq라도 다른 run·branch이면 무시. 결과는 불변. */
export class VoiceRecordsCache {
  private prev: readonly LogRecord[] | null = null;
  private messages = new Map<number, RecordOf<"message">>();
  private out: ReadonlyMap<number, readonly VoiceSound[]> = new Map();

  get(records: LogRecord[]): ReadonlyMap<number, readonly VoiceSound[]> {
    const resume = this.prev !== null && extendsArray(this.prev, records);
    if (!resume) { this.messages = new Map(); this.out = new Map(); }
    let changed: Map<number, readonly VoiceSound[]> | null = null;
    const put = (seq: number, voice: readonly VoiceSound[]) => {
      if (!changed) changed = new Map(this.out);
      changed.set(seq, voice);
    };
    for (let i = resume ? this.prev!.length : 0; i < records.length; i++) {
      const r = records[i];
      if (r.type === "message") {
        this.messages.set(r.seq, r);
        if (Array.isArray(r.voice)) put(r.seq, r.voice.map(s => voiceSound(s, s?.folder)).filter((s): s is VoiceSound => s !== null));
      } else if (r.type === "voice") {
        const m = this.messages.get(r.msg);
        const sound = voiceSound(r, r.folder);
        if (m && sound && m.run === r.run && m.branch === r.branch) {
          put(r.msg, [...((changed ?? this.out).get(r.msg) ?? NO_VOICES), sound]);
        }
      }
    }
    this.prev = records;
    if (changed) this.out = changed;
    return this.out;
  }
}

export function mergeVoiceRecords(records: LogRecord[]): ReadonlyMap<number, readonly VoiceSound[]> {
  return new VoiceRecordsCache().get(records);
}
