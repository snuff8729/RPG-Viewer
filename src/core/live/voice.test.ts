import { describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { loadGame } from "../loader/loadGame";
import type { EventCommand, GameData } from "../types";
import { newLineage, tagLineage } from "./lineage";
import { buildHistory, foldTimeline } from "./history";
import type { LogRecord, RecordOf, VoiceSound } from "./types";
import { fallbackVoices, mergeVoiceRecords, playSeBefore, VoiceRecordsCache } from "./voice";

const sound: VoiceSound = { folder: "se", name: "hello", volume: 80, pitch: 110, pan: -10 };
const c = (code: number, parameters: unknown[] = []): EventCommand => ({ code, indent: 0, parameters });
const msg = (seq = 2, voice?: VoiceSound[]): RecordOf<"message"> => ({ v: 1, seq, run: 1, branch: 1, t: 0,
  type: "message", src: null, cmd: 0, face: "", faceIndex: 0, speaker: "", text: "hello", ...(voice === undefined ? {} : { voice }) });
const linked = (seq = 3, msgSeq = 2): RecordOf<"voice"> => ({ v: 1, seq, run: 1, branch: 1, t: 0, type: "voice", msg: msgSeq, ...sound });

describe("Play SE fallback", () => {
  it("walks past Wait, Comment and non-display commands in playback order", () => {
    const second = { ...sound, name: "two" };
    expect(playSeBefore([c(250, [sound]), c(230), c(108), c(408), c(121), c(250, [second]), c(101)], 6)).toEqual([sound, second]);
  });
  it.each([101, 102, 103, 104, 105])("stops at display command %i", display => {
    expect(playSeBefore([c(250, [sound]), c(display), c(230), c(101)], 3)).toEqual([]);
  });
  it("handles missing sources, invalid positions, empty sounds and list start", () => {
    for (const cmd of [-1, 99, 1.2, null]) expect(playSeBefore([c(101)], cmd)).toEqual([]);
    expect(playSeBefore(null, 0)).toEqual([]);
    expect(playSeBefore([c(101)], 0)).toEqual([]);
    expect(playSeBefore([c(250, [{ name: "" }]), c(250), c(101)], 2)).toEqual([]);
    expect(fallbackVoices(null, null, 0)).toEqual([]);
  });
  it("uses map, common-event, troop and TemplateEvent original page lists", async () => {
    const loaded = await loadGame(loadFixtureFolder("sample-mz"));
    if (!loaded.ok) throw new Error("fixture");
    const list = [c(250, [sound]), c(101)];
    const page = { list } as never;
    const data: GameData = { ...loaded.data,
      maps: new Map([[1, { events: [null, { pages: [page], originalPages: [page] }] } as never]]),
      commonEvents: [null, { list } as never], troops: [null, { pages: [page] } as never] };
    for (const src of [{ source: "map", mapId: 1, eventId: 1, page: 0 }, { source: "map", mapId: 1, eventId: 1, page: 0, origin: 0 },
      { source: "common", commonEventId: 1 }, { source: "troop", troopId: 1, page: 0 }] as const) expect(fallbackVoices(data, src, 1)).toEqual([sound]);
  });
});

describe("voice records merged onto messages", () => {
  it("does not split dialogue episodes or change repeat folding", () => {
    const src = { source: "common", commonEventId: 1 } as const;
    const a = { ...msg(2), src, cmd: 0 }, b = { ...msg(4), src, cmd: 2 };
    const again = [{ ...a, seq: 6 }, { ...b, seq: 8 }];
    const plain: LogRecord[] = [a, b, ...again];
    const withVoices: LogRecord[] = [a, linked(3), b, linked(5, 4), again[0], linked(7, 6), again[1], linked(9, 8)];
    const model = buildHistory(withVoices);
    expect(foldTimeline(withVoices, model, {})).toEqual(foldTimeline(plain, model, {}));
  });
  it("combines before/during sounds without mutating records or adding fallback to explicit silence", () => {
    const message = msg(2, [sound]);
    const records: LogRecord[] = [message, linked(), msg(4, [])];
    expect(mergeVoiceRecords(records).get(2)).toEqual([sound, sound]);
    expect(mergeVoiceRecords(records).get(4)).toEqual([]);
    expect(message.voice).toEqual([sound]);
    expect(mergeVoiceRecords([msg()]).has(2)).toBe(false);
    expect(mergeVoiceRecords([msg(), linked()]).get(2)).toEqual([sound]);
  });
  it("ignores orphan, future-message and cross-run/branch links", () => {
    expect(mergeVoiceRecords([linked(), msg()]).has(2)).toBe(false);
    expect(mergeVoiceRecords([msg(), { ...linked(), run: 2 }, { ...linked(4), branch: 2 }, linked(5, 999)]).has(2)).toBe(false);
  });
  it("updates earlier messages incrementally and leaves previous snapshots alone", () => {
    const cache = new VoiceRecordsCache(), lineage = newLineage();
    const first = tagLineage([msg(2, [])], lineage);
    const old = cache.get(first);
    const next = cache.get(tagLineage([...first, linked()], lineage));
    expect(old.get(2)).toEqual([]);
    expect(next.get(2)).toEqual([sound]);
    expect(cache.get(tagLineage([...first, linked(), { ...linked(4), msg: 999 }], lineage))).toBe(next);
    expect(cache.get([msg(10)]).has(2)).toBe(false);
  });
});
