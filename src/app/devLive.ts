// DEV 전용: 게임 없이 브라우저 콘솔에서 기록·상태를 흘려 넣는 시뮬레이터.
// LiveProvider가 import.meta.env.DEV일 때만 동적 import 한다.
import type { WritableGameFolder } from "@/core/fs/folder";
import { formatPluginsJs, install, livePaths } from "@/core/live/installer";
import { parseLogText } from "@/core/live/log";
import type { LiveSnapshot, LogRecord } from "@/core/live/types";

export interface LiveDevContext {
  folder: WritableGameFolder;
  dataRoot: string;
  pluginSource: string;
  refreshInstall(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

async function appendText(folder: WritableGameFolder, path: string, text: string): Promise<void> {
  const f = folder as WritableGameFolder & { appendText?: (p: string, t: string) => void };
  if (typeof f.appendText === "function") { f.appendText(path, text); return; }
  await folder.writeText(path, ((await folder.readText(path)) ?? "") + text);
}

async function readRecords(folder: WritableGameFolder, path: string): Promise<LogRecord[]> {
  const text = await folder.readText(path);
  return text ? parseLogText(text).records : [];
}

/** 플러그인이 설치된 것처럼 plugins.js·플러그인 파일을 쓴다(픽스처에는 plugins.js가 없다). */
async function ensureInstalled(ctx: LiveDevContext): Promise<void> {
  const p = livePaths(ctx.dataRoot);
  if ((await ctx.folder.readText(p.pluginsJs)) === null) await ctx.folder.writeText(p.pluginsJs, formatPluginsJs([]));
  await install(ctx.folder, ctx.dataRoot, ctx.pluginSource);
  await ctx.refreshInstall();
}

export function registerLiveDevTools(ctx: LiveDevContext): () => void {
  const p = livePaths(ctx.dataRoot);

  /** 픽스처 기록·상태를 현재 폴더의 rpg-viewer/에 쓴다. t는 현재 시각 근처로 바꾼다(간격 유지). */
  const simulateFixtureLog = async (): Promise<void> => {
    const [logRes, liveRes] = await Promise.all([
      fetch("/tests/fixtures/logs/sample-mz.log.jsonl"),
      fetch("/tests/fixtures/logs/sample-mz.live.json"),
    ]);
    if (!logRes.ok || !liveRes.ok) throw new Error("fixture log fetch failed");
    const { records } = parseLogText(await logRes.text());
    const live = (await liveRes.json()) as LiveSnapshot;
    const maxT = Math.max(live.t, ...records.map((r) => r.t));
    const shift = Date.now() - maxT;
    const shifted = records.map((r) => ({ ...r, t: r.t + shift }));
    await ensureInstalled(ctx);
    // 기존 기록이 있으면 먼저 비워 LogTail이 reset을 보게 한 뒤 다시 쓴다.
    const st = await ctx.folder.stat(p.logFile);
    if (st && st.size > 0) {
      await ctx.folder.writeText(p.logFile, "");
      await sleep(1200);
    }
    await ctx.folder.writeText(p.logFile, shifted.map((r) => JSON.stringify(r)).join("\n") + "\n");
    await ctx.folder.writeText(p.liveFile, JSON.stringify({ ...live, t: live.t + shift }));
  };

  /** 기록 한 줄을 덧붙인다. v·seq·t·run·branch는 비어 있으면 채운다. */
  const appendLog = async (record: Partial<LogRecord> & { type: LogRecord["type"] }): Promise<LogRecord> => {
    const existing = await readRecords(ctx.folder, p.logFile);
    const last = existing.length > 0 ? existing[existing.length - 1] : null;
    const full = {
      v: 1,
      seq: (last?.seq ?? 0) + 1,
      run: last?.run ?? 1,
      branch: last?.branch ?? 1,
      ...record,
      t: record.t ?? Date.now(),
    } as LogRecord;
    await appendText(ctx.folder, p.logFile, JSON.stringify(full) + "\n");
    return full;
  };

  /** live.json을 현재 값과 합쳐 쓴다(t는 지금). 인자 없이 부르면 하트비트. */
  const setLive = async (partial: Partial<LiveSnapshot> = {}): Promise<LiveSnapshot> => {
    let base: Partial<LiveSnapshot> = {};
    try { base = JSON.parse((await ctx.folder.readText(p.liveFile)) ?? "{}") as Partial<LiveSnapshot>; } catch { base = {}; }
    const next = {
      v: 1, pluginVersion: "", run: null, branch: null, seq: 0, mapId: 1, x: 0, y: 0, running: null,
      events: [], switches: [], variables: {}, selfSwitches: [], items: {}, weapons: {}, armors: {},
      gold: 0, party: [], choice: null, inBattle: false,
      ...base, ...partial, t: Date.now(),
    } as LiveSnapshot;
    await ctx.folder.writeText(p.liveFile, JSON.stringify(next));
    return next;
  };

  const tools = { simulateFixtureLog, appendLog, setLive };
  const w = window as unknown as { __rpgViewer?: Record<string, unknown> };
  w.__rpgViewer = { ...(w.__rpgViewer ?? {}), ...tools };
  return () => {
    const cur = w.__rpgViewer;
    if (!cur) return;
    for (const k of Object.keys(tools)) delete cur[k];
  };
}
