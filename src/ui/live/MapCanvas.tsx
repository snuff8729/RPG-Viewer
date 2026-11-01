import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Crosshair, Maximize, Minus, Plus } from "lucide-react";
import { useGame } from "@/app/GameProvider";
import { mapEncounters, regionCells } from "@/core/live/enemies";
import type { ChecklistEvent } from "@/core/live/mapChecklist";
import { blocked } from "@/core/map/passage";
import type { Route } from "@/core/map/route";
import type { StoryMark } from "@/core/story/format";
import { drawOpsForTile, shadowOps, tileAt, type DrawOp } from "@/core/map/tiles";
import type { EventImage } from "@/core/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { mapMarkers, spriteEffect, staticKey, type CurrentEvent } from "./mapEvents";
import { clampScroll, clampZoom, fitZoom, followScroll, isDrag, pinchZoom, scrollChange, shouldRefit, wheelFactor } from "./mapZoom";
import { useMapLegend } from "./mapLegendState";
import { gameKeyOf } from "./readPosition";
import { eventStyle } from "./sectionStyle";
import type { LoadedTiles } from "./useMapTiles";

/** 시트 원본 칸 크기. 그리기 명령은 이 단위로 만들고 캔버스 변환으로 줄인다. */
const T = 48;
/** 캔버스 한 장의 최대 픽셀 수(메모리 상한) */
const MAX_AREA = 16_000_000;
/** 작게 보일 때 맞춤이 이보다 작으면(px/칸) 이 크기로 내 위치를 보여준다 */
const COMPACT_MIN_ZOOM = 8;
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

/** 다음 스토리 표시: 갈 곳(별) 또는 그쪽 출구(이쪽으로)와 그곳까지 가는 길 */
export type StoryOverlay = StoryMark & { route: Route | null };

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) ctx.moveTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
    else ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  ctx.closePath();
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

/**
 * 표시 원: 범례 칩과 같은 색으로 채우고 같은 색 고리(불투명). 맵 위에서 보이게 바깥에 얇은 어두운 테두리만 더한다.
 */
function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, col: string, px: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2 * px, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 2 * px;
  ctx.stroke();
}

/** lucide Swords 아이콘 선(24×24) */
const SWORDS_PATHS = [
  "m13 19 6-6",
  "M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5",
  "m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586",
  "m16 16 4 4",
  "m19 21 2-2",
  "m5 14 4 4",
  "m5 21-2-2",
  "M7.5 16.5 4 20",
];
let swordsPath: Path2D | null = null;

