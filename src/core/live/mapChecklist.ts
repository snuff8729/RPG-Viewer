import { describePageConditions } from "../conditions/describe";
import { testToReq, type Req } from "../deps/graph";
import { locationKey } from "../index/locations";
import { walk, walkAt } from "../interpret/interpret";
import { flattenCalls, type CallCtx } from "../interpret/teCall";
import { canReachEvent, reachableTiles } from "../map/reach";
import type { MapTiles, TilesetInfo } from "../map/tiles";
import { formatText } from "../text/escape";
import { armorName, itemName, variableName, weaponName } from "../text/names";
import type { EventCommand, GameData, GameIndex, Location, MapEvent, PageEntry } from "../types";
import { describeEnemy, enemyOf, type EnemyInfo } from "./enemies";
import { evaluate } from "./evaluate";
import { seenKey } from "./coverage";
import { activePageIndex, pageEntries, pageNewCounts } from "./interactable";
import { calledBy, entryPoints, findTransfer, type TransferTarget } from "./mapScan";
import { classifyPluginRecord, pluginRecOfCommand, type PluginOverrides } from "./pluginText";
import { remainingLines, type RemainingLine } from "./remainingLines";
import { repeatInfo, type RepeatInfo } from "./repeat";
import type { Coverage, LiveSnapshot } from "./types";
import { UNKNOWN_SPAWN_TITLE, withSpawnedEvents } from "./spawned";

/**
 * 지금 할 수 있는 것으로 나눈다(잠긴 페이지가 있어도 지금 할 수 있으면 그쪽 구역).
 * now: 지금 상호작용 + 지금 볼 수 있는 안 본 대사·선택지(또는 아직 안 해 본 플러그인 조사 지점) / item: 지금 상호작용 + 얻는 것 / repeat: 반복하면 달라짐 /
 * talk: 그 밖에 지금 조사·대화 가능(다 봄, 다시 가능) / exit: 다른 곳으로 이동하는 이벤트(어느 페이지든 장소 이동) /
 * enemy: 지금 페이지가 전투를 거는 적(안 본 대사가 있어도 이 구역) /
 * locked: 지금은 못 하고 새 내용이 잠김 / done: 나머지
 */
