// Turns a design (design.ts) into what a shorts frame is drawn from: where the footage goes and one transparent
// overlay over it. The preview and the encoder both draw frames with drawFrame, so they cannot disagree.
import type { MaimaiProfile } from "../../api.ts";
import type { Play } from "../songs.ts";
import { CARD, drawSongCard, type CardImages } from "./card.ts";
import { SHORTS, frameGeometry, type CardBox, type ElementId, type Point, type Rect, type ShortsDesign } from "./design.ts";
import { canvas, roundRect, type Ctx } from "./draw.ts";
import { cardImageUrls, type CardImageKey } from "./images.ts";
import { PROFILE, drawProfileCard } from "./profile.ts";
import { STATS, achievementBlock, drawScrim, marksBlock } from "./stats.ts";

export { SHORTS };

/** where a piece ended up, for picking and dragging it in the editor */
export interface Box extends Rect {
  id: ElementId;
  /** the point its position setting means: top-left, or top-right for the marks */
  anchor: Point;
  /** where it would sit when it follows the cards */
  auto?: Point;
}

export interface ShortsLayout {
  /** the footage covers this box (cropped to it) */
  footage: Rect;
  /** which part shows when the footage is taller than the box: 0 = top, 1 = bottom */
  align: number;
  /** 1 = just covers the box; larger zooms in (and leaves more room to move it up and down) */
  zoom: number;
  /** 1080×1920, transparent where the footage shows */
  overlay: HTMLCanvasElement;
  /** topmost first */
  boxes: Box[];
}

// Frame 30 of the mai-log Figma file: blue panels with a dark border, 68.8 above and below the song card,
// the bottom panel starting 75 below the top of the profile card (the card sticks out of it).
const PANEL = { fill: "#9bd5fc", border: "#2b2b2b", songMargin: 68.8, profileInset: 75 };
/** a result this close to the edge of the footage gets a gradient from that edge; further in, a band of its own */
const SCRIM_NEAR = 420;
const SCRIM_REACH = 110;

export function buildLayout(play: Play, profile: MaimaiProfile | null, images: CardImages, design: ShortsDesign): ShortsLayout {
  const overlay = canvas(SHORTS.width, SHORTS.height);
  const ctx = overlay.getContext("2d")!;
  const { song, marks, achievement } = design;
  const songH = CARD.height[song.style];
  const showProfile = design.profile.show && !!profile;

  const cards: CardBox[] = [];
  if (song.show) cards.push({ y: song.y, h: songH, shadow: CARD.shadow, above: PANEL.songMargin, below: PANEL.songMargin });
  if (showProfile) cards.push({ y: design.profile.y, h: PROFILE.height, shadow: PROFILE.shadowY, above: -PANEL.profileInset, below: PANEL.songMargin });
  const geo = frameGeometry(design.panels, cards);

  // the result: measured first, because the gradient goes under everything else
  const ach = achievement.show ? achievementBlock(ctx, play, achievement.scale) : null;
  const mk = marks.show ? marksBlock(ctx, play, images, marks) : null;
  // left to themselves the achievement and the first mark share a centre line
  const line = Math.max(ach?.h ?? 0, mk?.first ?? 0);
  const boxes: Box[] = [];
  if (ach) {
    const auto = { x: STATS.margin, y: geo.statsTop + (line - ach.h) / 2 };
    const at = achievement.pos ?? auto;
    boxes.push({ id: "achievement", x: at.x, y: at.y, w: ach.w, h: ach.h, anchor: at, auto });
  }
  if (mk) {
    const auto = { x: SHORTS.width - STATS.margin, y: geo.statsTop + (line - mk.first) / 2 };
    const at = marks.pos ?? auto;
    boxes.push({ id: "marks", x: at.x - mk.w, y: at.y, w: mk.w, h: mk.h, anchor: at, auto });
  }

  if (boxes.length && design.scrim > 0) {
    const top = Math.min(...boxes.map((b) => b.y));
    const bottom = Math.max(...boxes.map((b) => b.y + b.h));
    const end = geo.footage.y + geo.footage.h;
    if (top >= geo.scrimFrom && top - geo.scrimFrom < SCRIM_NEAR) drawScrim(ctx, design.scrim, geo.scrimFrom, bottom + SCRIM_REACH, "top");
    else if (bottom <= end && end - bottom < SCRIM_NEAR) drawScrim(ctx, design.scrim, top - SCRIM_REACH, end, "bottom");
    else drawScrim(ctx, design.scrim, top - SCRIM_REACH * 1.4, bottom + SCRIM_REACH * 1.4, "band");
  }

  if (geo.top !== null) panel(ctx, 0, geo.top, [0, 0, 8, 8]);
  if (geo.bottom !== null) {
    // the bottom panel has an offset shadow; only its top edge is inside the frame
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    roundRect(ctx, 4.6, geo.bottom + 9.2, SHORTS.width, SHORTS.height - geo.bottom, [9.2, 9.2, 0, 0]);
    ctx.fill();
    panel(ctx, geo.bottom, SHORTS.height - geo.bottom, [9.2, 9.2, 0, 0]);
  }

  if (song.show) {
    ctx.save();
    ctx.translate(CARD.x, song.y);
    drawSongCard(ctx, play, images, song.style, marks.style);
    ctx.restore();
    boxes.push({ id: "song", x: CARD.x, y: song.y, w: CARD.width, h: songH, anchor: { x: CARD.x, y: song.y } });
  }
  if (showProfile) {
    ctx.save();
    ctx.translate(PROFILE.x, design.profile.y);
    drawProfileCard(ctx, profile, design.profile.badges === "image" ? images : { icon: images.icon });
    ctx.restore();
    boxes.push({ id: "profile", x: PROFILE.x, y: design.profile.y, w: PROFILE.width, h: PROFILE.height, anchor: { x: PROFILE.x, y: design.profile.y } });
  }

  // the result goes over the cards, so it can be dragged onto one
  const [a, m] = [boxes.find((b) => b.id === "achievement"), boxes.find((b) => b.id === "marks")];
  if (ach && a) ach.draw(ctx, a.anchor.x, a.anchor.y);
  if (mk && m) mk.draw(ctx, m.anchor.x, m.anchor.y);

  return { footage: geo.footage, align: design.footage.align, zoom: design.footage.zoom, overlay, boxes };
}

