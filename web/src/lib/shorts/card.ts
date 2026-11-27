// The song card drawn over a shorts video. Layout and numbers come from the mai-log card (Figma, 1080×1920 frame).
import { maimaiClear } from "@team-carol/design-system/game";
import { achievementText, difficultyColor, difficultyLabel, markOf, rankColor, rankLabel } from "../maimaiLabels.ts";
import type { Play } from "../songs.ts";
import { CAP, INK, WHITE, canvas, fitText, font, mix, outlined, outlinedWidth, roundRect, type Ctx, type Paint, type Stops } from "./draw.ts";
import type { CardImageKey } from "./images.ts";

/** card box; the bitmap is a little taller for the hard shadow */
export const CARD = { x: 16, width: 1048, height: 255.4, shadow: 5.2, defaultY: 110 };

export type CardImages = Partial<Record<CardImageKey, ImageBitmap>>;
/**
 * "card": rank and marks are maimai DX NET's images, the achievement is bold.
 * "legacy": exactly the Figma card, with rank and marks as outlined letters.
 */
export type CardStyle = "card" | "legacy";

// Colours of the video overlay itself (not the site UI, so not --crl-* tokens)
const TITLE_BAR = "#4d4d4d";
const MASTER = { edge: "#934ada", bg: "#cb9ff4" };

/** letter fills of the Figma card: SSS+ is the pastel rainbow, FC green, sync marks light blue */
const SSS: Stops = [
  [0.017, "#b6daff"],
  [0.296, "#f4ff78"],
  [0.538, "#ffc0c0"],
  [0.766, "#c0ff89"],
];
const LETTER_RANK: Record<string, { fill: Paint; stroke: string }> = {
  SSS: { fill: SSS, stroke: "#af624f" },
  SS: { fill: [[0.02, "#fff9b8"], [0.55, "#ffd95a"], [0.98, "#ffeaa0"]], stroke: "#a8741a" },
  S: { fill: [[0.02, "#ffe2bd"], [0.55, "#ffa868"], [0.98, "#ffd0a6"]], stroke: "#b0532a" },
  other: { fill: [[0.02, "#d8ebff"], [0.55, "#86bcff"], [0.98, "#c4dfff"]], stroke: "#2f5fa8" },
};
const LETTER_MARK: Record<string, { fill: Paint; stroke: string }> = {
  AP: { fill: [[0.02, "#fff9b8"], [0.55, "#ffd95a"], [0.98, "#ffeaa0"]], stroke: "#a8741a" },
  FC: { fill: "#81de77", stroke: "#3e8e43" },
  sync: { fill: "#bddfff", stroke: "#4a6fa5" },
};

function legacyLetters(label: string, kind: "rank" | "mark"): { fill: Paint; stroke: string } {
  if (kind === "rank") return LETTER_RANK[label.replace("+", "")] ?? LETTER_RANK.other;
  return LETTER_MARK[label.replace("+", "")] ?? LETTER_MARK.sync;
}

