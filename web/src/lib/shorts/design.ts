// What a shorts frame is made of, as settings the editor changes: which pieces show, how each looks and
// where it sits. Pure (no DOM) so node tests can load it; layout.ts turns a design into pixels.

export const SHORTS = { width: 1080, height: 1920 };

/** the pieces that can be picked and moved in the editor */
export type ElementId = "song" | "achievement" | "marks" | "profile";
/** "compact": jacket, difficulty, title, level. "full": the mai-log Figma card, with the result in a bottom row */
export type SongStyle = "compact" | "full";
/** rank and FC / sync marks as our lettering or as maimai DX NET's images */
export type MarkStyle = "text" | "image";
/** dan and class on the profile card: maimai DX NET's images or the Figma badges */
export type BadgeStyle = "image" | "figma";
export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShortsDesign {
  /** which part of the footage shows (0 = top, 1 = bottom) and how far it is zoomed in (1 = just covers) */
  footage: { align: number; zoom: number };
  /** blue panels behind the cards, as in the mai-log layout; the footage shows between them */
  panels: boolean;
  /** darkness of the gradient behind the result on the footage, 0 (none) to 1 */
  scrim: number;
  song: { show: boolean; style: SongStyle; y: number };
  /** [pos] is the top-left corner; null follows the cards */
  achievement: { show: boolean; scale: number; pos: Point | null };
  /** [pos] is the top-right corner; null follows the cards. [row] puts the pieces side by side */
  marks: { show: boolean; style: MarkStyle; row: boolean; scale: number; pos: Point | null };
  profile: { show: boolean; badges: BadgeStyle; y: number };
}

/** card positions of Frame 30 in the mai-log Figma file */
export const SONG_Y = { alone: 110, legacy: 68.8 };
export const PROFILE_Y = 1417;
export const SCALE = { min: 0.5, max: 2 };

export const DEFAULT_DESIGN: ShortsDesign = {
  footage: { align: 0.55, zoom: 1 },
  panels: false,
  scrim: 0.5,
  song: { show: true, style: "compact", y: SONG_Y.alone },
  achievement: { show: true, scale: 1, pos: null },
  marks: { show: true, style: "image", row: false, scale: 1, pos: null },
  profile: { show: false, badges: "image", y: PROFILE_Y },
};

export type PresetId = "card" | "legacy" | "figma" | "bare";

/** starting points: which pieces show and where. Looks (lettering or images, sizes, gradient) are kept. */
export const PRESETS: { id: PresetId; label: string }[] = [
  { id: "card", label: "곡 카드만" },
  { id: "legacy", label: "레거시" },
  { id: "figma", label: "레거시 (원본 카드)" },
  { id: "bare", label: "카드 없이" },
];

