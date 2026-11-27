// What a shorts frame is made of: where the footage goes and one transparent overlay drawn over it.
// The preview and the encoder both draw frames with drawFrame, so they cannot disagree.
import type { MaimaiProfile } from "../../api.ts";
import type { Play } from "../songs.ts";
import { CARD, drawSongCard, type CardImages } from "./card.ts";
import { canvas, roundRect, type Ctx } from "./draw.ts";
import { cardImageUrls, type CardImageKey } from "./images.ts";
import { PROFILE, drawProfileCard } from "./profile.ts";

export const SHORTS = { width: 1080, height: 1920 };
export const CARD_MAX_Y = SHORTS.height - CARD.height - CARD.shadow;

export interface ShortsLayout {
  /** the footage covers this box (cropped to it) */
  footage: { x: number; y: number; w: number; h: number };
  /** which part shows when the footage is taller than the box: 0 = top, 1 = bottom */
  align: number;
  /** 1 = just covers the box; larger zooms in (and leaves more room to move it up and down) */
  zoom: number;
  /** 1080×1920, transparent where the footage shows */
  overlay: HTMLCanvasElement;
}

const FULL = { x: 0, y: 0, w: SHORTS.width, h: SHORTS.height };

/** how the footage sits in its box */
export interface FootageOptions {
  align: number;
  zoom: number;
}

/** the song card alone, at [y] over full-screen footage */
export function cardLayout(play: Play, images: CardImages, y: number, footage: FootageOptions): ShortsLayout {
  const overlay = canvas(SHORTS.width, SHORTS.height);
  const ctx = overlay.getContext("2d")!;
  ctx.translate(CARD.x, y);
  drawSongCard(ctx, play, images, "card");
  return { footage: FULL, ...footage, overlay };
}

// Frame 30 of the mai-log Figma file
const LEGACY = {
  panel: "#9bd5fc",
  border: "#2b2b2b",
  title: { y: 0, h: 393 },
  cardY: 68.8,
  footage: { x: 0, y: 373, w: 1080, h: 1135 },
  bottom: { y: 1492, h: 428 },
};

export interface LegacyOptions extends FootageOptions {
  /** the blue panels behind the two cards; without them the cards float on full-screen footage */
  background: boolean;
}

/** the old layout: song card on top, profile card at the bottom, optionally on blue panels */
export function legacyLayout(play: Play, profile: MaimaiProfile | null, images: CardImages, opts: LegacyOptions): ShortsLayout {
  const overlay = canvas(SHORTS.width, SHORTS.height);
  const ctx = overlay.getContext("2d")!;
  if (opts.background) {
    panel(ctx, LEGACY.title.y, LEGACY.title.h, [0, 0, 8, 8]);
    // the bottom panel has an offset shadow; only its top edge is inside the frame
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    roundRect(ctx, 4.6, LEGACY.bottom.y + 9.2, SHORTS.width, LEGACY.bottom.h, [9.2, 9.2, 0, 0]);
    ctx.fill();
    panel(ctx, LEGACY.bottom.y, LEGACY.bottom.h, [9.2, 9.2, 0, 0]);
  }
  ctx.save();
  ctx.translate(CARD.x, LEGACY.cardY);
  drawSongCard(ctx, play, images, "legacy");
  ctx.restore();
  if (profile) {
    ctx.save();
    ctx.translate(PROFILE.x, PROFILE.y);
    drawProfileCard(ctx, profile, images.icon);
    ctx.restore();
  }
  return { footage: opts.background ? LEGACY.footage : FULL, align: opts.align, zoom: opts.zoom, overlay };
}

function panel(ctx: Ctx, y: number, h: number, radius: number[]) {
  ctx.fillStyle = LEGACY.panel;
  roundRect(ctx, 0, y, SHORTS.width, h, radius);
  ctx.fill();
  ctx.strokeStyle = LEGACY.border;
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
