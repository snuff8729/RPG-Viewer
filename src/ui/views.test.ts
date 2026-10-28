import { describe, expect, it } from "vitest";
import { parseRoute } from "@/app/route";
import { VIEW_NAMES, viewOf } from "./views";

describe("viewOf", () => {
  it("maps routes to sidebar views", () => {
    expect(viewOf(parseRoute("#/"))).toBe("explore");
    expect(viewOf(parseRoute("#/map/1/event/2/page/1"))).toBe("explore");
    expect(viewOf(parseRoute("#/common/3"))).toBe("explore");
    expect(viewOf(parseRoute("#/play"))).toBe("play");
    expect(viewOf(parseRoute("#/read"))).toBe("read");
    expect(viewOf(parseRoute("#/here"))).toBe("here");
    expect(viewOf(parseRoute("#/history"))).toBe("history");
    expect(viewOf(parseRoute("#/missing"))).toBe("missing");
    expect(VIEW_NAMES[viewOf(parseRoute("#/"))]).toBe("찾아보기");
  });
});
