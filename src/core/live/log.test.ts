import { describe, expect, it } from "vitest";
import { fixtureLogText } from "../../../tests/helpers/fixtureLog";
import { parseLogText } from "./log";

describe("parseLogText", () => {
  it("parses fixture with one bad line", () => {
    const r = parseLogText(fixtureLogText());
    expect(r.records).toHaveLength(35); expect(r.badLines).toBe(1);
  });
  it("accepts LF and CRLF, ignores blank lines", () => {
    const a = '{"v":1,"seq":1,"t":0,"run":1,"branch":1,"type":"save","slot":1}';
    const b = '{"v":1,"seq":2,"t":0,"run":1,"branch":1,"type":"load","slot":1}';
    expect(parseLogText(`${a}\n\n${b}\n`)).toMatchObject({ records: [{ seq: 1 }, { seq: 2 }], badLines: 0 });
    expect(parseLogText(`${a}\r\n\r\n${b}\r\n`)).toMatchObject({ records: [{ seq: 1 }, { seq: 2 }], badLines: 0 });
    expect(parseLogText("")).toEqual({ records: [], badLines: 0 });
  });
  it("counts wrong version, missing type, non-objects as bad", () => {
    const text = [
      '{"v":2,"seq":1,"type":"save"}',
      '{"v":1,"seq":2}',
      "null", "42", '"x"', "[1]",
      "{oops",
    ].join("\n");
    expect(parseLogText(text)).toEqual({ records: [], badLines: 7 });
  });
});
