// The player profile card of the legacy shorts layout: icon, title, name, rating, dan, class, play count.
// Sizes, colours and vectors are taken from the mai-log Figma file (Frame 30 and its Dan / Otomo / RatingSection
// components, which the frame uses at 1.15×). Dan and class are maimai DX NET's own badge images; the Figma
// badges are drawn only when an image is missing. The frame's "★ × N" is left out.
import type { MaimaiProfile } from "../../api.ts";
import { INK, SHADOW, WHITE, canvas, font, paint, plate, roundRect, shadowText, type Ctx, type Paint, type Stops } from "./draw.ts";
import { classOf, danOf, ratingTier, type ClassTier, type RatingTier } from "./images.ts";

/** card box in the 1080×1920 frame; the bitmap is larger for the offset shadow */
export const PROFILE = { x: 51, y: 1417, width: 978, height: 317, shadowX: 4.6, shadowY: 9.2 };

/** the components are drawn at this scale in the frame */
const K = 1.15;

const DAN_PATH =
  "M23.5519 2.46666C24.1717 0.973346 25.6295 0 27.2463 0H162.022C164.874 0 166.81 2.89926 165.717 5.53334L142.474 61.5333C141.855 63.0267 140.397 64 138.78 64H4.00414C1.15221 64 -0.783546 61.1007 0.309698 58.4667L23.5519 2.46666Z";
/** one, two and three diamonds side by side (S, SS, SSS / LEGEND classes) */
const DIAMOND_1 =
  "M28.5146 1.1709C30.0767 -0.391086 32.6098 -0.390939 34.1719 1.1709L61.5146 28.5146C63.0767 30.0767 63.0767 32.6088 61.5146 34.1709L34.1719 61.5146C32.6098 63.0767 30.0767 63.0767 28.5146 61.5146L1.17187 34.1709C-0.389945 32.6088 -0.390054 30.0767 1.17187 28.5146L28.5146 1.1709Z";
const DIAMOND_2 =
  "M45.5146 1.17188C47.0767 -0.390222 49.6098 -0.390222 51.1719 1.17188L78.5146 28.5146C80.0767 30.0767 80.0767 32.6098 78.5146 34.1719L51.1719 61.5146C49.6098 63.0767 47.0767 63.0767 45.5146 61.5146L40.0215 56.0215L34.1719 61.873C32.6098 63.4349 30.0767 63.435 28.5146 61.873L1.17187 34.5293C-0.390111 32.9673 -0.389998 30.4351 1.17187 28.873L28.5146 1.5293C30.0767 -0.0327861 32.6098 -0.032758 34.1719 1.5293L39.6641 7.02148L45.5146 1.17188Z";
const DIAMOND_3 =
  "M62.5146 1.1709C64.0766 -0.390762 66.6089 -0.390692 68.1709 1.1709L95.5146 28.5146C97.0764 30.0767 97.0764 32.6088 95.5146 34.1709L68.1709 61.5146C66.6088 63.0764 64.0767 63.0764 62.5146 61.5146L56.8428 55.8428L51.1709 61.5146C49.6088 63.0764 47.0767 63.0764 45.5146 61.5146L39.8428 55.8428L34.1709 61.5146C32.6088 63.0764 30.0767 63.0764 28.5146 61.5146L1.1709 34.1709C-0.390694 32.6089 -0.390763 30.0766 1.1709 28.5146L28.5146 1.1709C30.0766 -0.390762 32.6089 -0.390692 34.1709 1.1709L39.8428 6.84277L45.5146 1.1709C47.0766 -0.390762 49.6089 -0.390692 51.1709 1.1709L56.8428 6.84277L62.5146 1.1709Z";
