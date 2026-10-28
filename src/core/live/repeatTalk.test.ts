import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import { branchPath, buildHistory, episodePictureKey, foldTimeline } from "./history";
import { readerItems, type ReaderItem } from "./reader";
import { picturesBySeq, scenesBySeq, type PictureContext } from "../addons/screenPictures";
import type { LogRecord } from "./types";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

const base = { v: 1, run: 1, branch: 1, t: 0 } as const;
const src = { source: "map", mapId: 1, eventId: 2, page: 0 } as const;
const bs = (seq: number): LogRecord => ({ ...base, seq, type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null });
const msg = (seq: number, cmd: number, text: string, pics?: unknown[]): LogRecord =>
  ({ ...base, seq, type: "message", src, cmd, face: "", faceIndex: 0, speaker: "", text, ...(pics ? { pics } : {}) }) as LogRecord;
const notice = (seq: number, text: string): LogRecord => ({ ...base, seq, type: "notice", source: "ticker", text });
const transfer = (seq: number): LogRecord => ({ ...base, seq, type: "transfer", mapId: 1, x: 0, y: 0 });
const CUT = (name: string) => [5, name, 0, 0, 0, 100, 100, 255, 0, 0, 0, 816, 624];
const STAND = [3, "stand_a", 0, 300, 100, 100, 100, 255, 0, 0, 0, 200, 400];

const reader = (recs: LogRecord[], hidden?: (n: string) => boolean) => {
  const model = buildHistory(recs);
  const path = branchPath(recs, model, 1);
  const ctx: PictureContext = { screen: { width: 816, height: 624 }, hidden: hidden ?? null };
  return readerItems(foldTimeline(path, model, { isHiddenImage: hidden ?? null }), data, new Map(), model, null, scenesBySeq(picturesBySeq(path), ctx));
};
const talk = (start: number, pics?: unknown[]) => [msg(start, 0, "hello", pics), msg(start + 1, 1, "again", pics)];
const repeats = (items: ReaderItem[]) => items.filter((i): i is Extract<ReaderItem, { kind: "message" }> => i.kind === "message" && i.repeat !== undefined);

describe("repeated talks keep their pictures", () => {
  it("picture key: names only, hidden images left out", () => {
    expect(episodePictureKey([msg(1, 0, "a", [STAND, CUT("cut_b")])])).toBe("cut_b\nstand_a");
    expect(episodePictureKey([msg(1, 0, "a", [STAND, CUT("Guage")])], n => n.startsWith("Guage"))).toBe("stand_a");
  });

  it("same text but a new image is not folded (the image stays visible)", () => {
    const recs = [bs(1), ...talk(2, [STAND]), transfer(4), ...talk(5, [STAND, CUT("cut_new")])];
    const out = reader(recs);
    expect(repeats(out)).toHaveLength(0);
    const shots = out.flatMap(i => (i.kind === "message" && i.screen ? [i.screen.pictures.map(p => p.name)] : []));
    expect(shots.some(names => names.includes("cut_new"))).toBe(true);
  });

  it("same text and same images still fold, with every occurrence's content kept", () => {
    const recs = [bs(1), ...talk(2, [STAND]), transfer(4), ...talk(5, [STAND]), transfer(7), ...talk(8, [STAND])];
    const out = reader(recs);
    const r = repeats(out);
    expect(r).toHaveLength(2); // transfer between them makes each its own fold
    expect(r[0]).toMatchObject({ key: "r5", repeat: 1 });
    expect(r[0].occurrences?.map(o => o.map(x => x.kind === "message" ? x.lines.join("") : x.kind))).toEqual([["hello", "again"]]);
  });

  it("the fold keeps its key while more occurrences arrive, listing each one", () => {
    const first = [bs(1), ...talk(2, [STAND]), ...talk(4, [STAND])];
    const more = [...first, ...talk(6, [STAND])];
    const a = repeats(reader(first));
    const b = repeats(reader(more));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].key).toBe("r4");
    expect(b[0].key).toBe("r4");
    expect(b[0].repeat).toBe(2);
    expect(b[0].occurrences?.map(o => o.map(x => x.key))).toEqual([["r4", "r5"], ["r6", "r7"]]);
  });

  it("an image a folded talk leaves on screen is shown outside the fold", () => {
    // 1st talk shows the cut-in, then the screen goes back to the stand; the same talk with the same cut-in folds
    const recs = [bs(1), ...talk(2, [STAND, CUT("cut_x")]), notice(4, "x"), msg(5, 9, "map", [STAND]), ...talk(6, [STAND, CUT("cut_x")])];
    const out = reader(recs);
    const r = repeats(out);
    expect(r).toHaveLength(1);
    expect(r[0].screen?.pictures.map(p => p.name)).toContain("cut_x");
    // inside the fold the occurrence keeps its own picture too
    const inner = r[0].occurrences?.[0] ?? [];
    expect(inner.some(x => x.kind === "message" && x.screen?.pictures.some(p => p.name === "cut_x"))).toBe(true);
  });
});
