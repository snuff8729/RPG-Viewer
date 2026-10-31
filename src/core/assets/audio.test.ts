import { describe, expect, it } from "vitest";
import { AUDIO_KEY, encryptedAudio, m4aFixture, oggFixture } from "../../../tests/helpers/audioFixture";
import { MemoryFolder } from "../fs/folder";
import type { GameData } from "../types";
import { AssetStore } from "./assets";
import { audioType, decodeAudio } from "./decrypt";

const data = { engine: "MZ", dataRoot: "data", system: { encryptionKey: AUDIO_KEY } } as GameData;
const buffer = (b: Uint8Array) => b.slice().buffer;

describe("audio content and decryption", () => {
  it("detects plain OGG and M4A by bytes", () => {
    expect(audioType(oggFixture())).toBe("audio/ogg");
    expect(audioType(m4aFixture())).toBe("audio/mp4");
    expect(decodeAudio(buffer(oggFixture()))?.bytes).toEqual(buffer(oggFixture()));
    for (const b of [new Uint8Array(), new Uint8Array([79, 103, 103, 83]), new Uint8Array(32)]) expect(decodeAudio(buffer(b))).toBeNull();
  });
  it.each([oggFixture, m4aFixture])("removes RPGMV header and XORs exactly 16 bytes", fixture => {
    const plain = fixture();
    const encrypted = encryptedAudio(plain);
    expect(decodeAudio(buffer(encrypted), AUDIO_KEY)?.bytes).toEqual(buffer(plain));
    expect(encrypted.slice(32)).toEqual(plain.slice(16));
    expect(encrypted.slice(0, 5)).toEqual(new Uint8Array([82, 80, 71, 77, 86]));
  });
  it("restores keyless OGG serial from the next page and validates its checksum", () => {
    const plain = oggFixture();
    const encrypted = encryptedAudio(plain);
    expect(decodeAudio(buffer(encrypted))?.bytes).toEqual(buffer(plain));
    expect(decodeAudio(buffer(encrypted), "00".repeat(16))?.bytes).toEqual(buffer(plain));
    encrypted[50] ^= 1;
    expect(decodeAudio(buffer(encrypted))).toBeNull();
  });
  it("stays silent for unavailable serial, corrupt/truncated data or keyless M4A", () => {
    expect(decodeAudio(buffer(encryptedAudio(oggFixture().slice(0, 58))))).toBeNull();
    expect(decodeAudio(buffer(encryptedAudio(m4aFixture())))).toBeNull();
    expect(decodeAudio(buffer(encryptedAudio(new Uint8Array(5))), AUDIO_KEY)).toBeNull();
    expect(decodeAudio(buffer(encryptedAudio(m4aFixture())), "bad key")).toBeNull();
  });
});

describe("AssetStore audio", () => {
  it.each([".ogg", ".m4a", ".rpgmvo", ".ogg_", ".m4a_", ".rpgmvm"])("loads %s through the existing folder interface", async ext => {
    const plain = ext === ".m4a" || ext === ".m4a_" || ext === ".rpgmvm" ? m4aFixture() : oggFixture();
    const bytes = ext === ".ogg" || ext === ".m4a" ? plain : encryptedAudio(plain);
    const store = new AssetStore(new MemoryFolder({ [`audio/voice/actor/line${ext}`]: bytes }), data);
    const clip = await store.audio("voice", "actor/line");
    expect(await clip?.arrayBuffer()).toEqual(buffer(plain));
  });
  it("loads MV www/audio and tries another extension after invalid content", async () => {
    const folder = new MemoryFolder({ "www/audio/se/Hi.ogg": new Uint8Array(20), "www/audio/se/Hi.rpgmvo": encryptedAudio(oggFixture()) });
    const clip = await new AssetStore(folder, { ...data, engine: "MV", dataRoot: "www/data" }).audio("se", "Hi");
    expect(clip?.type).toBe("audio/ogg");
  });
  it("coalesces reads, caches only 24 clips, retries failures and rejects traversal", async () => {
    let calls = 0, fail = false;
    const folder = new MemoryFolder({});
    folder.readBinary = async () => { calls++; if (fail) throw new Error("network"); return buffer(oggFixture()); };
    const store = new AssetStore(folder, data);
    const first = store.audio("se", "0");
    expect(store.audio("se", "0")).toBe(first);
    await first;
    for (let i = 1; i <= 24; i++) await store.audio("se", String(i));
    await store.audio("se", "0");
    expect(calls).toBe(26);
    fail = true;
    await store.audio("se", "retry");
    fail = false;
    expect((await store.audio("se", "retry"))?.type).toBe("audio/ogg");
    const count = calls;
    for (const [f, n] of [["../se", "x"], ["se", "../x"], ["/se", "x"], ["se", "C:\\x"]]) expect(await store.audio(f, n)).toBeNull();
    expect(calls).toBe(count);
  });
});