/** 적 표시: 빨간 원에 칼 두 자루. 쫓아오는 적은 점선 고리를 두른다. */
function drawEnemy(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, col: string, px: number, chase: boolean) {
  disc(ctx, cx, cy, r, col, px);
  if (chase) {
    ctx.save();
    ctx.setLineDash([3 * px, 2 * px]);
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3 * px, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  swordsPath ??= (() => { const p = new Path2D(); for (const d of SWORDS_PATHS) p.addPath(new Path2D(d)); return p; })();
  const s = (r * 1.05) / 24;
  ctx.save();
  ctx.translate(cx - 12 * s, cy - 12 * s);
  ctx.scale(s, s);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke(swordsPath);
  ctx.restore();
}

interface OverlayInput {
  tiles: LoadedTiles; walls: Path2D | null; listed: ChecklistEvent[]; numbers: Map<number, number>;
  /** 적이 나오는 구역 칸(보이게 했을 때만) */
  regions: Path2D | null;
  /** 움직이는 이벤트(지금 위치에 그린다)와 캐릭터 그림 */
  mobile: CurrentEvent[]; chars: Map<string, ImageBitmap | null> | null;
  player: { x: number; y: number }; route: Route | null; selected: number | null;
  /** 고른 이벤트(표시가 안 그려지는 것이어도 길은 그린다) */
  selectedEv: ChecklistEvent | undefined;
  story: StoryOverlay | null;
  /** 내 위치를 그릴지(범례에서 끌 수 있다) */
  showPlayer: boolean;
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
  if (o.regions) {
    ctx.setTransform(cell, 0, 0, cell, 0, 0);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = cssVar("--section-enemy");
    ctx.fill(o.regions);
    ctx.globalAlpha = 1;
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

  // 다음 스토리까지의 길(점선). 고른 이벤트 길이 있으면 그쪽만
  const story = o.story;
  if (story?.route && story.route.steps.length > 1 && !(o.selectedEv && o.route)) {
    ctx.beginPath();
    story.route.steps.forEach((s, i) => (i === 0 ? ctx.moveTo(c(s.x), c(s.y)) : ctx.lineTo(c(s.x), c(s.y))));
    ctx.setLineDash([6 * px, 5 * px]);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 6 * px;
    ctx.stroke();
    ctx.strokeStyle = cssVar("--section-story");
    ctx.lineWidth = 3 * px;
    ctx.stroke();
    ctx.setLineDash([]);
  }

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
    if (ev.section === "enemy" && !ev.story) {
      drawEnemy(ctx, cx, cy, ev.eventId === o.selected ? r * 1.25 : r, colour(ev), px, !!ev.enemy?.chase);
      continue;
    }
    // 다 본 것만 흐리게, 나머지는 범례 칩과 같은 색 그대로
    ctx.globalAlpha = ev.section === "done" && ev.eventId !== o.selected ? 0.45 : 1;
    if (n == null) {
      disc(ctx, c(ev.x), c(ev.y), 4 * px, colour(ev), px);
      ctx.globalAlpha = 1;
      continue;
    }
    disc(ctx, cx, cy, ev.eventId === o.selected ? r * 1.25 : r, colour(ev), px);
    ctx.fillStyle = "#fff";
    ctx.font = `600 ${(n >= 10 ? 10 : 12) * px}px sans-serif`;
    ctx.fillText(String(n), cx, cy + 0.5 * px);
    ctx.globalAlpha = 1;
  }

  // 다음 스토리 표시: 이 맵의 갈 곳에 별, 아니면 그쪽 출구에 고리와 이쪽으로
  if (story) {
    const col = cssVar("--section-story");
    const sx = c(story.x), sy = c(story.y);
    if (story.kind === "star") {
      star(ctx, sx, story.y * cell - Math.max(cell * 0.1, 4 * px), Math.max(cell * 0.45, 12 * px));
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(cell * 0.6, 14 * px), 0, Math.PI * 2);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3 * px;
      ctx.stroke();
      const label = "이쪽으로";
      ctx.font = `700 ${12 * px}px sans-serif`;
      const w = ctx.measureText(label).width + 10 * px, h = 18 * px;
      const ly = Math.max(0, sy - Math.max(cell * 0.6, 14 * px) - h - 2 * px);
      ctx.fillStyle = col;
      ctx.fillRect(sx - w / 2, ly, w, h);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, sx, ly + h / 2 + 0.5 * px);
    }
  }

  // 내 위치
  if (!o.showPlayer) return;
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
export function MapCanvas({
  tiles, events, listed, numbers, player, route, selected, focus, onPick, compact = false, showWalls = true, story = null,
}: {
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
  /**
   * 작게(플레이 화면): 부모 높이를 채운다.
   * 맞춤이 너무 작으면 읽을 수 있는 크기로 내 위치를 가운데 두고, 내가 화면 밖으로 나가면 따라간다.
   */
  compact?: boolean;
  /** 벽 그늘 표시(구역 칩 줄의 ⋯ 메뉴에서 바꾼다) */
  showWalls?: boolean;
  /** 다음 스토리 표시(없으면 안 그린다) */
  story?: StoryOverlay | null;
}) {
  const { assets, data } = useGame();
  const { map } = tiles;
  const scrollRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  /** 다음 레이아웃 뒤 보이는 영역의 (ax, ay)px(없으면 가운데)에 둘 칸 좌표 */
  const pendingCenter = useRef<{ x: number; y: number; zoom: number; ax?: number; ay?: number } | null>(null);
  /** 이 맵에서 사용자가 직접 확대·축소·끌기를 했는지(했으면 크기가 바뀌어도 맞춤을 다시 하지 않는다) */
  const manualZoom = useRef(false);
  /** 직접 움직였으면 내 위치 따라가기를 멈춘다(내 위치로·맞춤·맵 바뀜에서 다시) */
  const followPaused = useRef(false);
  const markManual = () => { manualZoom.current = true; followPaused.current = true; };
  const [zoom, setZoom] = useState<number | null>(null);
  /** 이벤트 처리기·효과에서 읽는 최신 zoom */
  const zoomRef = useRef(zoom);
  useLayoutEffect(() => { zoomRef.current = zoom; }, [zoom]);
  // 범례에서 끈 항목(게임별로 기억, 이 맵·플레이 화면 목록과 함께 쓴다)
  const [legendHidden] = useMapLegend(data ? gameKeyOf(data) : "");
  const markers = useMemo(() => mapMarkers(listed, legendHidden), [listed, legendHidden]);
  const showRegions = !legendHidden.has("regions");
  const showPlayer = !legendHidden.has("player");
  const shownStory = legendHidden.has("story") ? null : story;
  /** 적이 나오는 구역(랜덤 인카운트에 구역 지정이 있을 때) 칸들 */
  const regionPath = useMemo(() => {
    const enc = data ? mapEncounters(data, map.mapId) : null;
    const cells = enc ? regionCells(map, enc.regions) : [];
    if (cells.length === 0) return null;
    const p = new Path2D();
    for (const cl of cells) p.rect(cl.x, cl.y, 1, 1);
    return p;
  }, [data, map]);
  const themeTick = useThemeTick();

  // 캐릭터 시트 읽기
  const charNames = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) if (e.page.image && !(e.page.image.tileId > 0) && e.page.image.characterName) s.add(e.page.image.characterName);
    return [...s].sort();
  }, [events]);
  const charKey = charNames.join("\n");
  const [chars, setChars] = useState<{ assets: unknown; key: string; map: Map<string, ImageBitmap | null> } | null>(null);
  useEffect(() => {
    if (!assets) return;
    let alive = true;
    const names = charKey ? charKey.split("\n") : [];
    const leases = names.map(n => assets.acquireImage("characters", n));
    void Promise.all(leases.map(lease => lease.value)).then((bmps) => {
      if (alive) setChars({ assets, key: charKey, map: new Map(names.map((n, i) => [n, bmps[i]])) });
    });
    return () => { alive = false; leases.forEach(lease => lease.release()); };
  }, [assets, charKey]);
  const charsReady = chars?.assets === assets && chars?.key === charKey ? chars.map : null;

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

  /** 스크롤을 정수 px로 옮긴다. 지금과 1px 안쪽이면 그대로(같은 입력이 반복돼도 떨리지 않게) */
  const scrollTo = (el: HTMLDivElement, left: number, top: number) => {
    const ch = scrollChange(el.scrollLeft, el.scrollTop, left, top);
    if (!ch) return;
    el.scrollLeft = ch.left;
    el.scrollTop = ch.top;
  };
  /** 확대 크기를 바꾸고, 바뀐 크기가 화면에 반영된 뒤 (x, y)칸 좌표를 가운데로 */
  const zoomAndCenter = (z: number, x: number, y: number) => {
    const el = scrollRef.current;
    if (el && z === zoomRef.current) {
      pendingCenter.current = null;
      scrollTo(el, x * z - el.clientWidth / 2, y * z - el.clientHeight / 2);
      return;
    }
    pendingCenter.current = { x, y, zoom: z };
    setZoom(z);
  };

  /** 다음 프레임에 확대 크기 반영(휠·핀치가 한 프레임에 여러 번 와도 한 번만 다시 그리게) */
  const zoomFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(zoomFrame.current), []);
  /** 확대 크기 z에서 (x, y)칸 좌표가 보이는 영역의 (ax, ay)px에 오게 한다 */
  const place = (z: number, x: number, y: number, ax: number, ay: number) => {
    const el = scrollRef.current;
    if (!el) return;
    if (z === zoomRef.current && !pendingCenter.current) {
      scrollTo(el, x * z - ax, y * z - ay);
      return;
    }
    pendingCenter.current = { x, y, zoom: z, ax, ay };
    cancelAnimationFrame(zoomFrame.current);
    zoomFrame.current = requestAnimationFrame(() => {
      const p = pendingCenter.current;
      if (!p) return;
      if (p.zoom === zoomRef.current) {
        pendingCenter.current = null;
        scrollTo(el, p.x * p.zoom - (p.ax ?? el.clientWidth / 2), p.y * p.zoom - (p.ay ?? el.clientHeight / 2));
      } else setZoom(p.zoom);
    });
  };
  /** 보이는 영역의 (ax, ay)px 아래 칸 좌표와 그때의 확대 크기(아직 반영 안 된 확대가 있으면 그것 기준) */
  const under = (ax: number, ay: number): { x: number; y: number; zoom: number } | null => {
    const el = scrollRef.current;
    const p = pendingCenter.current;
    if (!el) return null;
    if (p) {
      return {
        x: p.x + (ax - (p.ax ?? el.clientWidth / 2)) / p.zoom,
        y: p.y + (ay - (p.ay ?? el.clientHeight / 2)) / p.zoom,
        zoom: p.zoom,
      };
    }
    const z = zoomRef.current;
    if (z == null) return null;
    return { x: (el.scrollLeft + ax) / z, y: (el.scrollTop + ay) / z, zoom: z };
  };
  /** (ax, ay)px를 붙잡은 채 f배 확대·축소 */
  const zoomAt = (f: number, ax: number, ay: number) => {
    const u = under(ax, ay);
    if (!u) return;
    markManual();
    place(clampZoom(u.zoom * f), u.x, u.y, ax, ay);
  };

  /** 맵 전체가 보이게(맞춤). 보이는 영역이 아직 0 크기면 false(크기가 잡히면 아래 ResizeObserver가 다시 부른다) */
  /** 마지막으로 맞춘 보이는 영역 크기(작게 바뀐 것은 다시 맞추지 않는다) */
  const fittedSize = useRef<{ w: number; h: number } | null>(null);
  const fitNow = (): boolean => {
    const el = scrollRef.current;
    const z = el && fitZoom(el.clientWidth, el.clientHeight, map.width, map.height);
    if (!z) return false;
    fittedSize.current = { w: el.clientWidth, h: el.clientHeight };
    if (compact && z < COMPACT_MIN_ZOOM) zoomAndCenter(COMPACT_MIN_ZOOM, player.x + 0.5, player.y + 0.5);
    else zoomAndCenter(z, map.width / 2, map.height / 2);
    return true;
  };
  const fitRef = useRef(fitNow);
  useLayoutEffect(() => { fitRef.current = fitNow; });

  // 처음·다른 맵으로 옮겼을 때: 맞춤. 같은 맵에서 움직이거나 다시 그릴 때(타일 객체가 새로 와도)는 그대로 둔다.
  const mapKey = `${map.mapId}:${map.width}x${map.height}`;
  const initFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (initFor.current === mapKey) return;
    initFor.current = mapKey;
    manualZoom.current = false;
    followPaused.current = false;
    fittedSize.current = null;
    fitRef.current();
  }, [mapKey]);

  // 보이는 영역 크기가 바뀌면(레이아웃이 자리 잡힌 뒤·창 크기 변경) 직접 확대하지 않았으면 다시 맞춤
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // 크기가 RESIZE_SLACK px 넘게 바뀌었을 때만, 한 프레임에 한 번
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (manualZoom.current || !shouldRefit(fittedSize.current, el.clientWidth, el.clientHeight)) return;
        fitRef.current();
      });
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // 가운데 맞추기는 확대 크기가 반영된 뒤에
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const p = pendingCenter.current;
    if (!el || !p || zoom !== p.zoom) return;
    pendingCenter.current = null;
    scrollTo(el, p.x * zoom - (p.ax ?? el.clientWidth / 2), p.y * zoom - (p.ay ?? el.clientHeight / 2));
  });

  useEffect(() => {
    const z = zoomRef.current;
    if (!focus || z == null) return;
    zoomAndCenter(z, focus.x + 0.5, focus.y + 0.5);
    scrollRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  const { x: px, y: py } = player;
  // 작게 보일 때: 내가 보이는 영역 가장자리 밖으로 나가면 내 위치를 가운데로
  useEffect(() => {
    const el = scrollRef.current;
    const z = zoomRef.current;
    if (!compact || !el || z == null || pendingCenter.current || followPaused.current) return;
    // 안쪽 여백 밖으로 나갔을 때만(맵 전체가 보이면 움직이지 않는다), 끌고 있는 중에는 안 한다
    if (pointers.current.size > 0) return;
    const next = followScroll((px + 0.5) * z, (py + 0.5) * z, {
      left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight, scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
    }, z);
    if (next) scrollTo(el, next.left, next.top);
  }, [compact, px, py]);
  // numbers는 부모가 매번 새로 만드므로 내용이 같으면 같은 값으로 본다(스냅샷마다 다시 그리지 않게)
  const numbersKey = [...numbers].join(";");
  const [stableNumbers, setStableNumbers] = useState({ key: numbersKey, numbers });
  if (stableNumbers.key !== numbersKey) setStableNumbers({ key: numbersKey, numbers });
  // 위 캔버스는 확대가 멈춘 뒤에 그 크기로 다시 그린다(휠·핀치 중에는 늘려 보여서 가볍게)
  const [drawZoom, setDrawZoom] = useState<number | null>(null);
  const drawnOnce = useRef(false);
  useEffect(() => {
    if (zoom == null) return;
    const t = setTimeout(() => setDrawZoom(zoom), drawnOnce.current ? 150 : 0);
    drawnOnce.current = true;
    return () => clearTimeout(t);
  }, [zoom]);
  useEffect(() => {
    const canvas = overRef.current;
    if (!canvas || drawZoom == null) return;
    renderOverlay(canvas, drawZoom, {
      tiles, walls: showWalls ? walls : null, listed: markers, numbers: stableNumbers.numbers, mobile, chars: charsReady,
      regions: showRegions ? regionPath : null,
      player: { x: px, y: py }, route, selected,
      selectedEv: selected != null ? listed.find((e) => e.eventId === selected) : undefined,
      story: shownStory, showPlayer,
    });
  }, [tiles, drawZoom, showWalls, walls, markers, listed, stableNumbers, mobile, charsReady, px, py, route, selected, themeTick, showRegions, regionPath, shownStory, showPlayer]);

  const zoomBy = (f: number) => {
    const el = scrollRef.current;
    if (el) zoomAt(f, el.clientWidth / 2, el.clientHeight / 2);
  };
  const fit = () => { if (fitNow()) { manualZoom.current = false; followPaused.current = false; } };
  const toPlayer = () => {
    const el = scrollRef.current;
    const z = pendingCenter.current?.zoom ?? zoom;
    if (!el || z == null) return;
    followPaused.current = false;
    place(z, px + 0.5, py + 0.5, el.clientWidth / 2, el.clientHeight / 2);
  };

  // 마우스 휠·트랙패드 핀치: 커서 자리를 붙잡고 확대·축소(페이지는 스크롤하지 않는다)
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useLayoutEffect(() => {
    wheelRef.current = (e) => {
      const el = scrollRef.current;
      if (!el || e.deltaY === 0) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), e.clientX - r.left - el.clientLeft, e.clientY - r.top - el.clientTop);
    };
  });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 끌어서 옮기기(마우스 왼쪽·터치·펜), 두 손가락 벌리기. 거의 안 움직이고 떼면 표시 고르기.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ sx: number; sy: number; sl: number; st: number; moved: boolean } | null>(null);
  const pinch = useRef<{ dist: number; zoom: number; x: number; y: number } | null>(null);
  /** 화면 좌표 → 보이는 영역 기준 px */
  const local = (cx: number, cy: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return { x: cx - r.left - el.clientLeft, y: cy - r.top - el.clientTop };
  };
  const twoFingers = () => {
    const [a, b] = [...pointers.current.values()];
    const m = local((a.x + b.x) / 2, (a.y + b.y) / 2);
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: m.x, my: m.y };
  };
  const startDrag = (x: number, y: number, moved: boolean) => {
    const el = scrollRef.current!;
    drag.current = { sx: x, sy: y, sl: el.scrollLeft, st: el.scrollTop, moved };
  };
  /** 화면 좌표 → 가장 가까운 이벤트 표시 */
  const hitAt = (cx: number, cy: number): number | null => {
    const r = stackRef.current?.getBoundingClientRect();
    return r ? hit(cx - r.left, cy - r.top) : null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // 스크롤 막대를 누른 것은 그대로 둔다
    const l = local(e.clientX, e.clientY);
    if (l.x >= el.clientWidth || l.y >= el.clientHeight) return;
    el.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) startDrag(e.clientX, e.clientY, false);
    else if (pointers.current.size === 2) {
      const t = twoFingers();
      const u = under(t.mx, t.my);
      if (u) pinch.current = { dist: t.dist, zoom: u.zoom, x: u.x, y: u.y };
      if (drag.current) drag.current.moved = true;
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const p = pointers.current.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse") el.style.cursor = hitAt(e.clientX, e.clientY) != null ? "pointer" : "";
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    const pc = pinch.current;
    if (pc && pointers.current.size >= 2) {
      const t = twoFingers();
      markManual();
      place(pinchZoom(pc.zoom, pc.dist, t.dist), pc.x, pc.y, t.mx, t.my);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && isDrag(dx, dy)) {
      d.moved = true;
      markManual();
      el.style.cursor = "grabbing";
    }
    if (d.moved) {
      el.scrollLeft = clampScroll(d.sl - dx, el.scrollWidth, el.clientWidth);
      el.scrollTop = clampScroll(d.st - dy, el.scrollHeight, el.clientHeight);
    }
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const d = drag.current;
    if (e.type === "pointerup" && d && !d.moved && pointers.current.size === 0) {
      const id = hitAt(e.clientX, e.clientY);
      if (id != null) onPick(id);
    }
    if (pointers.current.size < 2) pinch.current = null;
    const rest = [...pointers.current.values()][0];
    if (rest) startDrag(rest.x, rest.y, true);
    else {
      drag.current = null;
      e.currentTarget.style.cursor = "";
    }
  };

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
    <div className="relative h-full min-h-0 overflow-hidden rounded-md border bg-muted">
      <div
        ref={scrollRef}
        className="relative size-full cursor-grab touch-none overflow-auto select-none [scrollbar-gutter:stable]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={(e) => { const l = local(e.clientX, e.clientY); zoomAt(2, l.x, l.y); }}
      >
        {loading && <Skeleton className="absolute inset-0 rounded-none" />}
        <div ref={stackRef} className="relative" style={{ width: w, height: h }}>
          <canvas ref={baseRef} className="absolute inset-0 size-full" />
          <canvas ref={overRef} className="absolute inset-0 size-full" role="img" aria-label="맵 그림" />
        </div>
      </div>
      {/* 확대·축소·맞춤·내 위치로: 그림 오른쪽 아래 작은 묶음 */}
      <div role="group" aria-label="맵 보기" className="absolute right-4 bottom-4 flex flex-col gap-1">
        <Button variant="outline" size="icon-sm" className="bg-background shadow-sm" aria-label="확대" onClick={() => zoomBy(1.25)}><Plus /></Button>
        <Button variant="outline" size="icon-sm" className="bg-background shadow-sm" aria-label="축소" onClick={() => zoomBy(1 / 1.25)}><Minus /></Button>
        <Button variant="outline" size="icon-sm" className="bg-background shadow-sm" aria-label="맞춤" onClick={fit}><Maximize /></Button>
        <Button variant="outline" size="icon-sm" className="bg-background shadow-sm" aria-label="내 위치로" onClick={toPlayer}><Crosshair /></Button>
      </div>
    </div>
  );
}
