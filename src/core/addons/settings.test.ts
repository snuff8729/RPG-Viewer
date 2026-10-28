import { describe, expect, it } from "vitest";
import { controlJson, DEFAULT_ASSIST } from "../live/assist";
import { addonControlFlags, ADDONS } from "./registry";
import { addonsJson, parseAddons } from "./settings";

describe("add-on registry", () => {
  it("lists the screen picture add-on, off unless enabled", () => {
    expect(ADDONS.map(a => a.id)).toContain("screenPictures");
    expect(addonControlFlags({})).toEqual({});
    expect(addonControlFlags(null)).toEqual({});
    expect(addonControlFlags({ screenPictures: false })).toEqual({});
    expect(addonControlFlags({ screenPictures: true })).toEqual({ capturePictures: true });
  });
  it("control.json carries the flags but they cannot override the contract fields", () => {
    const c = JSON.parse(controlJson(DEFAULT_ASSIST, { seenMessages: [], seenPages: [] }, null, 5, { capturePictures: true, v: 9, t: 1 }));
    expect(c).toMatchObject({ v: 1, t: 5, capturePictures: true });
    expect(JSON.parse(controlJson(DEFAULT_ASSIST, { seenMessages: [], seenPages: [] }, null, 5))).not.toHaveProperty("capturePictures");
  });
});

describe("addons.json", () => {
  it("round-trips and ignores unknown or bad values", () => {
    expect(parseAddons(addonsJson({ screenPictures: true }))).toEqual({ screenPictures: true });
    expect(JSON.parse(addonsJson({}))).toEqual({ v: 1, enabled: { screenPictures: false } });
    expect(parseAddons("﻿" + JSON.stringify({ v: 1, enabled: { screenPictures: true, other: true } }))).toEqual({ screenPictures: true });
    expect(parseAddons(JSON.stringify({ v: 1, enabled: { screenPictures: "yes" } }))).toEqual({});
    expect(parseAddons("{bad")).toBeNull();
    expect(parseAddons(null)).toBeNull();
    expect(parseAddons("[]")).toBeNull();
  });
});