export type Section = "now" | "item" | "repeat" | "exit" | "enemy" | "talk" | "locked" | "done";
/** 다른 맵으로 옮겨 주는 이벤트. mapName: 어디로(변수로 정하면 "다른 곳"), now: 지금 페이지가 옮겨 준다 */
export interface ExitInfo { mapId: number | null; mapName: string; now: boolean }
export interface LockedPage {
  page: number; location: Location; unseen: number; unpicked: number;
  /** 트리거 설명을 뺀 출현 조건. req는 의존 그래프 원자로 바꿀 수 있을 때만 */
  conditions: { text: string; met: boolean; req?: Req }[];
  /** 조건은 다 됐지만 더 뒤(번호가 큰) 활성 페이지가 먼저 나와 지금은 안 나온다 */
  shadowed?: true;
}
export interface ChecklistEvent {
  eventId: number; name: string; title: string; x: number; y: number;
  section: Section;
  /** 지금 활성 페이지(0부터), 없으면 -1 */
  activePage: number;
  location: Location | null;
  /** 활성 페이지가 자동 실행·병렬 처리 */
  auto: boolean;
  /**
   * 활성 페이지의 안 본 대사 중 지금 볼 수 있는 것(선택지 갈래 안 포함, 지금 틀린 조건 뒤는 뺌)·안 고른 선택지.
   * 활성 페이지가 없으면 0
   */
  unseen: number; unpicked: number;
  /** 지금 볼 수 있는 남은 대사(최대 3개, 가는 길과 함께). 전체 수는 unseen */
  remainingLines: RemainingLine[];
  /** 조건이 맞으면 볼 수 있는 대사(최대 3개)와 전체 수(later) */
  laterLines: RemainingLine[]; later: number;
  repeat: RepeatInfo[];
  locked: LockedPage[];
  /** 지금 상호작용 가능: 활성 페이지가 결정 키·접촉 트리거(0/1/2)이고 명령이 있다 */
  interactable: boolean;
  /** 활성 페이지에서 얻는 것(`아이템 [x] ×n`, `골드 +n`). 지금 상호작용 가능할 때만 */
  gains: string[];
  /** 활성 페이지의 첫 플러그인 명령 글(최대 60자). 지금 상호작용 가능할 때만 */
  pluginHint?: string;
  /**
   * 아직 안 해 봄: 지금 상호작용 가능한 활성 페이지에 플러그인 명령(조사 지점 등)이 있고 셀 대사·선택지·얻을 것이 없는데,
   * 그 페이지가 기록에 한 번도 나오지 않았다(coverage.touched). now 구역에 들어가고, 해 보면 talk로 돌아간다.
   */
  untried?: true;
  /**
   * 이야기·자동 진행: locked 중 자동 실행·병렬 페이지이거나 그래픽이 없는 이벤트, 또는 background 이벤트.
   * 맵에 번호를 그리지 않고 남은 수에 안 센다
   */
  story: boolean;
  /** 다른 곳으로 옮겨 주는 이벤트(section "exit") */
  exit?: ExitInfo;
  /** 전투를 거는 이벤트(어느 페이지든). now면 section "enemy" */
  enemy?: EnemyInfo;
  /**
   * 직접 실행할 수 없는 이벤트: unreachable = 실행할 칸에 걸어서 못 감(맵 타일이 있을 때만 판단),
   * called = 그림이 없고 다른 이벤트가 부름. story가 된다
   */
  background?: "unreachable" | "called";
  /** 이 이벤트를 부르는 이벤트·공통 이벤트 이름(아는 경우) */
  calledBy?: string;
  /** 이게 뭔지 한 줄: 종류 · 시작 방법 · 미리보기 */
  describe: string;
  /** 자율 이동이 무작위·다가옴이라 돌아다님 */
  moves: boolean;
  /**
   * 맵 번호(1부터): 맵 데이터만으로 정해져(트리거 0~2이고 명령이 있는 페이지가 있는 이벤트를 id 순으로, 타일·지금 상태와 무관)
   * 확인해도 바뀌지 않는다. 이야기·자동 진행이면 없음
   */
  number?: number;
}
/** 걸어서 갈 수 있는지 볼 때 쓰는 맵 타일(없으면 그 판단을 건너뛴다) */
export interface MapPassage { map: MapTiles; tileset: TilesetInfo }
export interface MapChecklist {
  mapId: number; mapName: string; width: number; height: number;
  player: { x: number; y: number };
  /** 구역 순서(now → item → repeat → exit → enemy → talk → locked → 이야기·자동 진행 → done), 같은 구역 안에서는 이벤트 id 순 */
  events: ChecklistEvent[];
  /** now(아직 안 해 봄 포함) + item + repeat + locked + 안 본 대사·선택지가 있는 exit·enemy (이야기·자동 진행 제외) 이벤트 수 */
  remaining: number;
}

const SECTION_ORDER: Record<Section, number> = { now: 0, item: 1, repeat: 2, exit: 3, enemy: 4, talk: 5, locked: 6, done: 8 };
const rank = (e: ChecklistEvent): number => (e.story ? 7 : SECTION_ORDER[e.section]);
const HINT_MAX = 60;
const PREVIEW_MAX = 40;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object";
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** 볼거리가 있는 페이지: 대사·선택지 또는 그림·장소 이동 */
function hasContent(entry: PageEntry): boolean {
  if (entry.hasDialogue) return true;
  let found = false;
  try { walk(arr(entry.nodes), [], n => { if (n.kind === "picture" || n.kind === "transfer") found = true; }); } catch { /* 없음 */ }
  return found;
}

const realCommands = (list: unknown): EventCommand[] =>
  arr<EventCommand | null>(list).filter((c): c is EventCommand => isObj(c) && typeof c.code === "number" && c.code !== 0);

