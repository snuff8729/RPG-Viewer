import { describe, expect, it } from "vitest";
import {
  buildChapters, chapterVarCandidates, ChaptersCache, durationLabel, partIndexAt, partTitle, SCENE_MIN_LINES, sceneSourceKey, sceneTitle,
  SESSION_GAP_MS, valueFlow, whenLabel,
} from "./chapters";
import { newLineage, tagLineage } from "./lineage";
import type { LogRecord } from "./types";
import type { GameData, Location } from "../types";

const MIN = 60_000;
const T0 = new Date(2026, 9, 28, 22, 5).getTime();

/** 합성 기록 만들기: 차례로 seq를 붙이고 시각은 at(분)으로 */
function maker() {
  let seq = 0;
  let t = T0;
  const base = () => ({ v: 1 as const, seq: ++seq, t, run: 1, branch: 1 });
  return {
    wait(min: number) { t += min * MIN; },
    msg(src: Location | null, text = "대사"): LogRecord { t += 1000; return { ...base(), type: "message", src, cmd: 1, face: "", faceIndex: 0, speaker: "", text }; },
    talk(src: Location, n: number, first = "첫 대사"): LogRecord[] { return Array.from({ length: n }, (_, i) => this.msg(src, i === 0 ? first : "대사")); },
    transfer(mapId = 2): LogRecord { t += 1000; return { ...base(), type: "transfer", mapId, x: 0, y: 0 }; },
    pic(): LogRecord { t += 100; return { ...base(), type: "picture", src: null, cmd: 1, pictureId: 1, name: "a" }; },
    setVar(id: number, value: number, throttled = false): LogRecord {
      t += 1000;
      return { ...base(), type: "state", src: null, cmd: null, changes: [{ kind: "variable", id, value, ...(throttled ? { throttled: true as const } : {}) }] };
    },
  };
}

const ev = (eventId: number, mapId = 1, page = 0): Location => ({ source: "map", mapId, eventId, page });
const ce = (id: number): Location => ({ source: "common", commonEventId: id });

describe("parts (play sessions)", () => {
  it("splits where neighbouring records are more than 20 minutes apart", () => {
    const m = maker();
    const recs = [...m.talk(ev(1), 3)];
    m.wait(19);
    recs.push(m.msg(ev(1)));
    m.wait(21);
    recs.push(m.msg(ev(2)), m.msg(ev(2)));
    const ch = buildChapters(recs);
    expect(ch.parts.map((p) => p.seq)).toEqual([1, 5]);
    expect(ch.parts[0].lastSeq).toBe(4);
    expect(ch.heads.map((h) => h.seq)).toEqual([1, 5]);
    expect(SESSION_GAP_MS).toBe(20 * MIN);
  });

  it("always has one part when there are records, none without", () => {
    const m = maker();
    expect(buildChapters([m.msg(ev(1))]).parts).toHaveLength(1);
    expect(buildChapters([]).parts).toEqual([]);
  });
});

describe("scenes", () => {
  it("lists runs of 10+ lines from the same source, page does not matter", () => {
    const m = maker();
    const recs = [
      ...m.talk(ev(1), 6, "안녕"), m.pic(), ...m.talk(ev(1, 1, 2), 4),
      ...m.talk(ev(2), SCENE_MIN_LINES - 1),
      ...m.talk(ce(3), 12, "커먼"),
    ];
    const ch = buildChapters(recs);
    expect(ch.scenes.map((s) => [s.key, s.lines, s.firstText])).toEqual([["m1:1", 10, "안녕"], ["c3", 12, "커먼"]]);
    expect(ch.scenes[0].seq).toBe(1);
    expect(ch.scenes[0].lastSeq).toBe(11);
  });

  it("breaks runs on transfer, other sources, unknown sources and part boundaries", () => {
    const m = maker();
    const recs = [...m.talk(ev(1), 5), m.transfer(), ...m.talk(ev(1), 5), m.msg(null), ...m.talk(ev(1), 5)];
    m.wait(30);
    recs.push(...m.talk(ev(1), 5));
    expect(buildChapters(recs).scenes).toEqual([]);
  });

  it("marks a scene from an already listed source as seen again", () => {
    const m = maker();
    const recs = [...m.talk(ev(1), 10), ...m.talk(ev(2), 10), ...m.talk(ev(1), 11)];
    m.wait(25);
    recs.push(...m.talk(ev(2), 10));
    const ch = buildChapters(recs);
    expect(ch.scenes.map((s) => [s.key, s.again, s.part])).toEqual([["m1:1", false, 0], ["m1:2", false, 0], ["m1:1", true, 0], ["m1:2", true, 1]]);
  });

  it("shows the open run once it reaches the threshold", () => {
    const m = maker();
    const recs = m.talk(ev(1), 9);
    expect(buildChapters(recs).scenes).toEqual([]);
    expect(buildChapters([...recs, m.msg(ev(1))]).scenes).toHaveLength(1);
  });
});

