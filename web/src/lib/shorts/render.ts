// Turns a part of a recording into a 1080×1920 shorts mp4 in the browser: every frame is decoded,
// the song card is stamped on it and it is encoded again (WebCodecs via mediabunny). Audio is copied as is.
import { BufferTarget, Conversion, Input, MP4, Mp4OutputFormat, Output, Quality, UrlSource, canEncodeVideo } from "mediabunny";
import { CARD, SHORTS } from "./card.ts";
import { coverRect } from "./images.ts";

/** enough for 1080×1920 play footage with a lot of motion; a 2:30 song comes out around 190MB */
const VIDEO_BITRATE = 10_000_000;

export interface ShortsRequest {
  /** the recording, served with Range support */
  url: string;
  from: number;
  to: number;
  /** song card bitmap (renderCard) and where its top edge goes in the 1920-high frame */
  card: CanvasImageSource | null;
  cardY: number;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

export function shortsSupported(): Promise<boolean> {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") return Promise.resolve(false);
  return canEncodeVideo("avc", { width: SHORTS.width, height: SHORTS.height, quality: new Quality({ bitrate: VIDEO_BITRATE }) }).catch(() => false);
}

export async function renderShorts(req: ShortsRequest): Promise<{ blob: Blob; duration: number }> {
  const { width: W, height: H } = SHORTS;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;

  const input = new Input({
    source: new UrlSource(new URL(req.url, location.href).href, { requestInit: { credentials: "same-origin" } }),
    formats: [MP4],
  });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      trim: { start: req.from, end: req.to },
      showWarnings: false,
      video: async (track) => {
        // the encoder spreads the bitrate over the frame rate it is told; without it, 60 fps footage comes out twice as big
        const stats = await track.computePacketStats(120).catch(() => null);
        const fps = stats && Number.isFinite(stats.averagePacketRate) ? stats.averagePacketRate : 30;
        return {
          codec: "avc",
          quality: new Quality({ bitrate: VIDEO_BITRATE }),
          frameRate: Math.min(60, Math.max(24, Math.round(fps))),
          forceTranscode: true,
          // rotation is baked in by draw() below, so it must not also be written as metadata
          allowTransformationMetadata: false,
          processedWidth: W,
          processedHeight: H,
          process: (sample) => {
            const r = coverRect(sample.displayWidth, sample.displayHeight, W, H);
            sample.draw(ctx, r.x, r.y, r.w, r.h);
            if (req.card) ctx.drawImage(req.card, CARD.x, req.cardY);
            return canvas;
          },
        };
      },
    });
    if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.type === "video")) {
      throw new Error("이 브라우저에서는 이 영상을 다시 인코딩할 수 없음. 크롬이나 엣지에서 해봐줘");
    }
    conversion.onProgress = (p) => req.onProgress?.(p);
    const abort = () => void conversion.cancel();
    req.signal?.addEventListener("abort", abort, { once: true });
    try {
      await conversion.execute();
    } finally {
      req.signal?.removeEventListener("abort", abort);
    }
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("쇼츠 파일을 만들지 못했음");
    return { blob: new Blob([buffer], { type: "video/mp4" }), duration: req.to - req.from };
  } finally {
    input.dispose();
  }
}
