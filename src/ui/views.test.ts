import { describe, expect, it } from "vitest";
import { parseRoute } from "@/app/route";
import { VIEW_NAMES, viewOf } from "./views";
describe("viewOf", () => {
  it.each([
    ["#/", "play"], ["#/here", "play"], ["#/read", "read"], ["#/history", "read"], ["#/read/history", "read"], ["#/play/read", "play"],
    ["#/browse/events", "browse"], ["#/missing", "browse"], ["#/common/3", "browse"],
    ["#/map/1/event/2/page/1", "browse"], ["#/troop/1/page/1", "browse"],
    ["#/diagnose", "manage"], ["#/manage/appearance", "manage"], ["#/more", "more"],
  ])("maps %s to %s", (hash, view) => expect(viewOf(parseRoute(hash))).toBe(view));
  it("uses the shared primary names", () => {
    expect(VIEW_NAMES.play).toBe("플레이"); expect(VIEW_NAMES.read).toBe("읽기"); expect(VIEW_NAMES.browse).toBe("찾아보기"); expect(VIEW_NAMES.manage).toBe("관리");
  });
});
