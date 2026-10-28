import { parsePluginsJs } from "../live/installer";
import type { LoadError, MapData, MapEvent } from "../types";

const NOTE_RE = /<(?:TE|TemplateEvent)\s*:\s*([^>]*?)\s*>/;

/** plugins.js 텍스트에서 켜진 TemplateEvent의 TemplateMapId. 없거나 이상하면 null. 예외를 던지지 않는다. */
export function templateMapIdFromPlugins(text: string | null | undefined): number | null {
  try {
    if (typeof text !== "string") return null;
    const entries = parsePluginsJs(text);
    if (!entries) return null;
    const te = entries.find((e) => !!e && typeof e === "object" && e.name === "TemplateEvent" && e.status === true);
    const raw = te && te.parameters && typeof te.parameters === "object" ? te.parameters.TemplateMapId : undefined;
    const s = String(raw ?? "").trim();
    if (!/^\d+$/.test(s)) return null;
    const id = Number(s);
    return id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** 이벤트 메모의 `<TE:값>` / `<TemplateEvent:값>` 값(trim). 없으면 null. */
export function parseTemplateNote(note: unknown): string | null {
  if (typeof note !== "string") return null;
  const v = NOTE_RE.exec(note)?.[1]?.trim();
  return v ? v : null;
}

/**
 * `maps`의 템플릿 이벤트(메모 `<TE:값>`)를 템플릿 맵 이벤트의 페이지로 바꾼다. 템플릿 맵 자체는 건드리지 않는다.
 * 원본 이벤트의 id·이름·좌표·메모는 유지하고, 페이지 배열은 템플릿 것을 그대로 참조한다(복사하지 않음).
 * 원래 페이지는 originalPages에 남긴다.
 * 못 찾은 템플릿마다 오류 하나를 돌려준다. 예외를 던지지 않는다.
 */
export function expandTemplateEvents(
  maps: Map<number, MapData>, templateMap: MapData, templateMapId: number, mapFile: (id: number) => string,
): LoadError[] {
  const errors: LoadError[] = [];
  const byId = new Map<number, MapEvent>();
  const byName = new Map<string, MapEvent>();
  for (const ev of Array.isArray(templateMap?.events) ? templateMap.events : []) {
    if (!ev || typeof ev !== "object" || !Array.isArray(ev.pages)) continue;
    if (typeof ev.id === "number" && !byId.has(ev.id)) byId.set(ev.id, ev);
    if (typeof ev.name === "string" && !byName.has(ev.name)) byName.set(ev.name, ev);
  }
  for (const [mapId, map] of maps) {
    if (mapId === templateMapId || !Array.isArray(map?.events)) continue;
    map.events.forEach((ev, i) => {
      try {
        if (!ev || typeof ev !== "object") return;
        const key = parseTemplateNote(ev.note);
        if (key === null) return;
        const tpl = /^\d+$/.test(key) ? byId.get(Number(key)) : byName.get(key);
        if (!tpl) {
          errors.push({ file: mapFile(mapId), message: `템플릿 이벤트를 찾을 수 없어요: ${key}`, mapId });
          return;
        }
        // 원래 페이지는 `TE固有イベント呼び出し`가 실행하므로 따로 남긴다.
        map.events[i] = { ...ev, pages: tpl.pages, originalPages: Array.isArray(ev.pages) ? ev.pages : [] };
      } catch {
        /* 이상한 이벤트는 그대로 둔다 */
      }
    });
  }
  return errors;
}
