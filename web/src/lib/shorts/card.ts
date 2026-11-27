// The song card drawn over a shorts video: jacket, difficulty, ST/DX, title and level.
// It is the mai-log Figma card without its bottom row; the achievement, rank and marks are drawn
// on the footage instead (stats.ts).
import { difficultyColor, difficultyLabel } from "../maimaiLabels.ts";
import type { Play } from "../songs.ts";
import { CAP, INK, WHITE, canvas, fitText, font, mix, outlined, outlinedWidth, roundRect, type Ctx } from "./draw.ts";
import type { CardImageKey } from "./images.ts";

const PAD = 20.8;
/** difficulty row (50) + gap + title bar (78): the jacket is a square of this height */
const INNER = 50 + 15.6 + 78;
/** card box; the bitmap is a little taller for the hard shadow */
export const CARD = { x: 16, width: 1048, height: INNER + PAD * 2, shadow: 5.2, defaultY: 110 };

export type CardImages = Partial<Record<CardImageKey, ImageBitmap>>;

// Colours of the video overlay itself (not the site UI, so not --crl-* tokens)
const TITLE_BAR = "#4d4d4d";
const MASTER = { edge: "#934ada", bg: "#cb9ff4" };

/** draws the card with its top-left corner at 0,0 */
export function drawSongCard(ctx: Ctx, play: Play, images: CardImages = {}) {
  const d = play.details ?? {};
  const token = difficultyColor(play.difficulty);
  // MASTER keeps the exact Figma pair; the other difficulties get the same tint of their game colour
  const edge = play.difficulty === "master" || !token ? MASTER.edge : token;
  const bg = play.difficulty === "master" || !token ? MASTER.bg : mix(token, WHITE, 0.55);
  const shade = mix(bg, "#000000", 0.6);
  const detailX = PAD + INNER + PAD;
  const levelW = 195;
  const detailW = CARD.width - detailX - 5.2 - PAD - levelW - PAD;
  const levelX = detailX + detailW + 5.2 + PAD;

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
  roundRect(ctx, PAD, PAD, INNER, INNER, 10.4);
  ctx.clip();
  if (images.jacket) ctx.drawImage(images.jacket, PAD, PAD, INNER, INNER);
  else {
    ctx.fillStyle = mix(edge, WHITE, 0.4);
    ctx.fillRect(PAD, PAD, INNER, INNER);
  }
  ctx.restore();

  // difficulty + ST/DX
  const label = difficultyLabel(play.difficulty);
  if (label) outlined(ctx, label, detailX, PAD + 25, { size: 41.6, fill: WHITE, stroke: edge, width: 5.2, shadow: shade, drop: 3.9 });
  const kindW = 174.2;
  const kindH = 49.33;
  if (images.kind) ctx.drawImage(images.kind, detailX + detailW - kindW, PAD + 0.33, kindW, kindH);
  else if (d.kind) {
    ctx.fillStyle = WHITE;
    roundRect(ctx, detailX + detailW - 96, PAD + 3, 96, 44, 22);
    ctx.fill();
    ctx.font = font(800, 28);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = INK;
    ctx.fillText(d.kind === "dx" ? "DX" : "ST", detailX + detailW - 48, PAD + 25 + (28 * CAP) / 2);
  }

  // title
  const titleY = PAD + 65.6;
  ctx.fillStyle = TITLE_BAR;
  roundRect(ctx, detailX, titleY, detailW, 78, 15.6);
  ctx.fill();
  const title = fitText(ctx, play.title, 400, 36.4, 26, detailW - PAD * 2);
  ctx.font = font(400, title.size);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = WHITE;
  ctx.fillText(title.text, detailX + PAD, titleY + 39 + 1);

  // level behind a dashed divider
  const dashes = 4;
  const dashH = (INNER - 14 * (dashes - 1)) / dashes;
  ctx.fillStyle = "rgba(43, 43, 43, 0.4)";
  for (let i = 0; i < dashes; i++) {
    roundRect(ctx, levelX, PAD + i * (dashH + 14), 10.4, dashH, 5.2);
    ctx.fill();
  }
  if (d.level) {
    const room = levelW - 10.4 - 26;
    const size = Math.min(72.8, (72.8 * (room - 12)) / Math.max(1, outlinedWidth(ctx, d.level, 72.8, 6.2)));
    outlined(ctx, d.level, levelX + 10.4 + 26 + room / 2, PAD + INNER / 2, {
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

/** the card as its own bitmap */
export function renderCard(play: Play, images: CardImages = {}): HTMLCanvasElement {
  const c = canvas(CARD.width, CARD.height + CARD.shadow);
  drawSongCard(c.getContext("2d")!, play, images);
  return c;
}
