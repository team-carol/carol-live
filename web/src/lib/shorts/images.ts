// Which maimai DX NET images a play's card uses, as paths on our own server (/api/maimai/img/…).
// Pure (no DOM) so node tests can load it.
import type { Play } from "../songs.ts";

export const MAIMAI_IMG = "/api/maimai/img/";

export type CardImageKey = "jacket" | "kind" | "rank" | "fc" | "sync" | "icon" | "dan" | "cls";

/** playlog/<name>.png: short spellings from older imports -> the file names maimai DX NET uses */
const PLAYLOG_NAME: Record<string, string> = { sssp: "sssplus", ssp: "ssplus", sp: "splus", app: "applus", fcp: "fcplus", fsdp: "fsdplus", fsp: "fsplus" };

function playlog(name: string | null | undefined): string | undefined {
  if (!name || !/^[a-z]{1,10}$/.test(name)) return undefined;
  return `${MAIMAI_IMG}playlog/${PLAYLOG_NAME[name] ?? name}.png`;
}

export function cardImageUrls(
  play: Play,
  profile?: { icon?: string; courseImg?: string; classImg?: string } | null,
): Partial<Record<CardImageKey, string>> {
  const d = play.details ?? {};
  const jacket = /img\/Music\/([0-9a-f]{8,32})\.png/.exec(d.jacket ?? "")?.[1];
  const out: Partial<Record<CardImageKey, string>> = {
    jacket: jacket && `${MAIMAI_IMG}Music/${jacket}.png`,
    kind: d.kind === "dx" ? `${MAIMAI_IMG}music_dx.png` : d.kind === "std" ? `${MAIMAI_IMG}music_standard.png` : undefined,
    rank: playlog(d.rank),
    fc: playlog(d.fc),
    sync: playlog(d.sync),
    icon: profile?.icon && /^[0-9a-f]{8,32}$/.test(profile.icon) ? `${MAIMAI_IMG}Icon/${profile.icon}.png` : undefined,
    dan: profile?.courseImg && /^course_rank_[0-9A-Za-z]{1,24}$/.test(profile.courseImg) ? `${MAIMAI_IMG}course/${profile.courseImg}.png` : undefined,
    cls: profile?.classImg && /^class_rank_s_[0-9A-Za-z]{1,24}$/.test(profile.classImg) ? `${MAIMAI_IMG}class/${profile.classImg}.png` : undefined,
  };
  for (const k of Object.keys(out) as CardImageKey[]) if (!out[k]) delete out[k];
  return out;
}

/** where a w×h picture goes so it covers a W×H frame (centered, cropped) */
export function coverRect(w: number, h: number, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const s = Math.max(W / w, H / h);
  return { x: (W - w * s) / 2, y: (H - h * s) / 2, w: w * s, h: h * s };
}

// ---- player profile: what maimai DX NET's image numbers mean ----

const KANJI = ["初", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/** course_rank_<n>.png -> dan. 1–10 are 初段–十段, 12–21 真初段–真十段, 22 真皆伝, 23 裏皆伝 (checked: 15 = 真四段) */
export function danOf(n: number | null | undefined): { label: string; jin: boolean } | null {
  if (n == null || !Number.isInteger(n)) return null;
  if (n >= 1 && n <= 10) return { label: `${KANJI[n - 1]}段`, jin: false };
  if (n >= 12 && n <= 21) return { label: `真${KANJI[n - 12]}段`, jin: true };
  if (n === 22) return { label: "真皆伝", jin: true };
  if (n === 23) return { label: "裏皆伝", jin: true };
  return null;
}

export type ClassTier = "B" | "A" | "S" | "SS" | "SSS" | "LEGEND";

/** class_rank_s_<n>.png -> class. 0 = B5 … 4 = B1, 5 = A5 … 24 = SSS1, 25 = LEGEND (checked: 20 = SSS5) */
export function classOf(n: number | null | undefined): { label: string; tier: ClassTier; step: number } | null {
  if (n == null || !Number.isInteger(n) || n < 0 || n > 25) return null;
  if (n === 25) return { label: "LEGEND", tier: "LEGEND", step: 0 };
  const tier = (["B", "A", "S", "SS", "SSS"] as const)[Math.floor(n / 5)];
  const step = 5 - (n % 5);
  return { label: `${tier}${step}`, tier, step };
}

export type RatingTier = "white" | "blue" | "green" | "yellow" | "red" | "purple" | "bronze" | "silver" | "gold" | "platinum" | "rainbow" | "hyper";

const RATING_BASE: Record<string, RatingTier> = {
  normal: "white",
  blue: "blue",
  green: "green",
  orange: "yellow",
  yellow: "yellow",
  red: "red",
  purple: "purple",
  bronze: "bronze",
  silver: "silver",
  gold: "gold",
  platinum: "platinum",
  rainbow: "rainbow",
  rainbow_kiwami: "hyper",
};
const RATING_FLOOR: [number, RatingTier][] = [
  [16000, "hyper"],
  [15000, "rainbow"],
  [14500, "platinum"],
  [14000, "gold"],
  [13000, "silver"],
  [12000, "bronze"],
  [10000, "purple"],
  [7000, "red"],
  [4000, "yellow"],
  [2000, "green"],
  [1000, "blue"],
];

/** frame colour of the rating box: by the rating_base_<name>.png maimai DX NET shows, else by the number */
export function ratingTier(rating: number | null | undefined, base?: string | null): RatingTier {
  if (base && RATING_BASE[base]) return RATING_BASE[base];
  for (const [floor, tier] of RATING_FLOOR) if ((rating ?? 0) >= floor) return tier;
  return "white";
}
