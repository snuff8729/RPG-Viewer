import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Maximize, Minus, Plus } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import { blocked } from "@/core/map/passage";
import type { Route } from "@/core/map/route";
import { drawOpsForTile, shadowOps, tileAt, type DrawOp } from "@/core/map/tiles";
import type { EventImage } from "@/core/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { mapMarkers, spriteEffect, staticKey, type CurrentEvent } from "./mapEvents";
import { fitZoom, MAX_ZOOM, MIN_ZOOM } from "./mapZoom";
import { MapLegend } from "./MapLegend";
import { eventStyle } from "./sectionStyle";
import type { LoadedTiles } from "./useMapTiles";

/** 시트 원본 칸 크기. 그리기 명령은 이 단위로 만들고 캔버스 변환으로 줄인다. */
const T = 48;
/** 캔버스 한 장의 최대 픽셀 수(메모리 상한) */
const MAX_AREA = 16_000_000;
/** 한 프레임에 그리는 시간(ms). 넘으면 다음 프레임으로 넘겨 큰 맵에서도 화면이 멈추지 않게 한다 */
const SLICE_MS = 10;
/** 합성 방법(0 보통, 1 더하기, 2 곱하기, 3 스크린) → 캔버스 합성 */
const BLEND: GlobalCompositeOperation[] = ["source-over", "lighter", "multiply", "screen"];

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 맵 w×h칸을 칸당 want px로 그리되 캔버스 넓이 상한을 넘지 않는 칸 크기. */
function cellFor(w: number, h: number, want: number): number {
  return Math.max(1, Math.min(want, Math.sqrt(MAX_AREA / (w * h))));
}

function drawOps(ctx: CanvasRenderingContext2D, ops: DrawOp[], sheets: (ImageBitmap | null)[]) {
  for (const op of ops) {
    if (op.sheet < 0) { ctx.fillRect(op.dx, op.dy, op.w, op.h); continue; }
    const img = sheets[op.sheet];
    if (img) ctx.drawImage(img, op.sx, op.sy, op.w, op.h, op.dx, op.dy, op.w, op.h);
  }
}

/** 한 줄의 타일 명령(Tilemap._paintTiles 순서: z0, z1, 그림자, z2, z3). upper = 별(0x10) 타일만. */
function rowOps(tiles: LoadedTiles, y: number, upper: boolean): DrawOp[] {
  const { map, tileset } = tiles;
  const out: DrawOp[] = [];
  const put = (id: number, x: number) => {
    if (((tileset.flags[id] ?? 0) & 0x10 ? true : false) !== upper) return;
    for (const op of drawOpsForTile(id, x, y, T, tileset, map)) out.push(op);
  };
  for (let x = 0; x < map.width; x++) {
    put(tileAt(map, x, y, 0), x);
    put(tileAt(map, x, y, 1), x);
    if (!upper) for (const op of shadowOps(tileAt(map, x, y, 4), x, y, T)) out.push(op);
    put(tileAt(map, x, y, 2), x);
    put(tileAt(map, x, y, 3), x);
  }
  return out;
}

/** 이벤트 그림(데이터의 불투명도·합성 방법을 적용): 타일이면 그 타일, 아니면 캐릭터 시트의 한 프레임을 칸 아래 가운데에 맞춰서. */
function drawSprite(
  ctx: CanvasRenderingContext2D, ev: CurrentEvent, img: EventImage, tiles: LoadedTiles, chars: Map<string, ImageBitmap | null>,
) {
  const { opacity, blendMode } = spriteEffect(ev.page, ev.id);
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = opacity / 255;
  ctx.globalCompositeOperation = BLEND[blendMode] ?? "source-over";
  try { drawSpriteImage(ctx, ev, img, tiles, chars); } finally { ctx.restore(); }
}

