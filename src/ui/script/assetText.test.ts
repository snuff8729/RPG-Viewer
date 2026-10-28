import { describe, expect, it } from "vitest";
import { missingAssetText } from "./assetText";

describe("missingAssetText", () => {
  it("names the picture, its number and kind", () => {
    expect(missingAssetText("pictures", "village_map", 3)).toBe("게임 폴더에 없는 그림 #3: village_map (pictures)");
    expect(missingAssetText("pictures", "village_map")).toBe("게임 폴더에 없는 그림: village_map (pictures)");
  });
  it("uses the face wording for faces", () => expect(missingAssetText("faces", "Actor1")).toBe("얼굴 그림 없음: Actor1"));
});
