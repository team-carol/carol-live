// The result written on the footage itself: achievement at the top-left, rank and FC / sync marks at the
// top-right, all at one size. Lettering as in the mai-log shorts (pastel rainbow for SSS and AP, green FC).
import { achievementText, markOf, rankLabel } from "../maimaiLabels.ts";
import type { Play } from "../songs.ts";
import { CAP, outlined, type Ctx, type Paint, type Stops } from "./draw.ts";

const SSS: Stops = [
  [0.017, "#b6daff"],
  [0.296, "#f4ff78"],
  [0.538, "#ffc0c0"],
  [0.766, "#c0ff89"],
];
type Look = { fill: Paint; stroke: string };
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
const rankLook = (label: string | null) => (label && RANK[label.replace("+", "")]) || RANK.other;
const markLook = (label: string) => MARK[label.replace("+", "")] ?? MARK.sync;

export const STATS = { margin: 44, size: 78, achievement: 78, gap: 20, stroke: 6, drop: 6 };

/** rank and marks, top to bottom. An ALL PERFECT says the rank already, as in the old shorts. */
function rightSide(play: Play): { text: string; look: Look }[] {
  const d = play.details ?? {};
  const rank = rankLabel(d.rank);
  const fc = markOf(d.fc);
  const sync = markOf(d.sync);
  const out: { text: string; look: Look }[] = [];
  if (rank && !(fc && fc.label.startsWith("AP"))) out.push({ text: rank, look: rankLook(rank) });
  if (fc) out.push({ text: fc.label, look: markLook(fc.label) });
  if (sync) out.push({ text: sync.label, look: markLook(sync.label) });
  return out;
}

/**
 * A soft dark band behind the lettering so it reads on bright footage: strongest at [from], gone a little below
 * the last line. Draw it before anything that should sit on top of it.
 */
export function drawStatsScrim(ctx: Ctx, play: Play, from: number, top: number) {
  const lines = Math.max(1, rightSide(play).length);
  const end = top + lines * (STATS.size * CAP + STATS.gap) + 110;
  const g = ctx.createLinearGradient(0, from, 0, end);
  g.addColorStop(0, "rgba(0, 0, 0, 0.5)");
  g.addColorStop(0.55, "rgba(0, 0, 0, 0.28)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, from, 1080, end - from);
}

/** [top] is where the upper edge of the lettering goes; the footage should be free below it */
export function drawStats(ctx: Ctx, play: Play, top: number, left = STATS.margin, right = 1080 - STATS.margin) {
  const d = play.details ?? {};
  const line = STATS.size * CAP;
  const rank = rankLabel(d.rank);
  const letters = { size: STATS.size, width: STATS.stroke, drop: STATS.drop, align: "right" as const };
  rightSide(play).forEach((p, i) => outlined(ctx, p.text, right, top + line / 2 + i * (line + STATS.gap), { ...letters, ...p.look }));

  const ach = achievementText(play.achievement);
  if (ach) {
    outlined(ctx, ach, left, top + line / 2, {
      size: STATS.achievement,
      ...rankLook(rank),
      width: STATS.stroke,
      drop: STATS.drop,
    });
  }
}
