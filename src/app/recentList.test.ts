import { describe, expect, it } from "vitest";
import {
  MAX_RECENT, parseRecent, pruneRecent, recentKey, removeRecent, setPinned, splitRecent, touchRecent,
  type RecentInput, type RecentItem,
} from "./recentList";

const server = (path: string, title = "T", gameKey = `${title}|www/data`): RecentInput =>
  ({ kind: "server", path, name: path.split(/[\\/]/).pop()!, title, gameKey });
const handle = (name: string, title = "T", gameKey = `${title}|www/data`): RecentInput =>
  ({ kind: "handle", name, title, gameKey });

function openAll(inputs: RecentInput[]): RecentItem[] {
  let list: RecentItem[] = [];
  inputs.forEach((inp, i) => { list = pruneRecent(touchRecent(list, inp, i + 1)).kept; });
  return list;
}

describe("recent games list", () => {
  it("dedupes server entries by path, ignoring case and slashes", () => {
    let list = touchRecent([], server("C:\\Games\\A", "A"), 1);
    list = touchRecent(list, server("c:/games/a/", "A"), 2);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ openedAt: 2, path: "c:/games/a/" });
  });

  it("dedupes handle entries by folder name + game key, keeps different games apart", () => {
    let list = touchRecent([], handle("A", "A"), 1);
    list = touchRecent(list, handle("A", "A"), 2);
    list = touchRecent(list, handle("A", "B"), 3);
    expect(list.map((it) => it.title)).toEqual(["B", "A"]);
  });

  it("a server entry replaces the same game opened earlier through the browser", () => {
    let list = touchRecent([], handle("A", "Alpha"), 1);
    list = setPinned(list, list[0].key, true);
    list = touchRecent(list, server("C:/G/A", "Alpha"), 2);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "server", pinned: true });
  });

  it("a migrated handle without title is filled in when reopened", () => {
    let list = touchRecent([], handle("A", "", ""), 0);
    list = touchRecent(list, handle("A", "Alpha"), 5);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "Alpha", openedAt: 5 });
  });

  it("keeps at most 5 recent, newest first", () => {
    const list = openAll(["1", "2", "3", "4", "5", "6", "7"].map((n) => server(`C:/G/${n}`, n)));
    expect(list).toHaveLength(MAX_RECENT);
    expect(splitRecent(list).recent.map((it) => it.title)).toEqual(["7", "6", "5", "4", "3"]);
    const { dropped } = pruneRecent(touchRecent(list, server("C:/G/8", "8"), 99));
    expect(dropped.map((it) => it.title)).toEqual(["3"]);
  });

  it("pinned entries never drop off and do not count toward the 5", () => {
    let list = openAll([server("C:/G/P", "P")]);
    list = setPinned(list, recentKey(server("C:/G/P")), true);
    for (let i = 0; i < 8; i++) list = pruneRecent(touchRecent(list, server(`C:/G/${i}`, String(i)), 10 + i)).kept;
    const { pinned, recent } = splitRecent(list);
    expect(pinned.map((it) => it.title)).toEqual(["P"]);
    expect(recent).toHaveLength(MAX_RECENT);
    expect(list).toHaveLength(MAX_RECENT + 1);
  });

  it("reopening a pinned game keeps it pinned; unpin moves it back to recent", () => {
    let list = openAll([server("C:/G/P", "P"), server("C:/G/Q", "Q")]);
    const key = recentKey(server("C:/G/P"));
    list = setPinned(list, key, true);
    list = touchRecent(list, server("C:/G/P", "P"), 50);
    expect(splitRecent(list).pinned.map((it) => it.key)).toEqual([key]);
    list = setPinned(list, key, false);
    expect(splitRecent(list).pinned).toEqual([]);
    expect(splitRecent(list).recent.map((it) => it.title)).toEqual(["P", "Q"]);
  });

  it("removes an entry", () => {
    const list = openAll([server("C:/G/A", "A"), handle("B", "B")]);
    expect(removeRecent(list, recentKey(server("C:/G/A"))).map((it) => it.title)).toEqual(["B"]);
  });

  it("parses stored JSON defensively", () => {
    const list = openAll([server("C:/G/A", "A"), handle("B", "B")]);
    expect(parseRecent(JSON.stringify(list))).toEqual(list);
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("{bad")).toEqual([]);
    expect(parseRecent(JSON.stringify([{ key: "x", kind: "server" }, { key: "y", kind: "nope" }, 3, null]))).toEqual([]);
  });
});
