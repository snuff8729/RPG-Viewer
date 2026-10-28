import { beforeAll, describe, expect, it } from "vitest";
import { loadFixtureFolder } from "../../../tests/helpers/fixtureFolder";
import { fixtureRecords } from "../../../tests/helpers/fixtureLog";
import { loadGame } from "../loader/loadGame";
import type { GameData } from "../types";
import { explainRecord, reasonLabel } from "./mismatch";
import type { LogRecord } from "./types";

let data: GameData;
beforeAll(async () => {
  const r = await loadGame(loadFixtureFolder("sample-mz"));
  if (!r.ok) throw new Error("load failed");
  data = r.data;
});

const rec = (seq: number, patch: Record<string, unknown> = {}): LogRecord =>
  ({ ...fixtureRecords().find(r => r.seq === seq)!, ...patch }) as LogRecord;

describe("explainRecord", () => {
  it("returns null for matching records", () => {
    for (const seq of [2, 3, 4, 6, 7, 9, 10, 12, 31, 34]) expect(explainRecord(rec(seq), data)).toBeNull();
  });
  it("textChanged: message keeps all lines", () => {
    expect(explainRecord(rec(10, { text: "Thanks!" }), data)).toEqual({ reason: "textChanged", recorded: "Thanks!", expected: "고맙네!" });
    const e = explainRecord(rec(2, { text: "Hi.\nSecond" }), data)!;
    expect(e.reason).toBe("textChanged");
    expect(e.recorded).toBe("Hi.\nSecond");
    expect(e.expected).toBe("왔구나, \\N[1].\n숲이 이상하다는 소문은 들었겠지?");
  });
  it("textChanged: choices joined with ' / '", () => {
    expect(explainRecord(rec(7, { options: ["Yes", "No"] }), data))
      .toEqual({ reason: "textChanged", recorded: "Yes / No", expected: "네, 도울게요 / 생각해볼게요" });
  });
  it("faceMismatch", () => {
    expect(explainRecord(rec(3, { face: "Other" }), data)).toMatchObject({ reason: "faceMismatch" });
  });
  it("optionCount", () => {
    expect(explainRecord(rec(7, { options: ["a"] }), data))
      .toEqual({ reason: "optionCount", recorded: "a", expected: "네, 도울게요 / 생각해볼게요" });
  });
  it("codeMismatch", () => {
    expect(explainRecord(rec(9, { cmd: 11 }), data)).toMatchObject({ reason: "codeMismatch" });
    expect(explainRecord(rec(10, { cmd: 10 }), data))
      .toMatchObject({ reason: "codeMismatch", recorded: "고맙네!", expected: "네, 도울게요 / 생각해볼게요" });
  });
  it("noPage and noSource", () => {
    expect(explainRecord(rec(2, { src: { source: "map", mapId: 9, eventId: 1, page: 0 } }), data))
      .toMatchObject({ reason: "noPage", expected: "" });
    expect(explainRecord(rec(3, { src: null }), data))
      .toEqual({ reason: "noSource", recorded: "네… 밤마다 이상한 소리가 난다고요.", expected: "" });
  });
  it("non-dialogue records and odd input → null, never throws", () => {
    expect(explainRecord(rec(8), data)).toBeNull();
    expect(() => explainRecord(null as unknown as LogRecord, data)).not.toThrow();
    expect(() => explainRecord(rec(2), {} as GameData)).not.toThrow();
  });
});

describe("explainRecord: blank 401 lines", () => {
  // Map002 EV1 page0 맨 앞에 101 + 401(본문) 삽입
  const withMessage = (lines: string[] | null): GameData => {
    const maps = new Map(data.maps);
    const map = structuredClone(maps.get(2)!);
    const cmds = [{ code: 101, indent: 0, parameters: ["", 0, 0, 2, ""] },
      ...(lines ?? []).map(t => ({ code: 401, indent: 0, parameters: [t] }))];
    map.events[1]!.pages[0].list.splice(0, 0, ...cmds);
    maps.set(2, map);
    return { ...data, maps };
  };
  const msg = (text: string): LogRecord => ({
    v: 1, t: 0, run: 1, branch: 1, seq: 1, type: "message",
    src: { source: "map", mapId: 2, eventId: 1, page: 0 }, cmd: 0, face: "", faceIndex: 0, speaker: "", text,
  }) as unknown as LogRecord;

  it("blank single 401 + blank record → match", () => {
    expect(explainRecord(msg(""), withMessage([""]))).toBeNull();
  });
  it("non-blank data + blank record → textChanged", () => {
    expect(explainRecord(msg(""), withMessage(["안녕"]))).toMatchObject({ reason: "textChanged", recorded: "", expected: "안녕" });
  });
  it("blank data line + non-blank record → textChanged", () => {
    expect(explainRecord(msg("Hello"), withMessage([""]))).toMatchObject({ reason: "textChanged" });
  });
  it("no 401 + non-blank record → codeMismatch; no 401 + blank record → match", () => {
    expect(explainRecord(msg("Hello"), withMessage(null))).toMatchObject({ reason: "codeMismatch" });
    expect(explainRecord(msg(""), withMessage(null))).toBeNull();
  });
});

describe("reasonLabel", () => {
  it("Korean labels", () => {
    expect(reasonLabel("noSource")).toBe("출처를 알 수 없음");
    expect(reasonLabel("noPage")).toBe("페이지를 찾을 수 없음");
    expect(reasonLabel("codeMismatch")).toBe("명령 종류가 다름");
    expect(reasonLabel("faceMismatch")).toBe("얼굴 그래픽이 다름");
    expect(reasonLabel("optionCount")).toBe("선택지 개수가 다름");
    expect(reasonLabel("textChanged")).toBe("실행 중 본문이 바뀜");
  });
});
