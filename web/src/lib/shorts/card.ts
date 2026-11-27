// The song card drawn over a shorts video. Layout and numbers come from the mai-log card (Figma, 1080×1920 frame).
// "full" is that card as it is: jacket, difficulty, ST/DX, title, level and a bottom row with the achievement,
// rank and marks. "compact" leaves the bottom row out, for when the result is drawn on the footage (stats.ts).
import { achievementText, difficultyColor, difficultyLabel } from "../maimaiLabels.ts";
import type { Play } from "../songs.ts";
import type { MarkStyle, SongStyle } from "./design.ts";
import { CAP, INK, WHITE, canvas, fitText, font, mix, outlined, outlinedWidth, roundRect, type Ctx } from "./draw.ts";
import type { CardImageKey } from "./images.ts";
import { markList } from "./stats.ts";

const PAD = 20.8;
/** the jacket is a square as tall as the rows beside it: difficulty (50) + gap + title bar (78), plus the result row in the full card */
const JACKET: Record<SongStyle, number> = { compact: 50 + 15.6 + 78, full: 213.8 };
/** card box; the bitmap is a little taller for the hard shadow */
export const CARD = {
  x: 16,
  width: 1048,
  height: { compact: JACKET.compact + PAD * 2, full: JACKET.full + PAD * 2 } as Record<SongStyle, number>,
  shadow: 5.2,
};

export type CardImages = Partial<Record<CardImageKey, ImageBitmap>>;

// Colours of the video overlay itself (not the site UI, so not --crl-* tokens)
const TITLE_BAR = "#4d4d4d";
const MASTER = { edge: "#934ada", bg: "#cb9ff4" };

/** draws the card with its top-left corner at 0,0. [marks] is how the full card shows the rank and marks. */
export function drawSongCard(ctx: Ctx, play: Play, images: CardImages = {}, style: SongStyle = "compact", marks: MarkStyle = "text") {
  const d = play.details ?? {};
  const INNER = JACKET[style];
  const height = CARD.height[style];
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
  roundRect(ctx, 0, CARD.shadow, CARD.width, height, 10.4);
  ctx.fill();
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, CARD.width, height, 10.4);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.6;
  roundRect(ctx, 1.3, 1.3, CARD.width - 2.6, height - 2.6, 9.1);
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

  if (style === "full") {
    // achievement on the left; rank, FC and sync marks on the right (117 px boxes in the Figma card)
    const rowCy = PAD + 159.2 + 27.3;
    const ach = achievementText(play.achievement);
    let achW = 0;
    if (ach) {
      achW = 250;
      ctx.fillStyle = WHITE;
      roundRect(ctx, detailX, rowCy - 27.5, achW, 55, 15.6);
      ctx.fill();
      ctx.font = font(400, 31.2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = INK;
      ctx.fillText(ach, detailX + 15.6, rowCy + (31.2 * CAP) / 2);
    }
    const pieces = markList(play).map((m) => {
      const img = marks === "image" ? images[m.key] : undefined;
      if (img) {
        const w = (img.width / img.height) * 50;
        return { w, draw: (x: number, k: number) => ctx.drawImage(img, x, rowCy - 25 * k, w * k, 50 * k) };
      }
      const w = Math.max(117, outlinedWidth(ctx, m.text, 41.6, 4));
      return {
        w,
        draw: (x: number, k: number) => {
          outlined(ctx, m.text, x + (w * k) / 2, rowCy, { size: 41.6 * k, ...m.look, width: 4 * k, shadow: shade, drop: 3.9 * k, align: "center" });
        },
      };
    });
    const gap = 8;
    const total = pieces.reduce((a, p) => a + p.w, 0) + gap * Math.max(0, pieces.length - 1);
    const room = detailW - (achW ? achW + 12 : 0);
    const k = total > room ? room / total : 1;
    let x = detailX + detailW - total * k;
    for (const p of pieces) {
      p.draw(x, k);
      x += (p.w + gap) * k;
    }
  }

  // level behind a dashed divider
  const dashes = style === "full" ? 5 : 4;
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
export function renderCard(play: Play, images: CardImages = {}, style: SongStyle = "compact", marks: MarkStyle = "text"): HTMLCanvasElement {
  const c = canvas(CARD.width, CARD.height[style] + CARD.shadow);
  drawSongCard(c.getContext("2d")!, play, images, style, marks);
  return c;
}
