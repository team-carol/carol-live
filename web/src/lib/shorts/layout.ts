// What a shorts frame is made of: where the footage goes and one transparent overlay drawn over it.
// The preview and the encoder both draw frames with drawFrame, so they cannot disagree.
import type { MaimaiProfile } from "../../api.ts";
import type { Play } from "../songs.ts";
import { CARD, drawSongCard, type CardImages } from "./card.ts";
import { canvas, roundRect, type Ctx } from "./draw.ts";
import { cardImageUrls, type CardImageKey } from "./images.ts";
import { PROFILE, drawProfileCard } from "./profile.ts";
import { drawStats, drawStatsScrim } from "./stats.ts";

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
/** space between a card or panel and the lettering on the footage */
const STATS_GAP = 33;
/** below the icons the Shorts player shows at the top */
const TOP_SAFE = 130;

/** how the footage sits in its box */
export interface FootageOptions {
  align: number;
  zoom: number;
}

/** the song card alone, at [y] over full-screen footage */
export function cardLayout(play: Play, images: CardImages, y: number, footage: FootageOptions): ShortsLayout {
  const overlay = canvas(SHORTS.width, SHORTS.height);
  const ctx = overlay.getContext("2d")!;
  // the result goes on the footage: right under a card in the upper half, else at the top of the frame
  const upper = y + CARD.height / 2 < SHORTS.height / 2;
  const top = upper ? y + CARD.height + CARD.shadow + STATS_GAP : TOP_SAFE;
  drawStatsScrim(ctx, play, upper ? y + CARD.height / 2 : 0, top);
  ctx.save();
  ctx.translate(CARD.x, y);
  drawSongCard(ctx, play, images);
  ctx.restore();
  drawStats(ctx, play, top);
  return { footage: FULL, ...footage, overlay };
}

// Frame 30 of the mai-log Figma file. The song card lost its bottom row, so the top panel is shorter than
// in the frame (same 68.8 above and below the card) and the footage starts higher.
const LEGACY_TITLE_H = 68.8 * 2 + CARD.height;
const LEGACY = {
  panel: "#9bd5fc",
  border: "#2b2b2b",
  title: { y: 0, h: LEGACY_TITLE_H },
  cardY: 68.8,
  // tucked 20 px under the top panel and 16 px under the bottom one, as in the frame
  footage: { x: 0, y: LEGACY_TITLE_H - 20, w: 1080, h: 1508 - (LEGACY_TITLE_H - 20) },
  bottom: { y: 1492, h: 428 },
};

export interface LegacyOptions extends FootageOptions {
  /** the blue panels behind the cards; without them the cards float on full-screen footage */
  background: boolean;
  /** the song card on top; without it only the result lettering is up there (and no top panel) */
  songCard: boolean;
}

/** the old layout: song card on top, profile card at the bottom, optionally on blue panels */
export function legacyLayout(play: Play, profile: MaimaiProfile | null, images: CardImages, opts: LegacyOptions): ShortsLayout {
  const overlay = canvas(SHORTS.width, SHORTS.height);
  const ctx = overlay.getContext("2d")!;
  const top = opts.songCard;
  const statsTop = !top ? TOP_SAFE : (opts.background ? LEGACY.title.h : LEGACY.cardY + CARD.height + CARD.shadow) + STATS_GAP;
  drawStatsScrim(ctx, play, !top ? 0 : opts.background ? LEGACY.footage.y : LEGACY.cardY + CARD.height / 2, statsTop);
  if (opts.background) {
    if (top) panel(ctx, LEGACY.title.y, LEGACY.title.h, [0, 0, 8, 8]);
    // the bottom panel has an offset shadow; only its top edge is inside the frame
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    roundRect(ctx, 4.6, LEGACY.bottom.y + 9.2, SHORTS.width, LEGACY.bottom.h, [9.2, 9.2, 0, 0]);
    ctx.fill();
    panel(ctx, LEGACY.bottom.y, LEGACY.bottom.h, [9.2, 9.2, 0, 0]);
  }
  if (top) {
    ctx.save();
    ctx.translate(CARD.x, LEGACY.cardY);
    drawSongCard(ctx, play, images);
    ctx.restore();
  }
  drawStats(ctx, play, statsTop);
  if (profile) {
    ctx.save();
    ctx.translate(PROFILE.x, PROFILE.y);
    drawProfileCard(ctx, profile, images);
    ctx.restore();
  }
  // without the top panel the footage runs from the top of the frame down to the bottom panel
  const window = top ? LEGACY.footage : { x: 0, y: 0, w: SHORTS.width, h: LEGACY.footage.y + LEGACY.footage.h };
  return { footage: opts.background ? window : FULL, align: opts.align, zoom: opts.zoom, overlay };
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