export function applyPreset(d: ShortsDesign, id: PresetId): ShortsDesign {
  const onFootage = id !== "figma";
  return {
    ...d,
    panels: id === "legacy" || id === "figma",
    song: { show: id !== "bare", style: id === "figma" ? "full" : "compact", y: id === "card" ? SONG_Y.alone : SONG_Y.legacy },
    // the full card carries the result itself
    achievement: { ...d.achievement, show: onFootage, pos: null },
    marks: { ...d.marks, show: onFootage, pos: null },
    profile: { ...d.profile, show: id !== "card", y: PROFILE_Y },
  };
}

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function point(v: unknown): Point | null {
  const p = obj(v);
  if (typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { x: num(p.x, 0, SHORTS.width, 0), y: num(p.y, 0, SHORTS.height, 0) };
}

/**
 * A design read back from storage: anything missing or odd becomes the default. Also takes what the first
 * version stored ({ mode, background, songCard }).
 */
export function cleanDesign(input: unknown): ShortsDesign {
  const v = obj(input);
  const D = DEFAULT_DESIGN;
  if (typeof v.mode === "string") {
    if (v.mode !== "legacy") return applyPreset(D, "card");
    const legacy = applyPreset(D, v.songCard === false ? "bare" : "legacy");
    return { ...legacy, panels: v.background !== false };
  }
  const [footage, song, achievement, marks, profile] = [v.footage, v.song, v.achievement, v.marks, v.profile].map(obj);
  return {
    footage: { align: num(footage.align, 0, 1, D.footage.align), zoom: num(footage.zoom, 1, 2, D.footage.zoom) },
    panels: bool(v.panels, D.panels),
    scrim: num(v.scrim, 0, 1, D.scrim),
    song: { show: bool(song.show, D.song.show), style: song.style === "full" ? "full" : "compact", y: num(song.y, 0, SHORTS.height, D.song.y) },
    achievement: {
      show: bool(achievement.show, D.achievement.show),
      scale: num(achievement.scale, SCALE.min, SCALE.max, 1),
      pos: point(achievement.pos),
    },
    marks: {
      show: bool(marks.show, D.marks.show),
      style: marks.style === "text" ? "text" : "image",
      row: bool(marks.row, D.marks.row),
      scale: num(marks.scale, SCALE.min, SCALE.max, 1),
      pos: point(marks.pos),
    },
    profile: { show: bool(profile.show, D.profile.show), badges: profile.badges === "figma" ? "figma" : "image", y: num(profile.y, 0, SHORTS.height, D.profile.y) },
  };
}

/** a card as the frame sees it: its box, the hard shadow below and the panel margin above and below it */
export interface CardBox {
  y: number;
  h: number;
  shadow: number;
  above: number;
  below: number;
}

export interface Geometry {
  /** bottom edge of the top panel / top edge of the bottom panel, when there is one */
  top: number | null;
  bottom: number | null;
  /** the footage covers this box */
  footage: Rect;
  /** where the result goes when it follows the cards: under the cards in the upper half, else below the Shorts icons */
  statsTop: number;
  /** where a gradient behind the result may start so that its hard edge is hidden */
  scrimFrom: number;
}

const FULL: Rect = { x: 0, y: 0, w: SHORTS.width, h: SHORTS.height };
/** space between a card or panel and the result on the footage */
const STATS_GAP = 33;
/** below the icons the Shorts player shows at the top */
const TOP_SAFE = 130;
/** the footage is tucked this far under the top and bottom panels, as in the Figma frame */
const TUCK = { top: 20, bottom: 16 };

/**
 * Panels and footage window for the cards that show. A card in the upper half hangs from the top of the
 * frame, one in the lower half stands on the bottom; with [panels] each gets a panel running to that edge.
 */
export function frameGeometry(panels: boolean, cards: CardBox[]): Geometry {
  let top: number | null = null;
  let bottom: number | null = null;
  let upperEnd: number | null = null;
  let upperMid = 0;
  for (const c of cards) {
    if (c.y + c.h / 2 < SHORTS.height / 2) {
      const end = c.y + c.h + c.shadow;
      if (upperEnd === null || end > upperEnd) {
        upperEnd = end;
        upperMid = c.y + c.h / 2;
      }
      if (panels) top = Math.max(top ?? 0, c.y + c.h + c.below);
    } else if (panels) bottom = Math.min(bottom ?? SHORTS.height, c.y - c.above);
  }
  const y = top === null ? 0 : top - TUCK.top;
  const end = bottom === null ? SHORTS.height : bottom + TUCK.bottom;
  // cards dragged so close that nothing is left between the panels: no panels then
  if (end - y < 320) return { ...frameGeometry(false, cards), top: null, bottom: null };
  return {
    top,
    bottom,
    footage: top === null && bottom === null ? FULL : { x: 0, y, w: SHORTS.width, h: end - y },
    statsTop: top !== null ? top + STATS_GAP : upperEnd !== null ? upperEnd + STATS_GAP : TOP_SAFE,
    scrimFrom: top !== null ? y : upperEnd !== null ? upperMid : 0,
  };
}

// ---- snapping while a piece is dragged ----

/** the result keeps this far from the sides of the frame */
export const SIDE_MARGIN = 44;

/** a line across the frame that the dragged piece is lined up with */
export interface Guide {
  axis: "x" | "y";
  at: number;
}

export interface SnapOptions {
  /** how close (frame pixels) a line pulls the piece in */
  threshold: number;
  /** false for pieces that only move up and down */
  x?: boolean;
  /** more lines to stick to, besides the frame's centre and margins and the other pieces */
  extraX?: number[];
  extraY?: number[];
}

const lines = (start: number, size: number) => [start, start + size / 2, start + size];

/**
 * Where a dragged [box] goes: its edges and centre stick to the centre of the frame, the side margins and the
 * edges and centres of the [others]. Returns the top-left corner and the lines it now sits on.
 */
export function snapBox(box: Rect, others: Rect[], o: SnapOptions): { x: number; y: number; guides: Guide[] } {
  const pull = (own: number[], targets: number[]) => {
    let best = 0;
    let found = false;
    for (const t of targets)
      for (const l of own) {
        const d = t - l;
        if (Math.abs(d) < o.threshold && (!found || Math.abs(d) < Math.abs(best))) {
          best = d;
          found = true;
        }
      }
    return best;
  };
  const tx = o.x === false ? [] : [SHORTS.width / 2, SIDE_MARGIN, SHORTS.width - SIDE_MARGIN, ...others.flatMap((r) => lines(r.x, r.w)), ...(o.extraX ?? [])];
  const ty = [SHORTS.height / 2, ...others.flatMap((r) => lines(r.y, r.h)), ...(o.extraY ?? [])];
  const x = box.x + pull(lines(box.x, box.w), tx);
  const y = box.y + pull(lines(box.y, box.h), ty);
  const on = (own: number[], targets: number[], axis: "x" | "y"): Guide[] =>
    [...new Set(targets)].filter((t) => own.some((l) => Math.abs(l - t) < 0.5)).map((at) => ({ axis, at }));
  return { x, y, guides: [...on(lines(x, box.w), tx, "x"), ...on(lines(y, box.h), ty, "y")] };
}

// ---- designs saved under a name ----

export interface SavedDesign {
  name: string;
  design: ShortsDesign;
}
export const SAVED_MAX = 20;
export const SAVED_NAME_MAX = 24;

/** saved designs read back from storage: odd entries are dropped, designs cleaned, names kept unique */
export function cleanSaved(input: unknown): SavedDesign[] {
  if (!Array.isArray(input)) return [];
  const out: SavedDesign[] = [];
  for (const v of input) {
    const name = typeof obj(v).name === "string" ? (obj(v).name as string).trim().slice(0, SAVED_NAME_MAX) : "";
    if (!name || out.some((s) => s.name === name)) continue;
    out.push({ name, design: cleanDesign(obj(v).design) });
  }
  return out.slice(-SAVED_MAX);
}

/** [design] saved as [name]: replaces one of the same name, else goes last (the oldest go when there are too many) */
export function withSaved(list: SavedDesign[], name: string, design: ShortsDesign): SavedDesign[] {
  const n = name.trim().slice(0, SAVED_NAME_MAX);
  if (!n) return list;
  const at = list.findIndex((s) => s.name === n);
  const next = at >= 0 ? list.map((s, i) => (i === at ? { name: n, design } : s)) : [...list, { name: n, design }];
  return next.slice(-SAVED_MAX);
}
