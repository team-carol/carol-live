// The song card drawn over a shorts video. Layout and numbers come from the mai-log card (Figma, 1080×1920 frame).
import { maimaiClear } from "@team-carol/design-system/game";
import { achievementText, difficultyColor, difficultyLabel, markOf, rankColor, rankLabel } from "../maimaiLabels.ts";
import type { Play } from "../songs.ts";
import { cardImageUrls, type CardImageKey } from "./images.ts";

export const SHORTS = { width: 1080, height: 1920 };
/** card box inside the frame; the bitmap is a little taller for the hard shadow */
export const CARD = { x: 16, width: 1048, height: 255.4, shadow: 5.2, defaultY: 110 };
export const CARD_MAX_Y = SHORTS.height - CARD.height - CARD.shadow;

export type CardImages = Partial<Record<CardImageKey, ImageBitmap>>;
type Ctx = CanvasRenderingContext2D;

// Colours of the video overlay itself (not the site UI, so not --crl-* tokens)
const INK = "#2b2b2b";
const TITLE_BAR = "#4d4d4d";
const WHITE = "#ffffff";
const MASTER = "#9333ea";
const FAMILY = '"Pretendard", "Pretendard Variable", "Noto Sans JP", system-ui, sans-serif';
const font = (weight: number, size: number) => `${weight} ${size}px ${FAMILY}`;
/** cap height of Pretendard, to centre capitals and digits on a line */
const CAP = 0.72;

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

interface Outline {
  size: number;
  fill: string;
  stroke: string;
  /** stroke width outside the letters */
  width: number;
  /** colour of the hard shadow below (already mixed with what is behind it) */
  shadow: string;
  drop: number;
  align?: CanvasTextAlign;
}

/** capital letters / digits with an outer stroke and a hard shadow, centred on [cy] */
function outlined(ctx: Ctx, text: string, x: number, cy: number, o: Outline) {
  ctx.font = font(800, o.size);
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = o.width * 2;
  const y = cy + (o.size * CAP) / 2;
  for (const [dy, fill, stroke] of [
    [o.drop, o.shadow, o.shadow],
    [0, o.fill, o.stroke],
  ] as const) {
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y + dy);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y + dy);
  }
}

function outlinedWidth(ctx: Ctx, text: string, size: number, width: number): number {
  ctx.font = font(800, size);
  return ctx.measureText(text).width + width * 2;
}

/** shrinks, then cuts with … so [text] fits [max] */
function fitText(ctx: Ctx, text: string, weight: number, size: number, min: number, max: number): { text: string; size: number } {
  let s = size;
  ctx.font = font(weight, s);
  while (s > min && ctx.measureText(text).width > max) {
    s -= 1;
    ctx.font = font(weight, s);
  }
  let t = text;
  while (t.length > 1 && ctx.measureText(t === text ? t : `${t}…`).width > max) t = t.slice(0, -1);
  return { text: t === text ? t : `${t.trimEnd()}…`, size: s };
}

/** draws the card with its top-left corner at 0,0 */
export function drawSongCard(ctx: Ctx, play: Play, images: CardImages = {}) {
  const d = play.details ?? {};
  const edge = difficultyColor(play.difficulty) ?? MASTER;
  const bg = mix(edge, WHITE, 0.55);
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
  const ach = achievementText(play.achievement);
  let achW = 0;
  if (ach) {
    ctx.font = font(600, 34);
    achW = ctx.measureText(ach).width + 36;
    ctx.fillStyle = WHITE;
    roundRect(ctx, detailX, rowCy - 27.5, achW, 55, 15.6);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = INK;
    ctx.fillText(ach, detailX + 18, rowCy + (34 * CAP) / 2);
  }
  type Piece = { w: number; draw: (x: number, scale: number) => void };
  const pieces: Piece[] = [];
  const image = (img: ImageBitmap, h: number): Piece => ({
    w: (img.width / img.height) * h,
    draw: (x, s) => ctx.drawImage(img, x, rowCy - (h * s) / 2, (img.width / img.height) * h * s, h * s),
  });
  const lettering = (text: string, color: string | undefined): Piece => ({
    w: outlinedWidth(ctx, text, 41.6, 4),
    draw: (x, s) =>
      outlined(ctx, text, x + 4 * s, rowCy, {
        size: 41.6 * s,
        fill: mix(color ?? maimaiClear.SYNC, WHITE, 0.55),
        stroke: mix(color ?? maimaiClear.SYNC, "#000000", 0.3),
        width: 4 * s,
        shadow: shade,
        drop: 3.9 * s,
      }),
  });
  if (images.rank) pieces.push(image(images.rank, 50));
  else if (d.rank) pieces.push(lettering(rankLabel(d.rank) ?? "", rankColor(d.rank)));
  for (const k of ["fc", "sync"] as const) {
    const img = images[k];
    const m = markOf(d[k]);
    if (img) pieces.push(image(img, 50));
    else if (m) pieces.push(lettering(m.label, m.color));
  }
  const gap = 10;
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
    const box = 195 - 10.4 - 26;
    const size = Math.min(72.8, (72.8 * (box - 12)) / Math.max(1, outlinedWidth(ctx, d.level, 72.8, 6.2)));
    outlined(ctx, d.level, levelX + 10.4 + 26 + box / 2, pad + jacket / 2, {
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
export function renderCard(play: Play, images: CardImages = {}): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = CARD.width;
  c.height = Math.ceil(CARD.height + CARD.shadow);
  drawSongCard(c.getContext("2d")!, play, images);
  return c;
}

/** maimai DX NET images through our server; a missing one just falls back to lettering */
export async function loadCardImages(play: Play): Promise<CardImages> {
  const urls = cardImageUrls(play);
  const out: CardImages = {};
  await Promise.all(
    (Object.keys(urls) as CardImageKey[]).map(async (k) => {
      try {
        const res = await fetch(urls[k]!, { credentials: "same-origin" });
        if (res.ok) out[k] = await createImageBitmap(await res.blob());
      } catch {
        // keep the lettering
      }
    }),
  );
  return out;
}

/** canvas text uses fonts only once they are loaded */
export async function loadCardFonts(): Promise<void> {
  await Promise.all([400, 600, 800].map((w) => document.fonts.load(font(w, 40), "가A1")).concat([document.fonts.ready.then(() => [])]));
}
