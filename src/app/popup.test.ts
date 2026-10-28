import { describe, expect, it } from "vitest";
import { playPopupUrl, popupGameKey } from "./popup";

describe("popup", () => {
  it("round-trips the game key through the url", () => {
    const url = playPopupUrl("/", "server:c:/games/a b|x");
    expect(url.endsWith("#/play")).toBe(true);
    const search = url.slice(url.indexOf("?"), url.indexOf("#"));
    expect(popupGameKey(search)).toBe("server:c:/games/a b|x");
  });
  it("is a popup without a key, and not a popup without the param", () => {
    expect(popupGameKey("?popup=")).toBe("");
    expect(popupGameKey(new URL(`http://x${playPopupUrl("/app/", undefined)}`).search)).toBe("");
    expect(popupGameKey("")).toBeNull();
    expect(popupGameKey("?foo=1")).toBeNull();
  });
});
