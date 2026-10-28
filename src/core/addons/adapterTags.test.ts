import { describe, it, expect } from "vitest";
import { nextShot, parsePic, parsePics, roleOf, sceneOf, standGroupLabel, standGroups, type ScreenPicture } from "./screenPictures";
import { addonsJson, parseAddonFile } from "./settings";

const SCREEN = { width: 816, height: 624 };
const tagged = (name: string, x: number, actorId: number, actorName: string, layer: string, op = 255) =>
  [1000, name, 0, x, 0, 100, 100, op, 0, 0, 0, 300, 600, "sprite", { adapter: "character-picture-manager", role: "stand", actorId, actorName, layer }];

describe("extension tags on pictures (bridge 1.13.0)", () => {
  it("parses the tag at index 14 and ignores junk", () => {
    expect(parsePic(tagged("Reiri_Eyes1", 50, 1, "레이리", "目"))?.tag).toEqual({
      adapter: "character-picture-manager", role: "stand", actorId: 1, actorName: "레이리", layer: "目",
    });
    const junk = [1, "a", 0, 0, 0, 100, 100, 255, 0, 0, 0, 10, 10, 0, { actorId: -1, role: "boss", layer: 5 }];
    expect(parsePic(junk)).not.toHaveProperty("tag");
    expect(parsePic([1, "a", 0, 0, 0, 100, 100, 255, 0, 0, 0, 10, 10, 0, "x"])).not.toHaveProperty("tag");
  });

  it("tag role applies after user roles and adapter defaults, before automatic HUD / small checks", () => {
    const tiny = { ...parsePic(tagged("eye", 0, 1, "A", "目"))!, w: 5, h: 5 };
    expect(roleOf(tiny, { screen: SCREEN })).toBe("stand");
    expect(roleOf({ ...tiny, tag: undefined }, { screen: SCREEN })).toBe("hud");
    expect(roleOf(tiny, { screen: SCREEN, spriteRoles: { eye: "hidden" } })).toBe("hidden");
    expect(roleOf(tiny, { screen: SCREEN, defaultRole: () => "cg" })).toBe("cg");
    expect(roleOf(tiny, { screen: SCREEN, defaultRole: () => { throw new Error("x"); } })).toBe("stand");
  });

  it("groups stands by actor (first appearance, drawing order kept); untagged together", () => {
    const pics = [parsePic(tagged("Reiri_Base", 50, 1, "레이리", "ベース"))!, parsePic(tagged("Mer_Base", 460, 3, "메르메이아", "ベース"))!];
    const extra: ScreenPicture[] = [
      parsePic(tagged("Reiri_Eyes", 50, 1, "레이리", "目"))!,
      parsePic([5, "plain", 0, 0, 0, 100, 100, 255, 0])!,
    ];
    const groups = standGroups([pics[0], pics[1], ...extra]);
    expect(groups.map(g => [g.key, g.actorName, g.pictures.map(p => p.name)])).toEqual([
      ["a1", "레이리", ["Reiri_Base", "Reiri_Eyes"]],
      ["a3", "메르메이아", ["Mer_Base"]],
      ["", undefined, ["plain"]],
    ]);
    expect(groups.map(standGroupLabel)).toEqual(["레이리 스탠딩", "메르메이아 스탠딩", "스탠딩"]);
    expect(standGroupLabel({ key: "a9", actorId: 9, pictures: [] })).toBe("배우 9 스탠딩");
    expect(standGroups(null)).toEqual([]);
    expect(standGroups([extra[1]]).map(g => g.key)).toEqual([""]);
  });

  it("a scene of tagged stands becomes a stand shot with every actor's layers", () => {
    const pics = parsePics([tagged("Reiri_Base", 50, 1, "레이리", "ベース"), tagged("Mer_Base", 460, 3, "메르메이아", "ベース")])!;
    // parsePics keeps one entry per id: give them distinct ids like the bridge does
    expect(pics).toHaveLength(1);
    const two = [parsePic(tagged("Reiri_Base", 50, 1, "레이리", "ベース"))!, { ...parsePic(tagged("Mer_Base", 460, 3, "메르메이아", "ベース"))!, id: 1001 }];
    const { shot } = nextShot(null, sceneOf(two, { screen: SCREEN }));
    expect(shot?.kind).toBe("stand");
    expect(standGroups(shot!.pictures).map(g => g.actorId)).toEqual([1, 3]);
  });
});

describe("addons.json adapters", () => {
  it("round-trips adapter switches and drops bad ids", () => {
    const body = addonsJson({ screenPictures: true }, null, null, null, { "character-picture-manager": true, "ddaggeo-mode": false, "Bad Id": true });
    expect(JSON.parse(body).adapters).toEqual({ "character-picture-manager": true, "ddaggeo-mode": false });
    expect(parseAddonFile(body)?.adapters).toEqual({ "character-picture-manager": true, "ddaggeo-mode": false });
    expect(JSON.parse(addonsJson({}))).not.toHaveProperty("adapters");
    expect(parseAddonFile(addonsJson({}))).not.toHaveProperty("adapters");
  });
});