/** small star beside the rating (48 px box) */
const STAR_SMALL =
  "M11.0767 2.21993C11.4183 1.39864 12.5817 1.39864 12.9233 2.21993L14.9395 7.06735C15.0835 7.41358 15.4091 7.65015 15.7829 7.68012L21.0161 8.09966C21.9027 8.17074 22.2623 9.27725 21.5867 9.85592L17.5996 13.2713C17.3148 13.5153 17.1904 13.8981 17.2774 14.2628L18.4956 19.3695C18.702 20.2348 17.7607 20.9186 17.0016 20.455L12.5213 17.7184C12.2012 17.5229 11.7988 17.5229 11.4787 17.7184L6.9984 20.455C6.2393 20.9186 5.29805 20.2348 5.50444 19.3695L6.72257 14.2628C6.80958 13.8981 6.68521 13.5153 6.40042 13.2713L2.41328 9.85592C1.73774 9.27725 2.09727 8.17074 2.98392 8.09966L8.21712 7.68012C8.59091 7.65015 8.91652 7.41358 9.06052 7.06735L11.0767 2.21993Z";
const GOLD: Stops = [[0.017, "#feed07"], [0.403, "#fffedf"], [0.984, "#edd620"]];
const PALE_GOLD: Stops = [[0, "#fffa8a"], [0.4, "#fffedf"], [1, "#fff9b8"]];
const HYPER: Stops = [[0.017, "#cd19ff"], [0.207, "#9676ff"], [0.463, "#b0d2ff"], [0.742, "#c0ff89"], [0.984, "#e06880"]];
const PASTEL: Stops = [[0.017, "#b6daff"], [0.296, "#f4ff78"], [0.538, "#ffc0c0"], [0.766, "#c0ff89"]];

const RATING_FRAME: Record<RatingTier, Paint> = {
  white: WHITE,
  blue: "#a4c4ff",
  green: "#97ffad",
  yellow: "#ffee6c",
  red: "#ef7476",
  purple: "#e071e1",
  bronze: [[0.02, "#ba5b43"], [0.98, "#f5a272"]],
  silver: [[0.305, "#6898bb"], [0.984, "#c5eef7"]],
  gold: GOLD,
  platinum: [[0.017, "#fffa8a"], [0.403, "#fffedf"], [0.984, "#fff9b8"]],
  rainbow: PASTEL,
  hyper: HYPER,
};

/** five digit cells in a coloured frame; [x, y] is the top-left of the 150×56 component, drawn at K */
function drawRating(ctx: Ctx, x: number, y: number, rating: number | undefined, tier: RatingTier) {
  const w = 150 * K;
  const h = 56 * K;
  const pad = 4 * K;
  ctx.fillStyle = paint(ctx, RATING_FRAME[tier], x, w);
  roundRect(ctx, x, y, w, h, 8 * K);
  ctx.fill();
  ctx.save();
  roundRect(ctx, x + pad, y + pad, w - pad * 2, h - pad * 2, 7.5 * K);
  ctx.clip();
  const g = ctx.createLinearGradient(0, y + pad, 0, y + pad + (h - pad * 2) * 1.325);
  g.addColorStop(0, "#5d5d5d");
  g.addColorStop(1, "#6b6b6b");
  ctx.fillStyle = g;
  ctx.fillRect(x + pad, y + pad, w - pad * 2, h - pad * 2);
  ctx.fillStyle = "#828282";
  ctx.fillRect(x + pad, y + pad + 33.75 * K, w - pad * 2, 15 * K);
  const digits = rating == null ? "" : String(Math.min(99999, Math.max(0, Math.round(rating)))).padStart(5, " ");
  const cell = (w - pad * 2) / 5;
  ctx.strokeStyle = "#4f4a4a";
  ctx.lineWidth = 0.94 * K;
  ctx.font = font(600, 32 * K);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < 5; i++) {
    const cx = x + pad + cell * i;
    ctx.strokeRect(cx + ctx.lineWidth / 2, y + pad + ctx.lineWidth / 2, cell - ctx.lineWidth, h - pad * 2 - ctx.lineWidth);
    ctx.fillStyle = "#ffe788";
    if (digits[i] && digits[i] !== " ") ctx.fillText(digits[i], cx + cell / 2, y + h / 2 + 1);
  }
  ctx.restore();
}