const hasGraphic = (pg: unknown): boolean =>
  isObj(pg) && isObj(pg.image) && (num(pg.image.tileId) > 0 || (typeof pg.image.characterName === "string" && pg.image.characterName !== ""));

function amountText(data: GameData, type: unknown, operand: unknown): string {
  return num(type) === 1 ? `(변수 [${variableName(data, num(operand))}])` : String(num(operand));
}

/** 페이지 명령 중 얻는 것: 아이템·무기·방어구 증가(126/127/128), 골드 증가(125). */
function gainsOf(list: EventCommand[], data: GameData): string[] {
  const out: string[] = [];
  for (const cmd of list) {
    const p = arr<unknown>(cmd.parameters);
    if (cmd.code === 125 && num(p[0]) === 0) out.push(`골드 +${amountText(data, p[1], p[2])}`);
    else if ((cmd.code === 126 || cmd.code === 127 || cmd.code === 128) && num(p[1]) === 0) {
      const id = num(p[0]);
      const [kind, name] = cmd.code === 126 ? ["아이템", itemName(data, id)]
        : cmd.code === 127 ? ["무기", weaponName(data, id)]
        : ["방어구", armorName(data, id)];
      out.push(`${kind} [${name}] ×${amountText(data, p[2], p[3])}`);
    }
  }
  return out;
}

const isPluginCommand = (c: EventCommand): boolean => c.code === 356 || c.code === 357;

/** 글로 보이는(pluginText: 내용 + 명령별 설정) 첫 플러그인 명령의 글. 기술 명령(변수·효과음 등)은 건너뛴다. */
function pluginHintOf(list: EventCommand[], overrides: PluginOverrides | null): string | undefined {
  for (const cmd of list) {
    const rec = pluginRecOfCommand(cmd);
    if (!rec) continue;
    const c = classifyPluginRecord(rec, overrides);
    const text = c.kind === "text" ? c.text.trim() : "";
    if (text) return text.length > HINT_MAX ? `${text.slice(0, HINT_MAX)}…` : text;
  }
  return undefined;
}