function drawSpriteImage(
  ctx: CanvasRenderingContext2D, ev: CurrentEvent, img: EventImage, tiles: LoadedTiles, chars: Map<string, ImageBitmap | null>,
) {
  if (img.tileId > 0) { drawOps(ctx, drawOpsForTile(img.tileId, ev.x, ev.y, T, tiles.tileset), tiles.sheets); return; }
  const name = img.characterName;
  const bmp = name ? chars.get(name) : null;
  if (!bmp) return;
  const sign = /^[!$]+/.exec(name)?.[0] ?? "";
  const big = sign.includes("$");
  const pw = bmp.width / (big ? 3 : 12);
  const ph = bmp.height / (big ? 4 : 8);
  const idx = big ? 0 : clamp(Math.floor(img.characterIndex) || 0, 0, 7);
  const pattern = Number.isInteger(img.pattern) && img.pattern >= 0 && img.pattern < 3 ? img.pattern : 1;
  // 지금 바라보는 방향(live, 방향 고정이 아니면)이 있으면 그쪽
  const dir = ev.d && !ev.page.directionFix ? ev.d : img.direction;
  const row = clamp(Math.floor((dir || 2) / 2) - 1, 0, 3);
  const sx = ((idx % 4) * 3 + pattern) * pw;
  const sy = (Math.floor(idx / 4) * 4 + row) * ph;
  const shift = sign.includes("!") ? 0 : 6;
  ctx.drawImage(bmp, sx, sy, pw, ph, ev.x * T + T / 2 - pw / 2, (ev.y + 1) * T - ph - shift, pw, ph);
}

const hasImage = (e: CurrentEvent) => !!e.page.image && (e.page.image.tileId > 0 || !!e.page.image.characterName);

/**
 * 바탕 캔버스: 아래층 타일 → 이벤트(아래·같음) → 위층 타일 → 이벤트(위). 프레임을 나눠 그린다.
 * 움직이는 이벤트(mobile)는 여기 그리지 않는다 — 위 캔버스가 지금 위치에 그린다.
 */