/** dan plate; [x, y] is the top-left of the 170×64 component, drawn at K */
function drawDan(ctx: Ctx, x: number, y: number, dan: { label: string; jin: boolean }) {
  const look = dan.jin ? { fill: "#cb9ff4", edge: "#934ada", text: "#eedbff" } : { fill: "#f9b993", edge: "#e1946d", text: "#885942" };
  plate(ctx, DAN_PATH, x + 1.99 * K, y, K, look.fill, 166, { color: look.edge, width: 4 }, 3 * K);
  shadowText(ctx, dan.label, x + 85 * K, y + 32 * K, 36 * K, look.text, 3 * K);
}

const CLASS_LOOK: Record<ClassTier, { bands: [Paint, number][]; text: Paint }> = {
  B: { bands: [["#4f793e", 36]], text: "#ceffc5" },
  A: { bands: [["#932a2c", 42], ["#cc7778", 14]], text: "#ffd2d3" },
  S: { bands: [["#bfa38e", 42], ["#9c6350", 32]], text: "#ffcbac" },
  SS: { bands: [["#9fc7ed", 42], ["#737ac1", 32]], text: "#bddfff" },
  SSS: { bands: [["#2e4860", 42], ["#c35166", 32]], text: [[0.067, "#feed07"], [0.491, "#fffedf"], [0.915, "#edd620"]] },
  LEGEND: { bands: [[[[0.014, "#a88349"], [0.5, "#fffedf"], [0.986, "#a79054"]], 42], ["#8a419f", 32]], text: HYPER },
};

/** class emblem; [x, y] is the top-left of the 133×64 component, drawn at K. The whole emblem has one hard shadow. */
function drawClass(ctx: Ctx, x: number, y: number, cls: { label: string; tier: ClassTier }) {
  const look = CLASS_LOOK[cls.tier];
  const layer = canvas(133 * K, 64 * K + 3 * K);
  const c = layer.getContext("2d")!;
  c.scale(K, K);
  for (const [fill, h] of look.bands) {
    c.fillStyle = paint(c, fill, 14, 106);
    c.fillRect(14, 32 - h / 2 + (h === 36 ? 0 : 0.5), 106, h);
  }
  if (cls.tier === "B" || cls.tier === "A") {
    c.fillStyle = cls.tier === "B" ? "#a9d393" : "#fca4b0";
    c.beginPath();
    c.arc(67, 32, 31, 0, Math.PI * 2);
    c.fill();
  } else if (cls.tier === "S") plate(c, DIAMOND_1, 35, 1, 1, "#e39d8b", 62.7);
  else if (cls.tier === "SS") plate(c, DIAMOND_2, 27, 0.5, 1, "#a9d6ff", 79.7);
  else plate(c, DIAMOND_3, 18, 1, 1, cls.tier === "SSS" ? PALE_GOLD : PASTEL, 96.7);
  // one shadow for everything drawn so far
  ctx.save();
  ctx.shadowColor = SHADOW;
  ctx.shadowOffsetY = 3 * K;
  ctx.shadowBlur = 0;
  ctx.drawImage(layer, x, y);
  ctx.restore();
  shadowText(ctx, cls.label, x + 67 * K, y + 32 * K, (cls.tier === "LEGEND" ? 34 : 36) * K, look.text, 3 * K);
}

