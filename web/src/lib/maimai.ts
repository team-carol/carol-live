import { maimaiClear, maimaiDifficulty } from "@team-carol/design-system/game";
import scrapeSource from "./maimaiScrape.js?raw";
import type { PlayImport } from "../api";
import type { Play } from "./songs";

/**
 * Bookmarklet that runs lib/maimaiScrape.js on maimai DX NET's record page and opens
 * <origin>/import with the plays in the URL fragment (never sent to a server log).
 */
export function bookmarklet(origin: string): string {
  const code = `(function(){${scrapeSource}
var p=scrapeMaimaiRecord(document);
if(!p.length){alert("maimai DX NET의 플레이 기록(Record) 페이지에서 눌러줘");return}
var u=${JSON.stringify(`${origin}/import`)}+"#"+encodeURIComponent(JSON.stringify({v:1,plays:p}));
if(!window.open(u))location.href=u})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

/** reads what the bookmarklet put in the fragment */
export function readImportFragment(hash: string): PlayImport[] | null {
  if (!hash || hash.length < 2) return null;
  try {
    const data = JSON.parse(decodeURIComponent(hash.replace(/^#/, ""))) as { plays?: PlayImport[] };
    return Array.isArray(data.plays) ? data.plays : null;
  } catch {
    return null;
  }
}

const DIFFICULTY: Record<string, keyof typeof maimaiDifficulty | "宴"> = {
  basic: "BASIC",
  advanced: "ADVANCED",
  expert: "EXPERT",
  master: "MASTER",
  remaster: "Re:MASTER",
  utage: "宴",
};

export function difficultyLabel(d: string | null | undefined): string | null {
  return d ? (DIFFICULTY[d] ?? d.toUpperCase()) : null;
}

/** game colour from the design system (brand colours are not used for difficulties) */
export function difficultyColor(d: string | null | undefined): string | undefined {
  const label = d ? DIFFICULTY[d] : undefined;
  return label && label !== "宴" ? maimaiDifficulty[label] : undefined;
}

/** background + readable text for a difficulty badge (Re:MASTER's light purple needs dark text) */
export function difficultyStyle(d: string | null | undefined): { background?: string; color?: string } {
  const bg = difficultyColor(d);
  if (!bg) return {};
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { background: bg, color: lum > 0.5 ? "var(--crl-canvas)" : "var(--crl-ink)" };
}

/** playlog/<name>.png on the record page */
const RANK: Record<string, keyof typeof maimaiClear> = {
  sssplus: "SSS+",
  sss: "SSS",
  ssplus: "SS+",
  ss: "SS",
  splus: "S+",
  s: "S",
  aaa: "AAA",
  aa: "AA",
  a: "A",
  bbb: "BBB",
  bb: "BB",
  b: "B",
  c: "C",
  d: "D",
};

export function rankLabel(r: string | null | undefined): string | null {
  return r ? (RANK[r] ?? r.toUpperCase()) : null;
}

export function rankColor(r: string | null | undefined): string | undefined {
  const label = r ? RANK[r] : undefined;
  return label ? maimaiClear[label] : undefined;
}

const MARK: Record<string, keyof typeof maimaiClear> = {
  applus: "AP+",
  ap: "AP",
  fcplus: "FC+",
  fc: "FC",
  fsdplus: "FSD+",
  fsd: "FSD",
  fsplus: "FS+",
  fs: "FS",
  sync: "SYNC",
};

/** FC/AP and sync marks shown on a play, e.g. ["AP", "FS+"] */
export function marks(p: Play): { label: string; color: string }[] {
  const out: { label: string; color: string }[] = [];
  for (const m of [p.details?.fc, p.details?.sync]) {
    const label = m ? MARK[m] : undefined;
    if (label) out.push({ label, color: maimaiClear[label] });
  }
  return out;
}

export function achievementText(a: number | null | undefined): string | null {
  return a == null ? null : `${a.toFixed(4)}%`;
}

/** "Titania_MASTER" style piece for file names */
export function playFilePart(p: Play): string {
  const parts = [p.title, difficultyLabel(p.difficulty)].filter(Boolean).join("_");
  return parts.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/_+/g, "_").slice(0, 80);
}
