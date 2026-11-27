// Which maimai DX NET images a play's card uses, as paths on our own server (/api/maimai/img/…).
// Pure (no DOM) so node tests can load it.
import type { Play } from "../songs.ts";

export const MAIMAI_IMG = "/api/maimai/img/";

export type CardImageKey = "jacket" | "kind" | "rank" | "fc" | "sync";

/** playlog/<name>.png: short spellings from older imports -> the file names maimai DX NET uses */
const PLAYLOG_NAME: Record<string, string> = { sssp: "sssplus", ssp: "ssplus", sp: "splus", app: "applus", fcp: "fcplus", fsdp: "fsdplus", fsp: "fsplus" };

function playlog(name: string | null | undefined): string | undefined {
  if (!name || !/^[a-z]{1,10}$/.test(name)) return undefined;
  return `${MAIMAI_IMG}playlog/${PLAYLOG_NAME[name] ?? name}.png`;
}

export function cardImageUrls(play: Play): Partial<Record<CardImageKey, string>> {
  const d = play.details ?? {};
  const jacket = /img\/Music\/([0-9a-f]{8,32})\.png/.exec(d.jacket ?? "")?.[1];
  const out: Partial<Record<CardImageKey, string>> = {
    jacket: jacket && `${MAIMAI_IMG}Music/${jacket}.png`,
    kind: d.kind === "dx" ? `${MAIMAI_IMG}music_dx.png` : d.kind === "std" ? `${MAIMAI_IMG}music_standard.png` : undefined,
    rank: playlog(d.rank),
    fc: playlog(d.fc),
    sync: playlog(d.sync),
  };
  for (const k of Object.keys(out) as CardImageKey[]) if (!out[k]) delete out[k];
  return out;
}

/** where a w×h picture goes so it covers a W×H frame (centered, cropped) */
export function coverRect(w: number, h: number, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const s = Math.max(W / w, H / h);
  return { x: (W - w * s) / 2, y: (H - h * s) / 2, w: w * s, h: h * s };
}
