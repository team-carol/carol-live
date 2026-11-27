/**
 * Splits a recording into songs from the app's button-click counts (android GameActivity:
 * clicks per second), then names them from imported maimai DX NET plays.
 *
 * What the counts look like (58 min test stream, checked by hand):
 *  - playing: steady 5-15 clicks/s for 1.5-3.5 min, sometimes a quiet break of 10-30 s mid-song
 *  - song select: scattered taps, 1-6/s with zeros in between
 *  - result screen: nearly silent; song end -> next song's first notes was always 45 s or more
 * So a song is a stretch whose 5 s average reaches CORE, widened while the average stays above
 * EDGE, with breaks shorter than MERGE_GAP joined back. A sparse intro looks like song-select
 * taps, so a song starts where the notes get dense; the editor pads a few seconds before it.
 */

export interface Song {
  /** seconds from the start of the recording */
  start: number;
  end: number;
  /** maimai DX NET play matched to this song, if any */
  play?: Play;
}

export interface Play {
  played_at: number;
  track: number;
  title: string;
  difficulty: string | null;
  achievement: number | null;
  details: PlayDetails | null;
}

export interface PlayDetails {
  level?: string;
  kind?: "dx" | "std";
  rank?: string;
  dxScore?: string;
  fc?: string | null;
  sync?: string | null;
  jacket?: string;
  idx?: string;
  /** exact play time in seconds from maimai DX NET's detail link, when present */
  playedAtSec?: number;
}

export const SEGMENT_RULES = {
  window: 5,
  core: 5,
  edge: 3,
  /** dips inside a song: always joined */
  shortGap: 12,
  /** quiet parts inside a song: joined only between two pieces of at least [minPiece] */
  mergeGap: 35,
  /** short bursts after a quiet gap are taps on the result / select screen, not song */
  minPiece: 30,
  minLength: 50,
};

export function decodeCounts(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** centered moving average */
export function smooth(counts: ArrayLike<number>, window: number): Float32Array {
  const n = counts.length;
  const out = new Float32Array(n);
  const half = Math.floor(window / 2);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    while (hi < b) sum += counts[++hi];
    while (lo < a) sum -= counts[lo++];
    out[i] = sum / (b - a + 1);
  }
  return out;
}

export function findSongs(counts: ArrayLike<number>, rules = SEGMENT_RULES): Song[] {
  const n = counts.length;
  const avg = smooth(counts, rules.window);
  const raw: Song[] = [];
  let i = 0;
  while (i < n) {
    if (avg[i] < rules.core) {
      i++;
      continue;
    }
    // core found: widen both ways while the average stays at EDGE or above
    let a = i;
    while (a > 0 && avg[a - 1] >= rules.edge) a--;
    let b = i;
    while (b < n - 1 && avg[b + 1] >= rules.edge) b++;
    const next = b + 1;
    // trim to actual clicks at both ends
    while (a < b && counts[a] === 0) a++;
    while (b > a && counts[b] === 0) b--;
    raw.push({ start: a, end: b + 1 });
    i = next;
  }

  const join = (pieces: Song[], ok: (a: Song, b: Song) => boolean) => {
    const out: Song[] = [];
    for (const s of pieces) {
      const last = out[out.length - 1];
      if (last && ok(last, s)) last.end = Math.max(last.end, s.end);
      else out.push({ ...s });
    }
    return out;
  };
  const len = (s: Song) => s.end - s.start;
  const dipsJoined = join(raw, (a, b) => b.start - a.end < rules.shortGap);
  const breaksJoined = join(
    dipsJoined,
    (a, b) => b.start - a.end < rules.mergeGap && len(a) >= rules.minPiece && len(b) >= rules.minPiece,
  );
  return breaksJoined.filter((s) => len(s) >= rules.minLength);
}

// ------------------------------------------------------------------ maimai DX NET plays

const OFFSET_SEARCH = { from: -240, to: 240, step: 2 };
const MATCH_TOLERANCE = 60;

function playSecond(p: Play, recordedAt: number): number {
  const at = p.details?.playedAtSec ? p.details.playedAtSec * 1000 : p.played_at;
  return (at - recordedAt) / 1000;
}

/**
 * Names songs with plays. maimai DX NET stamps each play at a fixed point of its track (the
 * record page has the exact second), but whether that is the song's start or end, and how far
 * off, is not documented. So for each recording we try both anchors and a range of offsets, and
 * keep the fit that lines up the most plays, in order. Songs with no play nearby stay unnamed.
 */
export function matchPlays(
  songs: Song[],
  plays: Play[],
  recordedAt: number,
): { songs: Song[]; offset: number | null; anchor: "start" | "end" | null } {
  if (!songs.length || !plays.length) return { songs, offset: null, anchor: null };
  const times = plays.map((p) => playSecond(p, recordedAt));

  let best: { score: number; offset: number; anchor: "start" | "end"; pairs: Map<number, number> } | null = null;
  for (const anchor of ["end", "start"] as const) {
    for (let off = OFFSET_SEARCH.from; off <= OFFSET_SEARCH.to; off += OFFSET_SEARCH.step) {
      const pairs = new Map<number, number>();
      let score = 0;
      let p = 0;
      for (let s = 0; s < songs.length; s++) {
        const target = (anchor === "end" ? songs[s].end : songs[s].start) + off;
        // the first unused play close enough to this song, keeping the order
        while (p < times.length && times[p] < target - MATCH_TOLERANCE) p++;
        if (p < times.length && Math.abs(times[p] - target) <= MATCH_TOLERANCE) {
          pairs.set(s, p);
          score += 1 - Math.abs(times[p] - target) / (MATCH_TOLERANCE * 4);
          p++;
        }
      }
      if (!best || score > best.score + 1e-6) best = { score, offset: off, anchor, pairs };
    }
  }
  if (!best || best.pairs.size === 0) return { songs, offset: null, anchor: null };
  const fit = best;
  return {
    songs: songs.map((s, i) => (fit.pairs.has(i) ? { ...s, play: plays[fit.pairs.get(i)!] } : s)),
    offset: fit.offset,
    anchor: fit.anchor,
  };
}

export const DIFFICULTY_LABEL: Record<string, string> = {
  basic: "BASIC",
  advanced: "ADVANCED",
  expert: "EXPERT",
  master: "MASTER",
  remaster: "Re:MASTER",
  utage: "宴",
};