/** draws the card with its top-left corner at 0,0 */
export function drawSongCard(ctx: Ctx, play: Play, images: CardImages = {}, style: CardStyle = "card") {
  const d = play.details ?? {};
  const token = difficultyColor(play.difficulty);
  // MASTER keeps the exact Figma pair; the other difficulties get the same tint of their game colour
  const edge = play.difficulty === "master" || !token ? MASTER.edge : token;
  const bg = play.difficulty === "master" || !token ? MASTER.bg : mix(token, WHITE, 0.55);
  const shade = mix(bg, "#000000", 0.6);
  const pad = 20.8;
  const jacket = 213.8;
  const detailX = pad + jacket + pad;
  const detailW = 550.8;
  const levelX = detailX + detailW + 5.2 + pad;

  // card: hard shadow, fill, border inside
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  roundRect(ctx, 0, CARD.shadow, CARD.width, CARD.height, 10.4);
  ctx.fill();
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, CARD.width, CARD.height, 10.4);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.6;
  roundRect(ctx, 1.3, 1.3, CARD.width - 2.6, CARD.height - 2.6, 9.1);
  ctx.stroke();

  // jacket
  ctx.save();
  roundRect(ctx, pad, pad, jacket, jacket, 10.4);
  ctx.clip();
  if (images.jacket) ctx.drawImage(images.jacket, pad, pad, jacket, jacket);
  else {
    ctx.fillStyle = mix(edge, WHITE, 0.4);
    ctx.fillRect(pad, pad, jacket, jacket);
  }
  ctx.restore();

  // difficulty + ST/DX
  const label = difficultyLabel(play.difficulty);
  if (label) outlined(ctx, label, detailX, pad + 25, { size: 41.6, fill: WHITE, stroke: edge, width: 5.2, shadow: shade, drop: 3.9 });
  const kindW = 174.2;
  const kindH = 49.33;
  if (images.kind) ctx.drawImage(images.kind, detailX + detailW - kindW, pad + 0.33, kindW, kindH);
  else if (d.kind) {
    ctx.fillStyle = WHITE;
    roundRect(ctx, detailX + detailW - 96, pad + 3, 96, 44, 22);
    ctx.fill();
    ctx.font = font(800, 28);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = INK;
    ctx.fillText(d.kind === "dx" ? "DX" : "ST", detailX + detailW - 48, pad + 25 + (28 * CAP) / 2);
  }

  // title
  const titleY = pad + 65.6;
  ctx.fillStyle = TITLE_BAR;
  roundRect(ctx, detailX, titleY, detailW, 78, 15.6);
  ctx.fill();
  const title = fitText(ctx, play.title, 400, 36.4, 26, detailW - pad * 2);
  ctx.font = font(400, title.size);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = WHITE;
  ctx.fillText(title.text, detailX + pad, titleY + 39 + 1);

  // achievement on the left; rank, FC and sync marks on the right
  const rowCy = pad + 159.2 + 27.3;
  const legacy = style === "legacy";
  const ach = achievementText(play.achievement);
  let achW = 0;
  if (ach) {
    const size = legacy ? 31.2 : 34;
    const padX = legacy ? 15.6 : 18;
    ctx.font = font(legacy ? 400 : 600, size);
    achW = legacy ? 250 : ctx.measureText(ach).width + padX * 2;
    ctx.fillStyle = WHITE;
    roundRect(ctx, detailX, rowCy - 27.5, achW, 55, 15.6);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = INK;
    ctx.fillText(ach, detailX + padX, rowCy + (size * CAP) / 2);
  }
  type Piece = { w: number; draw: (x: number, scale: number) => void };
  const pieces: Piece[] = [];
  const image = (img: ImageBitmap, h: number): Piece => ({
    w: (img.width / img.height) * h,
    draw: (x, s) => ctx.drawImage(img, x, rowCy - (h * s) / 2, (img.width / img.height) * h * s, h * s),
  });
  const lettering = (text: string, look: { fill: Paint; stroke: string }, box?: number): Piece => {
    const w = outlinedWidth(ctx, text, 41.6, 4);
    return {
      w: Math.max(w, box ?? 0),
      draw: (x, s) =>
        outlined(ctx, text, x + (Math.max(w, box ?? 0) * s) / 2, rowCy, { size: 41.6 * s, ...look, width: 4 * s, shadow: shade, drop: 3.9 * s, align: "center" }),
    };
  };
  const tinted = (color: string | undefined) => ({ fill: mix(color ?? maimaiClear.SYNC, WHITE, 0.55), stroke: mix(color ?? maimaiClear.SYNC, "#000000", 0.3) });
  // the Figma card gives the rank and the FC mark a 117 px box each
  const box = legacy ? 117 : undefined;
  const rank = rankLabel(d.rank);
  if (!legacy && images.rank) pieces.push(image(images.rank, 50));
  else if (rank) pieces.push(lettering(rank, legacy ? legacyLetters(rank, "rank") : tinted(rankColor(d.rank)), box));
  for (const k of ["fc", "sync"] as const) {
    const img = images[k];
    const m = markOf(d[k]);
    if (!legacy && img) pieces.push(image(img, 50));
    else if (m) pieces.push(lettering(m.label, legacy ? legacyLetters(m.label, "mark") : tinted(m.color), box));
  }
  const gap = legacy ? 8 : 10;
  const total = pieces.reduce((a, p) => a + p.w, 0) + gap * Math.max(0, pieces.length - 1);
  const room = detailW - (achW ? achW + 12 : 0);
  const scale = total > room ? room / total : 1;
  let x = detailX + detailW - total * scale;
  for (const p of pieces) {
    p.draw(x, scale);
    x += (p.w + gap) * scale;
  }

  // level behind a dashed divider
  const dashH = (jacket - 14 * 4) / 5;
  ctx.fillStyle = "rgba(43, 43, 43, 0.4)";
  for (let i = 0; i < 5; i++) {
    roundRect(ctx, levelX, pad + i * (dashH + 14), 10.4, dashH, 5.2);
    ctx.fill();
  }
  if (d.level) {
    const room2 = 195 - 10.4 - 26;
    const size = Math.min(72.8, (72.8 * (room2 - 12)) / Math.max(1, outlinedWidth(ctx, d.level, 72.8, 6.2)));
    outlined(ctx, d.level, levelX + 10.4 + 26 + room2 / 2, pad + jacket / 2, {
      size,
      fill: WHITE,
      stroke: edge,
      width: (6.2 * size) / 72.8,
      shadow: shade,
      drop: 3.9,
      align: "center",
    });
  }
}

/** the card as its own bitmap, drawn once and stamped on every frame */
export function renderCard(play: Play, images: CardImages = {}, style: CardStyle = "card"): HTMLCanvasElement {
  const c = canvas(CARD.width, CARD.height + CARD.shadow);
  drawSongCard(c.getContext("2d")!, play, images, style);
  return c;
}