async function renderBase(
  canvas: HTMLCanvasElement, tiles: LoadedTiles, events: CurrentEvent[], chars: Map<string, ImageBitmap | null>, cancelled: () => boolean,
) {
  const { map } = tiles;
  const cell = cellFor(map.width, map.height, T);
  canvas.width = Math.round(map.width * cell);
  canvas.height = Math.round(map.height * cell);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(cell / T, 0, 0, cell / T, 0, 0);
  ctx.fillStyle = "rgba(0,0,0,0.5)"; // 그림자(sheet -1)
  const withImage = events.filter((e) => !e.mobile && hasImage(e));
  const byY = (a: CurrentEvent, b: CurrentEvent) => a.y - b.y;
  const below = withImage.filter((e) => (e.page.priorityType ?? 1) !== 2).sort(byY);
  const above = withImage.filter((e) => (e.page.priorityType ?? 1) === 2).sort(byY);
  let start = performance.now();
  const rows = async (upper: boolean) => {
    for (let y = 0; y < map.height; y++) {
      if (performance.now() - start > SLICE_MS) {
        await nextFrame();
        if (cancelled()) return false;
        start = performance.now();
      }
      drawOps(ctx, rowOps(tiles, y, upper), tiles.sheets);
    }
    return true;
  };
  if (!(await rows(false))) return;
  for (const e of below) drawSprite(ctx, e, e.page.image!, tiles, chars);
  if (!(await rows(true))) return;
  for (const e of above) drawSprite(ctx, e, e.page.image!, tiles, chars);
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: 2 | 4 | 6 | 8, len: number) {
  const [ux, uy] = dir === 2 ? [0, 1] : dir === 4 ? [-1, 0] : dir === 6 ? [1, 0] : [0, -1];
  const tipX = cx + ux * len, tipY = cy + uy * len;
  const bx = cx + ux * len * 0.2, by = cy + uy * len * 0.2;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(bx - uy * len * 0.45, by + ux * len * 0.45);
  ctx.lineTo(bx + uy * len * 0.45, by - ux * len * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

interface OverlayInput {
  tiles: LoadedTiles; walls: Path2D | null; listed: ChecklistEvent[]; numbers: Map<number, number>;
  /** 움직이는 이벤트(지금 위치에 그린다)와 캐릭터 그림 */
  mobile: CurrentEvent[]; chars: Map<string, ImageBitmap | null> | null;
  player: { x: number; y: number }; route: Route | null; selected: number | null;
  /** 고른 이벤트(표시가 안 그려지는 것이어도 길은 그린다) */
  selectedEv: ChecklistEvent | undefined;
}

/** 위 캔버스: 벽 그늘, 번호 표시, 내 위치, 고른 이벤트까지의 길. zoom = 화면 px/칸. */
function renderOverlay(canvas: HTMLCanvasElement, zoom: number, o: OverlayInput) {
  const { map } = o.tiles;
  const dpr = window.devicePixelRatio || 1;
  const cell = cellFor(map.width, map.height, zoom * dpr);
  canvas.width = Math.round(map.width * cell);
  canvas.height = Math.round(map.height * cell);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  /** 화면 1px이 이 캔버스에서 몇 px인지 */
  const px = cell / zoom;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (o.walls) {
    ctx.setTransform(cell, 0, 0, cell, 0, 0);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill(o.walls);
  }
  // 움직이는 이벤트 그림(지금 위치)
  if (o.chars && o.mobile.length > 0) {
    ctx.setTransform(cell / T, 0, 0, cell / T, 0, 0);
    for (const e of [...o.mobile].filter(hasImage).sort((a, b) => a.y - b.y)) drawSprite(ctx, e, e.page.image!, o.tiles, o.chars);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const colour = (e: ChecklistEvent) => cssVar(eventStyle(e).cssVar);
  const c = (v: number) => (v + 0.5) * cell;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // 고른 이벤트까지의 길
  const sel = o.selectedEv;
  if (sel && o.route) {
    const col = colour(sel);
    const steps = o.route.steps;
    if (steps.length > 1) {
      ctx.beginPath();
      steps.forEach((s, i) => (i === 0 ? ctx.moveTo(c(s.x), c(s.y)) : ctx.lineTo(c(s.x), c(s.y))));
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 7 * px;
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = 4 * px;
      ctx.stroke();
    }
    const st = o.route.stand;
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(st.x * cell, st.y * cell, cell, cell);
    ctx.strokeStyle = col;
    ctx.lineWidth = 3 * px;
    ctx.strokeRect(st.x * cell + 1.5 * px, st.y * cell + 1.5 * px, cell - 3 * px, cell - 3 * px);
    if (st.face) {
      ctx.fillStyle = col;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1.5 * px;
      arrow(ctx, c(st.x), c(st.y), st.face, Math.max(cell * 0.45, 10 * px));
    }
  }

  // 이벤트 표시(번호 원, 번호가 없으면 작은 점)
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const r = 10 * px;
  for (const ev of o.listed) {
    const n = o.numbers.get(ev.eventId);
    const cx = c(ev.x), cy = ev.y * cell + Math.min(cell * 0.2, r);
    ctx.beginPath();
    if (n == null) {
      ctx.globalAlpha = 0.7;
      ctx.arc(c(ev.x), c(ev.y), 4 * px, 0, Math.PI * 2);
      ctx.fillStyle = colour(ev);
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    // 다 본 것은 흐리게
    ctx.globalAlpha = ev.section === "done" && ev.eventId !== o.selected ? 0.45 : 1;
    ctx.arc(cx, cy, ev.eventId === o.selected ? r * 1.25 : r, 0, Math.PI * 2);
    ctx.fillStyle = colour(ev);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2 * px;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `600 ${(n >= 10 ? 10 : 12) * px}px sans-serif`;
    ctx.fillText(String(n), cx, cy + 0.5 * px);
    ctx.globalAlpha = 1;
  }

  // 내 위치
  const pr = Math.max(cell * 0.42, 11 * px);
  ctx.beginPath();
  ctx.arc(c(o.player.x), c(o.player.y), pr, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3 * px;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = `700 ${12 * px}px sans-serif`;
  ctx.fillText("나", c(o.player.x), c(o.player.y) + 0.5 * px);
}

/** 화면에서 테마(밝음/어두움)가 바뀌면 숫자를 올린다(색을 다시 읽어 그리게). */
function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => mo.disconnect();
  }, []);
  return tick;
}

/** 실제 맵 그림(타일셋·이벤트 그림) 위에 번호·내 위치·길을 겹쳐 그린다. 표시를 누르면 onPick(eventId). */
export function MapCanvas({ tiles, events, listed, numbers, player, route, selected, focus, onPick }: {
  tiles: LoadedTiles;
  /** 지금 활성 페이지가 있는 이벤트(그림·길막음용, 지금 위치) */
  events: CurrentEvent[];
  /** 체크리스트 이벤트(지금 위치, 번호 표시용: 이야기·자동 진행은 그리지 않고, 잠김은 스위치로, 다 본 것은 흐리게) */
  listed: ChecklistEvent[];
  numbers: Map<number, number>;
  player: { x: number; y: number };
  route: Route | null;
  selected: number | null;
  /** 바뀌면 그 칸을 가운데로(n: 같은 칸을 다시 요청해도 움직이게) */
  focus: { x: number; y: number; n: number } | null;
  onPick: (eventId: number) => void;
}) {
  const { assets } = useGame();
  const { map } = tiles;
  const scrollRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  /** 다음 레이아웃 뒤 가운데로 둘 칸 좌표 */
  const pendingCenter = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  /** 이벤트 처리기·효과에서 읽는 최신 zoom */
  const zoomRef = useRef(zoom);
  useLayoutEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const [showWalls, setShowWalls] = useState(true);
  const [showLocked, setShowLocked] = useState(false);
  const markers = useMemo(() => mapMarkers(listed, showLocked), [listed, showLocked]);
  const themeTick = useThemeTick();

  // 캐릭터 시트 읽기
  const charNames = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) if (e.page.image && !(e.page.image.tileId > 0) && e.page.image.characterName) s.add(e.page.image.characterName);
    return [...s].sort();
  }, [events]);
  const charKey = charNames.join("\n");
  const [chars, setChars] = useState<{ key: string; map: Map<string, ImageBitmap | null> } | null>(null);
  useEffect(() => {
    if (!assets) return;
    let alive = true;
    const names = charKey ? charKey.split("\n") : [];
    void Promise.all(names.map((n) => assets.image("characters", n))).then((bmps) => {
      if (alive) setChars({ key: charKey, map: new Map(names.map((n, i) => [n, bmps[i]])) });
    });
    return () => { alive = false; };
  }, [assets, charKey]);
  const charsReady = chars?.key === charKey ? chars.map : null;

  // 바탕은 맵·타일셋·움직이지 않는 이벤트·캐릭터 그림이 바뀔 때만 다시 그린다(돌아다니는 NPC 위치는 키에 없다)
  const sk = staticKey(events);
  const [baseEvents, setBaseEvents] = useState({ key: sk, events });
  if (baseEvents.key !== sk) setBaseEvents({ key: sk, events });
  const mobile = useMemo(() => events.filter((e) => e.mobile), [events]);
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || !charsReady) return;
    let cancelled = false;
    void renderBase(canvas, tiles, baseEvents.events, charsReady, () => cancelled);
    return () => { cancelled = true; };
  }, [tiles, baseEvents, charsReady]);

  const walls = useMemo(() => {
    const p = new Path2D();
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (blocked(map, tiles.tileset, x, y)) p.rect(x, y, 1, 1);
    return p;
  }, [map, tiles.tileset]);

  /** 확대 크기를 바꾸고, 바뀐 크기가 화면에 반영된 뒤 (x, y)칸 좌표를 가운데로 */
  const zoomAndCenter = (z: number, x: number, y: number) => {
    const el = scrollRef.current;
    if (el && z === zoomRef.current) {
      el.scrollLeft = x * z - el.clientWidth / 2;
      el.scrollTop = y * z - el.clientHeight / 2;
      return;
    }
    pendingCenter.current = { x, y, zoom: z };
    setZoom(z);
  };

  /** 맵 전체가 보이게(맞춤). 보이는 영역이 아직 0 크기면 false(크기가 잡히면 아래 ResizeObserver가 다시 부른다) */
  const fitNow = (): boolean => {
    const el = scrollRef.current;
    const z = el && fitZoom(el.clientWidth, el.clientHeight, map.width, map.height);
    if (!z) return false;
    zoomAndCenter(z, map.width / 2, map.height / 2);
    return true;
  };
  const fitRef = useRef(fitNow);
  useLayoutEffect(() => { fitRef.current = fitNow; });
  /** 이 맵에서 사용자가 직접 확대·축소했는지(했으면 크기가 바뀌어도 맞춤을 다시 하지 않는다) */
  const manualZoom = useRef(false);

  // 처음·다른 맵으로 옮겼을 때: 맞춤. 같은 맵에서 움직이거나 다시 그릴 때는 그대로 둔다.
  const initFor = useRef<LoadedTiles | null>(null);
  useLayoutEffect(() => {
    if (initFor.current === tiles) return;
    initFor.current = tiles;
    manualZoom.current = false;
    fitRef.current();
  }, [tiles]);

  // 보이는 영역 크기가 바뀌면(레이아웃이 자리 잡힌 뒤·창 크기 변경) 직접 확대하지 않았으면 다시 맞춤
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (!manualZoom.current) fitRef.current(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 가운데 맞추기는 확대 크기가 반영된 뒤에
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const p = pendingCenter.current;
    if (!el || !p || zoom !== p.zoom) return;
    pendingCenter.current = null;
    el.scrollLeft = p.x * zoom - el.clientWidth / 2;
    el.scrollTop = p.y * zoom - el.clientHeight / 2;
  });

  useEffect(() => {
    const z = zoomRef.current;
    if (!focus || z == null) return;
    zoomAndCenter(z, focus.x + 0.5, focus.y + 0.5);
    scrollRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  const { x: px, y: py } = player;
  // numbers는 부모가 매번 새로 만드므로 내용이 같으면 같은 값으로 본다(스냅샷마다 다시 그리지 않게)
  const numbersKey = [...numbers].join(";");
  const [stableNumbers, setStableNumbers] = useState({ key: numbersKey, numbers });
  if (stableNumbers.key !== numbersKey) setStableNumbers({ key: numbersKey, numbers });
  useEffect(() => {
    const canvas = overRef.current;
    if (!canvas || zoom == null) return;
    renderOverlay(canvas, zoom, {
      tiles, walls: showWalls ? walls : null, listed: markers, numbers: stableNumbers.numbers, mobile, chars: charsReady,
      player: { x: px, y: py }, route, selected,
      selectedEv: selected != null ? listed.find((e) => e.eventId === selected) : undefined,
    });
  }, [tiles, zoom, showWalls, walls, markers, listed, stableNumbers, mobile, charsReady, px, py, route, selected, themeTick]);

  const zoomBy = (f: number) => {
    const el = scrollRef.current;
    if (!el || zoom == null) return;
    const cx = (el.scrollLeft + el.clientWidth / 2) / zoom, cy = (el.scrollTop + el.clientHeight / 2) / zoom;
    manualZoom.current = true;
    zoomAndCenter(clamp(zoom * f, MIN_ZOOM, MAX_ZOOM), cx, cy);
  };
  const fit = () => { if (fitNow()) manualZoom.current = false; };
  const toPlayer = () => { if (zoom != null) zoomAndCenter(zoom, px + 0.5, py + 0.5); };

  /** 화면 좌표(캔버스 기준) → 가장 가까운 이벤트 표시 */
  const hit = (ox: number, oy: number): number | null => {
    if (zoom == null) return null;
    const tx = ox / zoom, ty = oy / zoom;
    const r = 12 / zoom;
    let best: { id: number; d: number } | null = null;
    for (const ev of markers) {
      const my = ev.y + Math.min(0.2, 10 / zoom);
      const dm = Math.hypot(tx - (ev.x + 0.5), ty - my);
      const onTile = Math.floor(tx) === ev.x && Math.floor(ty) === ev.y;
      const d = dm <= r ? dm : onTile ? r : Infinity;
      if (d < Infinity && (!best || d < best.d)) best = { id: ev.eventId, d };
    }
    return best?.id ?? null;
  };

  const loading = !charsReady || zoom == null;
  const w = map.width * (zoom ?? 0), h = map.height * (zoom ?? 0);
  return (
    <Card className="gap-2 py-3">
      <CardContent className="space-y-2 px-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon-sm" aria-label="축소" onClick={() => zoomBy(1 / 1.25)}><Minus /></Button>
          <Button variant="outline" size="icon-sm" aria-label="확대" onClick={() => zoomBy(1.25)}><Plus /></Button>
          <Button variant="outline" size="sm" onClick={fit}><Maximize />맞춤</Button>
          <Button variant="outline" size="sm" onClick={toPlayer}><Crosshair />내 위치로</Button>
          <div className="ml-auto flex items-center gap-2">
            <Switch id="map-locked" checked={showLocked} onCheckedChange={setShowLocked} />
            <Label htmlFor="map-locked">잠긴 것도 표시</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="map-walls" checked={showWalls} onCheckedChange={setShowWalls} />
            <Label htmlFor="map-walls">벽 표시</Label>
          </div>
        </div>
        <div ref={scrollRef} className="relative h-[min(60vh,32rem)] overflow-auto rounded-md border bg-muted">
          {loading && <Skeleton className="absolute inset-0 rounded-none" />}
          <div className="relative" style={{ width: w, height: h }}>
            <canvas ref={baseRef} className="absolute inset-0 size-full" />
            <canvas
              ref={overRef}
              className="absolute inset-0 size-full"
              role="img"
              aria-label="맵 그림"
              onClick={(e) => { const id = hit(e.nativeEvent.offsetX, e.nativeEvent.offsetY); if (id != null) onPick(id); }}
              onMouseMove={(e) => { e.currentTarget.style.cursor = hit(e.nativeEvent.offsetX, e.nativeEvent.offsetY) != null ? "pointer" : ""; }}
            />
          </div>
        </div>
        <MapLegend />
      </CardContent>
    </Card>
  );
}
