import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { loadGame } from "../loader/loadGame";
import { formatText } from "../text/escape";
import type { GameData } from "../types";
import { withActorNames } from "./actorNames";
import { buildHistory, foldTimeline } from "./history";
import { readerItems } from "./reader";
import type { LogRecord } from "./types";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

describe("withActorNames (live.json actorNames, 1.19.1)", () => {
  it("expands \\N[1] with the name changed in play", () => {
    const dbName = data.actors[1]!.name;
    expect(formatText("\\N[1]", data)).toBe(dbName);
    const live = withActorNames(data, { 1: "아마네" });
    expect(formatText("\\N[1]와 함께", live)).toBe("아마네와 함께");
    expect(data.actors[1]!.name).toBe(dbName); // the loaded data stays as is
  });

  it("returns the same object for no / unchanged names and for the same names again", () => {
    expect(withActorNames(data, undefined)).toBe(data);
    expect(withActorNames(data, {})).toBe(data);
    expect(withActorNames(data, { 1: data.actors[1]!.name })).toBe(data);
    expect(withActorNames(data, { 9999: "없음", x: "?", 1: "" } as Record<string, string>)).toBe(data);
    const a = withActorNames(data, { 1: "아마네" });
    expect(withActorNames(data, { 1: "아마네" })).toBe(a);
    expect(withActorNames(data, { 1: "리나" })).not.toBe(a);
  });

  it("reader uses the runtime name for \\N[n], the speaker and the face fallback", () => {
    const actor = data.actors[1]!;
    const recs = [
      { v: 1, run: 1, branch: 1, t: 0, seq: 1, type: "branchStart", reason: "newGame", parentBranch: null, fromSeq: null },
      { v: 1, run: 1, branch: 1, t: 0, seq: 2, type: "message", src: null, cmd: 0, face: "", faceIndex: 0, speaker: "\\N[1]", text: "나는 \\N[1]" },
      { v: 1, run: 1, branch: 1, t: 0, seq: 3, type: "message", src: null, cmd: 1, face: actor.faceName, faceIndex: actor.faceIndex, speaker: "", text: "안녕" },
    ] as LogRecord[];
    const m = buildHistory(recs);
    const items = readerItems(foldTimeline(recs, m, {}), withActorNames(data, { 1: "아마네" }), new Map(), m);
    const msgs = items.filter(i => i.kind === "message");
    expect(msgs[0]).toMatchObject({ speaker: "아마네", lines: ["나는 아마네"] });
    expect(msgs[1]).toMatchObject({ speaker: "아마네" });
  });
});
