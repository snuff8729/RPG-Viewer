import { describe, expect, it } from "vitest";
import { computeManageAttention } from "./manageAttention";

describe("computeManageAttention", () => {
  it("nothing to check links to the plain manage page", () => {
    const a = computeManageAttention({ loadErrors: 0, findings: [{ status: "ok" }], install: { state: "installed", version: "1", outdated: false } });
    expect(a).toMatchObject({ count: 0, first: null, href: "#/manage", sections: {} });
  });

  it("splits the total by section and the parts add up", () => {
    const a = computeManageAttention({
      loadErrors: 1,
      findings: [{ status: "ok" }, { status: "needs-addon" }, { status: "unknown" }, { status: "auto-fixed" }],
      install: { state: "installed", version: "0.9", outdated: true },
    });
    expect(a.sections).toEqual({
      connection: { count: 1, variant: "warning" },
      diagnose: { count: 3, variant: "destructive" },
    });
    expect(a.count).toBe(4);
    expect(a.variant).toBe("destructive");
    expect(a.first).toBe("connection");
    expect(a.href).toBe("#/manage/connection");
  });

  it("diagnosis only: warning unless something is unsupported", () => {
    const warn = computeManageAttention({ loadErrors: 0, findings: [{ status: "needs-addon" }], install: null });
    expect(warn).toMatchObject({ count: 1, variant: "warning", first: "diagnose", href: "#/manage/diagnose" });
    const bad = computeManageAttention({ loadErrors: 0, findings: [{ status: "unsupported" }], install: { state: "unsupported", reason: "x" } });
    expect(bad.sections).toEqual({ diagnose: { count: 1, variant: "destructive" } });
  });

  it("missing plugin counts on the connection section", () => {
    const a = computeManageAttention({ loadErrors: 0, findings: null, install: { state: "notInstalled" } });
    expect(a).toMatchObject({ count: 1, variant: "warning", first: "connection" });
  });
});
