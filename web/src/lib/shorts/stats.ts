// The result on the footage itself: the achievement, and the rank with the FC / sync marks. Each is measured
// first and drawn where the layout puts it. Rank and marks are maimai DX NET's own images or our lettering
// (pastel rainbow for SSS and AP, green FC, as in the mai-log shorts).
import { achievementText, markOf, rankLabel } from "../maimaiLabels.ts";
import type { Play } from "../songs.ts";
import { SIDE_MARGIN, type MarkStyle } from "./design.ts";
import { CAP, font, outlined, type Ctx, type Paint, type Stops } from "./draw.ts";

const SSS: Stops = [
  [0.017, "#b6daff"],
  [0.296, "#f4ff78"],
  [0.538, "#ffc0c0"],
  [0.766, "#c0ff89"],
];
export type Look = { fill: Paint; stroke: string };
const RANK: Record<string, Look> = {
  SSS: { fill: SSS, stroke: "#af624f" },
  SS: { fill: [[0.02, "#fff9b8"], [0.55, "#ffd95a"], [0.98, "#ffeaa0"]], stroke: "#a8741a" },
  S: { fill: [[0.02, "#ffe2bd"], [0.55, "#ffa868"], [0.98, "#ffd0a6"]], stroke: "#b0532a" },
  other: { fill: [[0.02, "#d8ebff"], [0.55, "#86bcff"], [0.98, "#c4dfff"]], stroke: "#2f5fa8" },
};
const MARK: Record<string, Look> = {
  AP: RANK.SSS,
  FC: { fill: "#81de77", stroke: "#3e8e43" },
  sync: { fill: "#bddfff", stroke: "#4a6fa5" },
};
export const rankLook = (label: string | null) => (label && RANK[label.replace("+", "")]) || RANK.other;
export const markLook = (label: string) => MARK[label.replace("+", "")] ?? MARK.sync;

/**
 * Sizes at scale 1. The site's images are flat (rank 200×89, marks 108×56), so they are drawn taller than
 * the lettering's capitals (78 px type = 56 px capitals) to carry the same weight.
 */
export const STATS = { margin: SIDE_MARGIN, size: 78, gap: 20, stroke: 6, drop: 6, rankImage: 104, markImage: 88, imageGap: 10 };

export type MarkKey = "rank" | "fc" | "sync";
export type MarkImages = Partial<Record<MarkKey, ImageBitmap>>;

/** rank and marks, in the order they are shown. An ALL PERFECT says the rank already, as in the old shorts. */
export function markList(play: Play): { key: MarkKey; text: string; look: Look }[] {
  const d = play.details ?? {};
  const rank = rankLabel(d.rank);
  const fc = markOf(d.fc);
  const sync = markOf(d.sync);
  const out: { key: MarkKey; text: string; look: Look }[] = [];
  if (rank && !(fc && fc.label.startsWith("AP"))) out.push({ key: "rank", text: rank, look: rankLook(rank) });
  if (fc) out.push({ key: "fc", text: fc.label, look: markLook(fc.label) });
  if (sync) out.push({ key: "sync", text: sync.label, look: markLook(sync.label) });
  return out;
}

/** something measured, ready to be drawn with its top-left (achievement) or top-right (marks) corner at a point */
export interface Block {
  w: number;
  h: number;
  /** height of the first line, to line the achievement up with it */
  first: number;
  draw: (ctx: Ctx, x: number, y: number) => void;
}

export interface MarksOptions {
  style: MarkStyle;
  row: boolean;
  scale: number;
}

/** rank and marks stacked (or side by side) and right-aligned; draw() takes the top-right corner */
export function marksBlock(ctx: Ctx, play: Play, images: MarkImages, o: MarksOptions): Block | null {
  const pieces = markList(play).map((p) => {
    const img = o.style === "image" ? images[p.key] : undefined;
    if (img) {
      const h = (p.key === "rank" ? STATS.rankImage : STATS.markImage) * o.scale;
      const w = (img.width / img.height) * h;
      return {
        w,
        h,
        draw: (c: Ctx, x: number, y: number) => {
          c.save();
          c.shadowColor = "rgba(0, 0, 0, 0.5)";
          c.shadowBlur = 10 * o.scale;
          c.shadowOffsetY = 3 * o.scale;
          c.imageSmoothingQuality = "high";
          c.drawImage(img, x, y, w, h);
          c.restore();
        },
      };
    }
    // an image that did not arrive falls back to the lettering
    const size = STATS.size * o.scale;
    ctx.font = font(800, size);
    const w = ctx.measureText(p.text).width;
    const h = size * CAP;
    return {
      w,
      h,
      draw: (c: Ctx, x: number, y: number) => {
        outlined(c, p.text, x, y + h / 2, { size, ...p.look, width: STATS.stroke * o.scale, drop: STATS.drop * o.scale });
      },
    };
  });
  if (!pieces.length) return null;
  const images_ = o.style === "image";
  const gap = (o.row ? 16 : images_ ? STATS.imageGap : STATS.gap) * o.scale;
  const sum = (k: "w" | "h") => pieces.reduce((a, p) => a + p[k], 0) + gap * (pieces.length - 1);
  const max = (k: "w" | "h") => Math.max(...pieces.map((p) => p[k]));
  const w = o.row ? sum("w") : max("w");
  const h = o.row ? max("h") : sum("h");
  return {
    w,
    h,
    first: o.row ? h : pieces[0].h,
    draw: (c, right, top) => {
      let at = o.row ? right - w : top;
      for (const p of pieces) {
        if (o.row) p.draw(c, at, top + (h - p.h) / 2);
        else p.draw(c, right - p.w, at);
        at += (o.row ? p.w : p.h) + gap;
      }
    },
  };
}

/** the achievement in the colours of its rank; draw() takes the top-left corner */
export function achievementBlock(ctx: Ctx, play: Play, scale: number): Block | null {
  const text = achievementText(play.achievement);
  if (!text) return null;
  const size = STATS.size * scale;
  ctx.font = font(800, size);
  const w = ctx.measureText(text).width;
  const h = size * CAP;
  const look = rankLook(rankLabel(play.details?.rank));
  return {
    w,
    h,
    first: h,
    draw: (c, x, y) => {
      outlined(c, text, x, y + h / 2, { size, ...look, width: STATS.stroke * scale, drop: STATS.drop * scale });
    },
  };
}

/**
 * A soft dark gradient behind the result so it reads on bright footage. "top" is darkest at [from] and gone at
 * [to], "bottom" the other way round, "band" fades in and out for a result in the middle of the frame.
 * Draw it before anything that should sit on top of it.
 */
export function drawScrim(ctx: Ctx, strength: number, from: number, to: number, shape: "top" | "bottom" | "band") {
  if (strength <= 0 || to <= from) return;
  const black = (a: number) => `rgba(0, 0, 0, ${(a * strength).toFixed(3)})`;
  const g = ctx.createLinearGradient(0, from, 0, to);
  const stops: [number, number][] =
    shape === "top"
      ? [[0, 1], [0.55, 0.56], [1, 0]]
      : shape === "bottom"
        ? [[0, 0], [0.45, 0.56], [1, 1]]
        : [[0, 0], [0.35, 0.8], [0.65, 0.8], [1, 0]];
  for (const [at, a] of stops) g.addColorStop(at, black(a));
  ctx.fillStyle = g;
  ctx.fillRect(0, from, 1080, to - from);
}