describe("variable basis", () => {
  it("splits where the chosen variable changes value", () => {
    const m = maker();
    const recs = [m.msg(ev(1)), m.setVar(5, 1), m.msg(ev(1)), m.setVar(5, 1), m.setVar(6, 9), m.setVar(5, 2), ...m.talk(ev(1), 10)];
    m.wait(60); // 변수 기준이면 시간 차이로는 나누지 않는다
    recs.push(m.msg(ev(1)));
    const ch = buildChapters(recs, 5);
    expect(ch.varId).toBe(5);
    expect(ch.parts.map((p) => [p.seq, p.value])).toEqual([[1, null], [2, 1], [6, 2]]);
    expect(ch.scenes.map((s) => s.part)).toEqual([2]);
  });

  it("finds rising, rarely changing variables, name hints first", () => {
    const m = maker();
    const recs: LogRecord[] = [];
    for (let d = 1; d <= 5; d++) recs.push(m.setVar(1, d), m.setVar(2, d * 10));
    for (let i = 0; i < 10; i++) recs.push(m.setVar(3, i % 2)); // 오르내림이 잦다
    recs.push(m.setVar(4, 1), m.setVar(4, 2)); // 너무 적게 바뀜
    for (let i = 0; i < 5; i++) recs.push(m.setVar(7, i, true)); // 잦은 변수
    const data = { system: { variables: ["", "점수", "날짜"] } } as unknown as GameData;
    const c = chapterVarCandidates(recs, data);
    expect(c.map((x) => [x.id, x.named, x.changes])).toEqual([[2, true, 4], [1, false, 4]]);
    expect(c[0].values).toEqual([10, 20, 30, 40, 50]);
    expect(valueFlow([1, 2, 3, 4, 5, 6, 7, 13, 14])).toBe("1→2→3→…→13→14");
    expect(valueFlow([1, 2])).toBe("1→2");
  });
});

describe("incremental = full", () => {
  it("gives the same result record by record and resets when the basis changes", () => {
    const m = maker();
    const all: LogRecord[] = [];
    for (let k = 0; k < 4; k++) {
      all.push(...m.talk(ev(k % 2), 12), m.setVar(9, k + 1), m.transfer(), ...m.talk(ce(1), 3));
      m.wait(k * 15);
    }
    const lin = newLineage();
    const cache = new ChaptersCache();
    let prev: { obj: unknown; json: string } | null = null;
    for (let n = 1; n <= all.length; n++) {
      const path = tagLineage(all.slice(0, n), lin);
      const got = cache.get(path, n > all.length / 2 ? 9 : null);
      expect(got).toEqual(buildChapters(path, n > all.length / 2 ? 9 : null));
      // 앞에서 내준 결과는 바뀌지 않는다
      if (prev) expect(JSON.stringify(prev.obj)).toBe(prev.json);
      prev = { obj: got, json: JSON.stringify(got) };
    }
    // 같은 경로면 같은 객체
    const path = tagLineage(all.slice(), lin);
    expect(cache.get(path, 9)).toBe(cache.get(path, 9));
  });

  it("never throws on junk", () => {
    expect(buildChapters(null as unknown as LogRecord[]).parts).toEqual([]);
    expect(buildChapters([null, 3, { seq: "x" }] as unknown as LogRecord[]).parts).toEqual([]);
    expect(new ChaptersCache().get(undefined as unknown as LogRecord[]).parts).toEqual([]);
    expect(chapterVarCandidates(null as unknown as LogRecord[], null)).toEqual([]);
  });
});

describe("labels", () => {
  const data = {
    mapInfos: [null, { id: 1, name: "마을", parentId: 0, order: 1 }],
    maps: new Map([[1, { displayName: "", width: 1, height: 1, events: [null, { id: 1, name: "촌장", x: 0, y: 0, pages: [] }] }]]),
    commonEvents: [null, { id: 1, name: "회상", trigger: 0, switchId: 0, list: [] }],
    troops: [],
    system: { variables: ["", "일차"] },
  } as unknown as GameData;

  it("names sources", () => {
    expect(sceneTitle(ev(1), data)).toBe("마을 · 촌장");
    expect(sceneTitle(ev(5, 3), data)).toBe("맵 3 · 이벤트 5");
    expect(sceneTitle(ce(1), data)).toBe("회상");
    expect(sceneTitle({ source: "troop", troopId: 2, page: 0 }, data)).toBe("전투 · 적 무리 2");
    expect(sceneSourceKey(null)).toBeNull();
  });

  it("formats times, durations and part titles", () => {
    expect(whenLabel(T0)).toBe("10월 28일 밤 10:05");
    expect(whenLabel(new Date(2026, 0, 2, 0, 30).getTime())).toBe("1월 2일 새벽 12:30");
    expect(whenLabel(0)).toBe("");
    expect(durationLabel(130 * MIN)).toBe("2시간 10분");
    expect(durationLabel(45 * MIN)).toBe("45분");
    expect(durationLabel(120 * MIN)).toBe("2시간");
    expect(durationLabel(10_000)).toBe("1분 미만");
    expect(partTitle({ t: T0, value: null }, null, data)).toBe("10월 28일 밤 10:05");
    expect(partTitle({ t: T0, value: 3 }, 1, data)).toBe("「일차」 3");
    expect(partTitle({ t: T0, value: null }, 1, data)).toBe("「일차」 처음");
    expect(partTitle({ t: T0, value: 3 }, 7, data)).toBe("「변수 7」 3");
  });

  it("finds the part holding a record", () => {
    const parts = [{ seq: 1 }, { seq: 10 }, { seq: 20 }];
    expect([0, 1, 9, 10, 25].map((s) => partIndexAt(parts, s))).toEqual([-1, 0, 0, 1, 2]);
  });
});
