import { describe, expect, it } from "vitest";
import { MemoryFolder, type GameFolder } from "@/core/fs/folder";
import type { EventCommand, GameData } from "@/core/types";
import { pictureWantsFile, syncPictureWants } from "./pictureWants";

const c = (code: number, parameters: any[] = []): EventCommand => ({ code, indent: 0, parameters });
const pic = (id: number, name: string) => c(231, [id, name, 0, 0, 0, 0, 100, 100, 255, 0]);

function game(): GameData {
  return {
    engine: "MV", dataRoot: "www/data", imgRoot: "www/img",
    system: { gameTitle: "합성", currencyUnit: "G", switches: [], variables: [] },
    mapInfos: [null], maps: new Map(), troops: [null], actors: [null], items: [null], weapons: [null], armors: [null], errors: [],
    commonEvents: [null, { id: 1, name: "컷인", trigger: 0, switchId: 1, list: [pic(1, "on_disk"), pic(2, "packed_a"), pic(3, "copied"), c(0)] }],
  };
}
const empty = new Uint8Array(0);
const logLine = (r: object) => JSON.stringify({ v: 1, t: 0, run: 1, branch: 1, seq: 1, ...r });

describe("syncPictureWants", () => {
  it("writes the pictures missing from the folder (events + play log), minus copies, only when it changed", async () => {
    const folder = new MemoryFolder({
      "www/img/pictures/on_disk.png": empty,
      "www/rpg-viewer/pictures/copied.png": empty,
      "www/rpg-viewer/log.jsonl": logLine({ type: "screen", scene: "map", pics: [[71, "packed_b", 0, 0, 0, 100, 100, 255, 0, 0, 0, 10, 10]] }) + "\n",
    });
    expect(await syncPictureWants(folder, game())).toBe(true);
    const path = pictureWantsFile("www/data");
    expect(path).toBe("www/rpg-viewer/missing-pictures.json");
    expect(JSON.parse((await folder.readText(path))!)).toEqual({ v: 1, pictures: ["packed_a", "packed_b"] });
    expect(await syncPictureWants(folder, game())).toBe(false); // same list: not written again
    await folder.writeText("www/rpg-viewer/pictures/packed_a.png", "");
    expect(await syncPictureWants(folder, game())).toBe(true);
    expect(JSON.parse((await folder.readText(path))!).pictures).toEqual(["packed_b"]);
  });

  it("does not create the file when nothing is missing, and skips read-only or failing folders", async () => {
    const full = new MemoryFolder({
      "www/img/pictures/on_disk.png": empty, "www/img/pictures/packed_a.png": empty, "www/img/pictures/copied.png": empty,
    });
    expect(await syncPictureWants(full, game())).toBe(false);
    expect(await full.readText(pictureWantsFile("www/data"))).toBeNull();

    const src = new MemoryFolder({ "www/img/pictures/on_disk.png": empty });
    const readOnly: GameFolder = { readText: (p) => src.readText(p), readBinary: (p) => src.readBinary(p), list: (d) => src.list(d) };
    expect(await syncPictureWants(readOnly, game())).toBe(false);

    const denied = Object.assign(new MemoryFolder({ "www/img/pictures/on_disk.png": empty }), { canWrite: async () => false });
    expect(await syncPictureWants(denied, game())).toBe(false);

    const throwing = Object.assign(new MemoryFolder({ "www/img/pictures/on_disk.png": empty }), {
      writeText: async () => { throw new Error("휴대폰 보기에서는 쓸 수 없어요"); },
    });
    expect(await syncPictureWants(throwing, game())).toBe(false);
  });
});