/** how far each card can go down before it leaves the frame */
export function maxY(id: "song" | "profile", design: ShortsDesign): number {
  return Math.floor(SHORTS.height - (id === "song" ? CARD.height[design.song.style] + CARD.shadow : PROFILE.height + PROFILE.shadowY));
}

function panel(ctx: Ctx, y: number, h: number, radius: number[]) {
  ctx.fillStyle = PANEL.fill;
  roundRect(ctx, 0, y, SHORTS.width, h, radius);
  ctx.fill();
  ctx.strokeStyle = PANEL.border;
  ctx.lineWidth = 4;
  roundRect(ctx, 2, y + 2, SHORTS.width - 4, h - 4, radius.map((r) => Math.max(0, r - 2)));
  ctx.stroke();
}

/** one frame: footage scaled to cover its box, then the overlay. [draw] puts the source picture at a rectangle. */
export function drawFrame(
  ctx: Ctx | OffscreenCanvasRenderingContext2D,
  layout: ShortsLayout,
  sw: number,
  sh: number,
  draw: (x: number, y: number, w: number, h: number) => void,
) {
  const f = layout.footage;
  const full = f.w === SHORTS.width && f.h === SHORTS.height;
  if (!full) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, SHORTS.width, SHORTS.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x, f.y, f.w, f.h);
    ctx.clip();
  }
  if (sw > 0 && sh > 0) {
    const s = Math.max(f.w / sw, f.h / sh) * Math.max(1, layout.zoom);
    draw(f.x + (f.w - sw * s) / 2, f.y + (f.h - sh * s) * layout.align, sw * s, sh * s);
  }
  if (!full) ctx.restore();
  ctx.drawImage(layout.overlay, 0, 0);
}

/** maimai DX NET images through our server; a missing one just falls back to lettering or an empty box */
export async function loadCardImages(play: Play, profile?: MaimaiProfile | null): Promise<CardImages> {
  const urls = cardImageUrls(play, profile);
  const out: CardImages = {};
  await Promise.all(
    (Object.keys(urls) as CardImageKey[]).map(async (k) => {
      try {
        const res = await fetch(urls[k]!, { credentials: "same-origin" });
        if (res.ok) out[k] = await createImageBitmap(await res.blob());
      } catch {
        // keep the fallback
      }
    }),
  );
  return out;
}
