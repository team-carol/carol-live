// Canvas helpers shared by the shorts overlays. Shapes and numbers follow the mai-log Figma file,
// where badges are a fill, an edge in a darker step of the hue and a hard 60% black shadow below.
export type Ctx = CanvasRenderingContext2D;

export const INK = "#2b2b2b";
export const WHITE = "#ffffff";
export const SHADOW = "rgba(0, 0, 0, 0.6)";
export const FAMILY = '"Pretendard", "Pretendard Variable", "Noto Sans JP", system-ui, sans-serif';
export const font = (weight: number, size: number) => `${weight} ${size}px ${FAMILY}`;
/** cap height of Pretendard, to centre capitals and digits on a line */
export const CAP = 0.72;

export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** [offset 0..1, colour] stops laid left to right over a box (the Figma gradients are within ~10° of horizontal) */
export type Stops = readonly (readonly [number, string])[];
export type Paint = string | Stops;

export function paint(ctx: Ctx, p: Paint, x: number, w: number): string | CanvasGradient {
  if (typeof p === "string") return p;
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  for (const [at, color] of p) g.addColorStop(at, color);
  return g;
}

export interface Outline {
  size: number;
  fill: Paint;
  stroke: string;
  /** stroke width outside the letters */
  width: number;
  /** colour of the hard shadow below; leave out for the usual 60% black */
  shadow?: string;
  drop: number;
  align?: "left" | "center";
}

/** capital letters / digits with an outer stroke and a hard shadow, centred on [cy]. Returns the text width. */
export function outlined(ctx: Ctx, text: string, x: number, cy: number, o: Outline): number {
  ctx.font = font(800, o.size);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = o.width * 2;
  const w = ctx.measureText(text).width;
  const left = o.align === "center" ? x - w / 2 : x;
  const y = cy + (o.size * CAP) / 2;
  const shadow = o.shadow ?? SHADOW;
  if (o.shadow) {
    ctx.strokeStyle = shadow;
    ctx.strokeText(text, left, y + o.drop);
    ctx.fillStyle = shadow;
    ctx.fillText(text, left, y + o.drop);
  } else {
    // translucent shadow: stroke only (it covers the letters too), so it is not laid down twice
    ctx.strokeStyle = shadow;
    ctx.lineWidth = o.width * 2 + 1;
    ctx.strokeText(text, left, y + o.drop);
    ctx.lineWidth = o.width * 2;
  }
  ctx.strokeStyle = o.stroke;
  ctx.strokeText(text, left, y);
  ctx.fillStyle = paint(ctx, o.fill, left, w);
  ctx.fillText(text, left, y);
  return w;
}

export function outlinedWidth(ctx: Ctx, text: string, size: number, width: number): number {
  ctx.font = font(800, size);
  return ctx.measureText(text).width + width * 2;
}

/** plain text with the hard shadow the Figma badges use, centred on [cx, cy] */
export function shadowText(ctx: Ctx, text: string, cx: number, cy: number, size: number, fill: Paint, drop: number, weight = 800) {
  ctx.font = font(weight, size);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width;
  ctx.fillStyle = SHADOW;
  ctx.fillText(text, cx - w / 2, cy + drop);
  ctx.fillStyle = paint(ctx, fill, cx - w / 2, w);
  ctx.fillText(text, cx - w / 2, cy);
}

/** shrinks, then cuts with … so [text] fits [max] */
export function fitText(ctx: Ctx, text: string, weight: number, size: number, min: number, max: number): { text: string; size: number } {
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

/** an SVG path drawn at [x, y], scaled by [k]: hard shadow, fill, then an edge kept inside the shape */
export function plate(ctx: Ctx, d: string, x: number, y: number, k: number, fill: Paint, w: number, edge?: { color: string; width: number }, drop = 0) {
  const path = new Path2D(d);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  if (drop) {
    ctx.save();
    ctx.translate(0, drop / k);
    ctx.fillStyle = SHADOW;
    ctx.fill(path);
    ctx.restore();
  }
  ctx.fillStyle = paint(ctx, fill, 0, w);
  ctx.fill(path);
  if (edge) {
    ctx.clip(path);
    ctx.strokeStyle = edge.color;
    ctx.lineWidth = edge.width * 2;
    ctx.stroke(path);
  }
  ctx.restore();
}

export function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.ceil(width);
  c.height = Math.ceil(height);
  return c;
}

/**
 * Canvas text uses a font only once it is loaded, and the Japanese web font comes in pieces per group of
 * characters, so this asks for exactly the [text] that is about to be drawn.
 */
export async function loadFonts(text = ""): Promise<void> {
  const sample = `가A1${text}`;
  await Promise.all([400, 600, 800].map((w) => document.fonts.load(font(w, 40), sample).catch(() => [])));
}