/** draws the profile card with its top-left corner at 0,0 */
export function drawProfileCard(ctx: Ctx, profile: MaimaiProfile, images: { icon?: ImageBitmap; dan?: ImageBitmap; cls?: ImageBitmap } = {}) {
  const icon = images.icon;
  const { width: W, height: H } = PROFILE;
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  roundRect(ctx, PROFILE.shadowX, PROFILE.shadowY, W, H, 9.2);
  ctx.fill();
  ctx.fillStyle = WHITE;
  roundRect(ctx, 0, 0, W, H, 9.2);
  ctx.fill();

  const pad = 27.6;
  const side = H - pad * 2;
  if (icon) ctx.drawImage(icon, pad, pad, side, side);
  else {
    ctx.fillStyle = "#e9e9e9";
    ctx.fillRect(pad, pad, side, side);
  }

  const x = pad + side + 17.25;
  const w = W - pad - x;
  let y = pad;

  // title (trophy)
  ctx.fillStyle = SHADOW;
  roundRect(ctx, x, y + 3.45, w, 43.125, 9.2);
  ctx.fill();
  ctx.fillStyle = "#f9b993";
  roundRect(ctx, x, y, w, 43.125, 9.2);
  ctx.fill();
  ctx.strokeStyle = "#e1946d";
  ctx.lineWidth = 3.45;
  roundRect(ctx, x + 1.725, y + 1.725, w - 3.45, 43.125 - 3.45, 7.5);
  ctx.stroke();
  if (profile.trophy) {
    ctx.save();
    roundRect(ctx, x + 3.45, y, w - 6.9, 43.125, 6);
    ctx.clip();
    ctx.font = font(400, 20.7);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.strokeText(profile.trophy, x + w / 2, y + 22.5);
    ctx.fillStyle = WHITE;
    ctx.fillText(profile.trophy, x + w / 2, y + 22.5);
    ctx.restore();
  }

  // name + rating
  y = pad + 59.02;
  const nameW = 397.65;
  ctx.fillStyle = SHADOW;
  roundRect(ctx, x, y + 3.45, nameW, 64.4, 9.2);
  ctx.fill();
  ctx.fillStyle = WHITE;
  roundRect(ctx, x, y, nameW, 64.4, 9.2);
  ctx.fill();
  ctx.strokeStyle = "#dbdbdb";
  ctx.lineWidth = 4.3125;
  roundRect(ctx, x + 2.156, y + 2.156, nameW - 4.3125, 64.4 - 4.3125, 7);
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 4.3, y, nameW - 8.6, 64.4);
  ctx.clip();
  ctx.font = font(400, 34.5);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = INK;
  ctx.fillText(profile.name, x + 9.2, y + 33.5);
  ctx.restore();
  const ratingX = x + nameW + 13.8;
  drawRating(ctx, ratingX, y, profile.rating, ratingTier(profile.rating, profile.ratingBase));
  // one small star to the right of the rating, as in the frame
  plate(ctx, STAR_SMALL, ratingX + 150 * K + 4.6, y + 4.6, K, "#f0da83", 24, undefined, 2);

  // dan and class: the site's badges at the row height, else the Figma ones
  y = pad + 139.31;
  let cx = x;
  const badge = (img: ImageBitmap) => {
    const bw = (img.width / img.height) * 64 * K;
    ctx.drawImage(img, cx, y, bw, 64 * K);
    cx += bw + 18.4;
  };
  const dan = danOf(profile.course);
  if (images.dan) badge(images.dan);
  else if (dan) {
    drawDan(ctx, cx, y, dan);
    cx += 170 * K + 18.4;
  }
  const cls = classOf(profile.cls);
  if (images.cls) badge(images.cls);
  else if (cls) drawClass(ctx, cx, y, cls);

  // play count: total / this version
  if (profile.playCount != null) {
    y = pad + 228.8;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = font(400, 27.6);
    ctx.fillStyle = INK;
    const text = `PLAY COUNT : ${profile.playCount.toLocaleString("en-US")}`;
    ctx.fillText(text, x, y + 26.5);
    if (profile.playCountCurrent != null) {
      const tw = ctx.measureText(text).width;
      ctx.font = font(400, 23);
      ctx.fillStyle = "#898989";
      ctx.fillText(`/ ${profile.playCountCurrent.toLocaleString("en-US")}`, x + tw + 9.2, y + 26.5);
    }
  }
}