const clip = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max)}…` : t);

/** 페이지의 첫 안 본 대사 줄, 없으면 첫 대사 줄(제어 문자 뺌). 없으면 undefined */
function previewLine(entry: PageEntry | null, coverage: Coverage, data: GameData): string | undefined {
  if (!entry) return undefined;
  let first: string | undefined, unseen: string | undefined;
  try {
    walkAt(arr(entry.nodes), entry.location, [], (n, _path, loc) => {
      if (unseen !== undefined || (n.kind !== "message" && n.kind !== "scroll")) return;
      const line = arr<unknown>(n.lines).map(l => (typeof l === "string" ? formatText(l, data).trim() : "")).find(Boolean);
      if (!line) return;
      if (first === undefined) first = line;
      if (coverage.seen instanceof Set && !coverage.seen.has(seenKey(loc, n.cmd))) unseen = line;
    });
  } catch { /* 지금까지 */ }
  const t = unseen ?? first;
  return t ? clip(t, PREVIEW_MAX) : undefined;
}

function imageKind(pg: unknown): "npc" | "object" | "none" {
  if (!isObj(pg) || !isObj(pg.image)) return "none";
  if (num(pg.image.tileId) > 0) return "object";
  const name = typeof pg.image.characterName === "string" ? pg.image.characterName : "";
  if (!name) return "none";
  return (/^[!$]+/.exec(name)?.[0] ?? "").includes("!") ? "object" : "npc";
}

/** 걸어서 실행하는 페이지(결정 키·접촉 트리거이고 명령이 있음) */
const directPage = (pg: unknown): boolean => isObj(pg) && num(pg.trigger) <= 2 && realCommands(pg.list).length > 0;

/** 페이지(TemplateEvent로 부른 목록 포함, 공통 이벤트 제외)에 대사 표시(101)·선택지(102)가 있는가 */
function talks(list: unknown, ctx: CallCtx): boolean {
  return flattenCalls(list, ctx).some(c => isObj(c) && (c.code === 101 || c.code === 102));
}

/**
 * 출구 페이지(걸어서 실행하고 대사·선택지가 없음) 중 장소 이동을 하는 것이 있으면 그 대상(지금 페이지 것이 먼저).
 * 대사·선택지가 있는 페이지는 이동하더라도 이야기할 거리라 출구로 보지 않는다(describe에 이동할 수 있다고만 쓴다).
 */
function exitOf(ev: MapEvent, mapId: number, data: GameData, activePage: number): { target: TransferTarget; now: boolean } | null {
  const pages = arr<MapEvent["pages"][number] | null>(ev.pages);
  let first: TransferTarget | null = null;
  for (let pi = 0; pi < pages.length; pi++) {
    const pg = pages[pi];
    if (!isObj(pg) || num(pg.trigger) > 2) continue;
    const ctx: CallCtx = { data, mapId, event: ev, page: pi };
    if (talks(pg.list, ctx)) continue;
    const t = findTransfer(pg.list, ctx, data);
    if (!t) continue;
    if (pi === activePage) return { target: t, now: true };
    first ??= t;
  }
  return first ? { target: first, now: false } : null;
}

interface Background { kind: "unreachable" | "called"; calledBy: string | null }

/**
 * 직접 실행할 수 없는 이벤트인가(데이터와 맵 타일만 본다 — 지금 페이지와 무관해 번호가 안 바뀐다).
 * 출구이거나 걸어서 실행하는 페이지가 없는 이벤트는 아니다.
 */
function backgroundOf(ev: MapEvent, mapId: number, data: GameData, reach: { passage: MapPassage; tiles: Set<string> } | null): Background | null {
  const pages = arr<MapEvent["pages"][number] | null>(ev.pages);
  const direct = pages.filter(directPage) as MapEvent["pages"];
  if (direct.length === 0 || exitOf(ev, mapId, data, -1)) return null;
  const unreachable = !!reach && !direct.some(pg => canReachEvent(
    { x: num(ev.x), y: num(ev.y), priorityType: num(pg.priorityType ?? 1), trigger: num(pg.trigger), through: pg.through === true },
    reach.passage.map, reach.passage.tileset, reach.tiles,
  ));
  const invisible = !pages.some(hasGraphic);
  if (!unreachable && !invisible) return null;
  const caller = calledBy(data, mapId, ev);
  if (unreachable) return { kind: "unreachable", calledBy: caller };
  return caller ? { kind: "called", calledBy: caller } : null;
}

function mapNameOf(data: GameData, mapId: number | null): string {
  if (mapId === null) return "다른 곳";
  const info = arr<{ name?: string } | null>(data.mapInfos)[mapId];
  return (isObj(info) && info.name) || `맵 ${mapId}`;
}

function lockedPage(
  ev: MapEvent, pi: number, mapId: number, entry: PageEntry, data: GameData, coverage: Coverage, live: LiveSnapshot, activePage: number,
): LockedPage | null {
  const { unseen, unpicked } = pageNewCounts(entry, coverage);
  if (unseen === 0 && unpicked === 0) return null;
  const pg = ev.pages[pi];
  const self = { mapId, eventId: ev.id };
  const conds = isObj(pg?.conditions) ? describePageConditions(pg.conditions, num(pg.trigger), data) : [];
  const conditions: LockedPage["conditions"] = [];
  for (const cd of conds) {
    if (!cd || cd.test?.kind === "trigger") continue;
    const item: LockedPage["conditions"][number] = { text: cd.text, met: evaluate(cd.test, live, self) === "met" };
    const req = testToReq(cd.test, self);
    if (req) item.req = req;
    conditions.push(item);
  }
  const lp: LockedPage = { page: pi, location: entry.location, unseen, unpicked, conditions };
  if (activePage > pi && conditions.every(cd => cd.met)) lp.shadowed = true;
  return lp;
}

function checkEvent(
  ev: MapEvent, mapId: number, data: GameData, byKey: Map<string, PageEntry>, coverage: Coverage, live: LiveSnapshot,
  livePages: Map<number, number>, bgData: Background | null, overrides: PluginOverrides | null,
): ChecklistEvent | null {
  const pages = arr<MapEvent["pages"][number] | null>(ev.pages);
  const entries = pages.map((_, pi) => byKey.get(locationKey({ source: "map", mapId, eventId: ev.id, page: pi })) ?? null);

  const fromLive = livePages.get(ev.id);
  const activePage = fromLive !== undefined ? fromLive : activePageIndex(ev, mapId, data, live);
  const activePg = activePage >= 0 ? pages[activePage] : undefined;
  const activeEntry = activePage >= 0 ? entries[activePage] ?? null : null;
  const enemyFound = enemyOf(ev, mapId, data, activePage);
  // 사라진 적(지금 페이지 없음·지워짐)은 목록에 안 넣는다
  if (enemyFound && activePage < 0) return null;
  const enemyNow = !!enemyFound?.now;
  // 지금 전투를 거는 적은 돌아다니며 다가오므로 직접 갈 수 없는 곳으로 보지 않는다
  const bg = enemyNow ? null : bgData;
  const trigger = num(activePg?.trigger);
  const commands = isObj(activePg) ? realCommands(activePg.list) : [];
  const interactable = isObj(activePg) && trigger <= 2 && commands.length > 0;
  // TemplateEvent 호출(원래 이벤트 페이지 등)은 불린 목록의 명령으로 펼쳐 얻는 것·플러그인 명령을 찾는다.
  const runCommands = interactable ? realCommands(flattenCalls(activePg.list, { data, mapId, event: ev, page: activePage })) : [];
  const exitFound = !enemyNow && activePage >= 0 && isObj(activePg) && trigger <= 2 ? exitOf(ev, mapId, data, activePage) : null;
  if (!interactable && !exitFound && !entries.some(e => e && hasContent(e))) return null;

  const active = !!activeEntry && isObj(activePg);
  const auto = active && (trigger === 3 || trigger === 4);
  const { unpicked } = activeEntry ? pageNewCounts(activeEntry, coverage) : { unpicked: 0 };
  const rem = active ? remainingLines(activeEntry, coverage, data, live, ev, mapId, activePage) : null;
  const unseen = rem?.nowCount ?? 0;
  const repeat = active && trigger <= 4 ? repeatInfo(ev, mapId, data, live, activePage) : [];
  const gains = interactable ? gainsOf(runCommands, data) : [];
  const pluginHint = interactable ? pluginHintOf(runCommands, overrides) : undefined;
  // 플러그인 명령은 실행되면 기록되므로(병렬 제외), 그 페이지가 기록에 없으면 아직 안 해 본 것
  const touched = coverage.touched instanceof Set ? coverage.touched : null;
  const untried = !exitFound && !enemyNow && interactable && !!activeEntry && touched !== null && unseen === 0 && unpicked === 0 && gains.length === 0
    && repeat.length === 0 && runCommands.some(isPluginCommand) && !touched.has(locationKey(activeEntry.location));

  const locked: LockedPage[] = [];
  entries.forEach((entry, pi) => {
    if (pi === activePage || !entry || !entry.hasDialogue || !isObj(pages[pi])) return;
    const lp = lockedPage(ev, pi, mapId, entry, data, coverage, live, activePage);
    if (lp) locked.push(lp);
  });
  // 자동 실행·병렬 활성 페이지의 새 내용은 지금 할 수 있는 게 아니라 이야기 진행을 기다리는 것
  const autoNew = auto && (unseen > 0 || unpicked > 0);

  const section: Section = enemyNow ? "enemy"
    : exitFound ? "exit"
    : interactable && (unseen > 0 || unpicked > 0 || untried) ? "now"
    : interactable && gains.length > 0 ? "item"
    : repeat.length > 0 ? "repeat"
    : interactable ? "talk"
    : locked.length > 0 || autoNew ? "locked"
    : "done";
  const autoTrigger = (pi: number) => { const t = num(pages[pi]?.trigger); return t === 3 || t === 4; };
  const story = !!bg || (section === "locked" && (!pages.some(hasGraphic) || locked.every(lp => autoTrigger(lp.page))));
  const anyEntry = activeEntry ?? entries.find(e => e) ?? null;
  // 이게 뭔지: 지금 페이지(없으면 첫 잠긴 페이지·첫 페이지)의 그림·트리거·자율 이동
  const descPg = activePg ?? pages[locked[0]?.page ?? 0] ?? pages.find(isObj);
  const descTrigger = num(descPg?.trigger);
  const moveType = num(descPg?.moveType);
  const moves = moveType === 1 || moveType === 2;
  const hintAny = activePg ? pluginHintOf(realCommands(flattenCalls(activePg.list, { data, mapId, event: ev, page: activePage })), overrides) : undefined;
  const preview = previewLine(activeEntry ?? (locked[0] ? entries[locked[0].page] ?? null : null), coverage, data)
    ?? (hintAny ? clip(hintAny, PREVIEW_MAX) : undefined);
  const quoted = preview ? ` · “${preview}”` : "";
  const trigText = descTrigger === 0 ? "말 걸기·조사" : descTrigger <= 2 ? "밟으면 시작" : "자동으로 시작";
  const kind = imageKind(descPg);
  let describe: string;
  if (enemyNow && enemyFound) describe = `${describeEnemy(enemyFound)}${quoted}`;
  else if (bg) describe = `직접 갈 수 없는 곳 — 다른 이벤트가 실행시켜요${bg.calledBy ? ` · ${bg.calledBy}이(가) 불러요` : ""}`;
  else if (exitFound) describe = exitFound.now ? `출구 · ${trigText}${quoted}` : `출구 · 지금은 이동 안 됨${quoted}`;
  else if (kind === "none") {
    describe = `보이지 않는 이벤트 — ${descTrigger === 0 ? "표시된 칸에서 확인 버튼" : descTrigger <= 2 ? "표시된 칸을 밟으면 시작" : "자동으로 시작"}${quoted}`;
  } else describe = `${kind === "npc" ? "사람·NPC" : "물건"} · ${trigText}${moves ? " · 돌아다님" : ""}${quoted}`;
  // 출구가 아닌데 지금 페이지가 장소 이동을 하면(대사·선택지 뒤 이동 등) 알려 준다
  const talkTransfer = !bg && !exitFound && activePg ? findTransfer(activePg.list, { data, mapId, event: ev, page: activePage }, data) : null;
  if (talkTransfer) describe += ` · → ${mapNameOf(data, talkTransfer.mapId)}로 이동할 수 있음`;
  const item: ChecklistEvent = {
    eventId: ev.id, name: typeof ev.name === "string" ? ev.name : "", title: anyEntry?.title ?? (ev.name || `EV${ev.id}`),
    x: num(ev.x), y: num(ev.y), section, activePage,
    location: activeEntry ? activeEntry.location : null,
    auto, unseen, unpicked, remainingLines: rem?.now ?? [], laterLines: rem?.later ?? [], later: rem?.laterCount ?? 0,
    repeat, locked, interactable, gains, story, describe, moves,
  };
  if (enemyFound) item.enemy = enemyFound;
  if (exitFound) item.exit = { mapId: exitFound.target.mapId, mapName: mapNameOf(data, exitFound.target.mapId), now: exitFound.now };
  if (bg) {
    item.background = bg.kind;
    if (bg.calledBy) item.calledBy = bg.calledBy;
  }
  if (pluginHint) item.pluginHint = pluginHint;
  if (untried) item.untried = true;
  return item;
}

/** 원본을 모르는 생성 이벤트: 맵 표시만(다 봄 구역, 번호 없음) */
function unknownSpawn(ev: MapEvent): ChecklistEvent {
  const name = typeof ev.name === "string" ? ev.name : "";
  return {
    eventId: ev.id, name, title: UNKNOWN_SPAWN_TITLE, x: num(ev.x), y: num(ev.y), section: "done", activePage: -1, location: null,
    auto: false, unseen: 0, unpicked: 0, remainingLines: [], laterLines: [], later: 0, repeat: [], locked: [],
    interactable: false, gains: [], story: false, moves: false,
    describe: `게임이 실행 중에 만든 이벤트예요 — 원본을 찾지 못했어요${name ? ` · ${name}` : ""}`,
  };
}

/**
 * 지금 있는 맵(live.mapId)의 체크리스트: 안 본 내용·얻을 것·반복하면 달라지는 것·조사할 수 있는 것·잠긴 것·다 본 것.
 * 활성 페이지는 live.events가 있으면 그것을, 없으면 activePageIndex로 계산한다.
 * 게임이 실행 중에 만든 이벤트(live.events spawn)는 원본을 복사해 넣는다(withSpawnedEvents, 번호는 맵 데이터 이벤트 뒤).
 * live 없음·맵 없음 → null. 예외를 던지지 않는다.
 */
export function mapChecklist(
  given: GameData, index: GameIndex, coverage: Coverage, live: LiveSnapshot, passage?: MapPassage | null, overrides: PluginOverrides | null = null,
): MapChecklist | null {
  try {
    if (!isObj(live) || !isObj(given) || !(given.maps instanceof Map) || !isObj(coverage)) return null;
    const data = withSpawnedEvents(given, live);
    const mapId = num(live.mapId);
    const map = data.maps.get(mapId);
    if (!isObj(map)) return null;
    const byKey = pageEntries(index);
    const livePages = new Map<number, number>();
    for (const e of arr<{ eventId: unknown; page: unknown } | null>(live.events)) {
      if (isObj(e) && typeof e.eventId === "number" && typeof e.page === "number") livePages.set(e.eventId, e.page);
    }
    let reach: { passage: MapPassage; tiles: Set<string> } | null = null;
    if (isObj(passage) && isObj(passage.map) && isObj(passage.tileset) && passage.map.mapId === mapId) {
      const seeds = [...entryPoints(data, mapId), { x: num(live.x), y: num(live.y) }];
      reach = { passage, tiles: reachableTiles(passage.map, passage.tileset, seeds) };
    }
    const events: ChecklistEvent[] = [];
    let n = 0;
    const sorted = arr<MapEvent | null>(map.events)
      .filter((ev): ev is MapEvent => isObj(ev) && typeof ev.id === "number" && Array.isArray(ev.pages))
      // 실행 중에 생긴 이벤트(withSpawnedEvents)는 맵 데이터 이벤트 뒤에 번호를 받는다
      .sort((a, b) => Number(!!a.spawned) - Number(!!b.spawned) || a.id - b.id);
    for (const ev of sorted) {
      try {
        if (ev.spawned && ev.spawned.from === null) {
          events.push(unknownSpawn(ev));
          continue;
        }
        const bg = backgroundOf(ev, mapId, data, reach);
        // 번호는 맵 데이터만으로(타일·지금 상태와 무관): 걸어서 실행하는 페이지가 있는 이벤트. 이야기·자동 진행이면 번호를 안 보일 뿐(빈 번호)
        const number = ev.pages.some(directPage) ? ++n : undefined;
        const item = checkEvent(ev, mapId, data, byKey, coverage, live, livePages, bg, overrides);
        if (!item) continue;
        if (number !== undefined && !item.story) item.number = number;
        events.push(item);
      } catch { /* 이상한 이벤트는 건너뛴다 */ }
    }
    events.sort((a, b) => rank(a) - rank(b) || a.eventId - b.eventId);
    const info = arr<{ name?: string } | null>(data.mapInfos)[mapId];
    return {
      mapId,
      mapName: (isObj(info) && info.name) || map.displayName || `맵 ${mapId}`,
      width: num(map.width), height: num(map.height),
      player: { x: num(live.x), y: num(live.y) },
      events,
      remaining: events.filter(e => !e.story && e.section !== "talk" && e.section !== "done"
        && ((e.section !== "exit" && e.section !== "enemy") || e.unseen > 0 || e.unpicked > 0)).length,
    };
  } catch {
    return null;
  }
}
