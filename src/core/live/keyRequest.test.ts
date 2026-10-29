import { describe, expect, it } from "vitest";
import { claimKeyRequest, keyRequestFresh, parseKeyRequest } from "./keyRequest";

describe("parseKeyRequest", () => {
  it("reads { v: 1, id, kind, at } for backup / restore", () => {
    expect(parseKeyRequest(JSON.stringify({ v: 1, id: "k-1", kind: "backup", at: 5 }))).toEqual({ id: "k-1", kind: "backup", at: 5 });
    expect(parseKeyRequest("﻿" + JSON.stringify({ v: 1, id: "k-2", kind: "restore", at: 6 }))?.kind).toBe("restore");
  });
  it("rejects anything else without throwing", () => {
    for (const t of [null, undefined, "", "{bad", "[]", JSON.stringify({ v: 2, id: "k", kind: "backup", at: 1 }),
      JSON.stringify({ v: 1, id: "", kind: "backup", at: 1 }), JSON.stringify({ v: 1, id: "k", kind: "delete", at: 1 }),
      JSON.stringify({ v: 1, id: "k", kind: "backup", at: "1" })]) {
      expect(parseKeyRequest(t)).toBeNull();
    }
  });
});

describe("keyRequestFresh / claimKeyRequest", () => {
  it("only requests from the last 10 s", () => {
    const r = { id: "k", kind: "backup" as const, at: 100_000 };
    expect(keyRequestFresh(r, 105_000)).toBe(true);
    expect(keyRequestFresh(r, 110_001)).toBe(false);
    expect(keyRequestFresh(r, 89_999)).toBe(false);
  });
  it("each id once, across windows sharing localStorage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    const winA = new Set<string>(), winB = new Set<string>();
    expect(claimKeyRequest("k-1", winA, storage)).toBe(true);
    expect(claimKeyRequest("k-1", winA, storage)).toBe(false);
    expect(claimKeyRequest("k-1", winB, storage)).toBe(false);
    expect(claimKeyRequest("k-2", winB, storage)).toBe(true);
    // localStorage 없이도 창 안에서는 한 번
    expect(claimKeyRequest("k-3", winA, null)).toBe(true);
    expect(claimKeyRequest("k-3", winA, null)).toBe(false);
    // 깨진 localStorage는 창 기억만
    const broken = { getItem: () => "{", setItem: () => {} };
    expect(claimKeyRequest("k-4", winA, broken)).toBe(true);
  });
});
