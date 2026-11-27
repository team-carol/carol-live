import { achievementText, difficultyLabel, marks, rankLabel } from "./maimaiLabels.ts";
import type { Song } from "./songs.ts";

/**
 * YouTube description chapters from the songs of a recording.
 * YouTube only turns timestamps into chapters when the list starts at 0:00, has at least three
 * entries and every chapter is at least 10 seconds long.
 */
export const CHAPTER_RULES = { minCount: 3, minLength: 10 };

/** seconds -> "3:08" / "1:02:03" */
export function stamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function songLabel(song: Song, index: number): string {
  const p = song.play;
  if (!p) return `곡 ${index + 1}`;
  const diff = [difficultyLabel(p.difficulty), p.details?.level].filter(Boolean).join(" ");
  const result = [achievementText(p.achievement), rankLabel(p.details?.rank), ...marks(p).map((m) => m.label)]
    .filter(Boolean)
    .join(" ");
  return [p.title, diff && `[${diff}]`, result].filter(Boolean).join(" ");
}

export interface ChapterOptions {
  /** YouTube video time minus recording time (the stream usually starts a moment before the recording) */
  offset: number;
  /** chapter starts this many seconds before the song's first dense notes (same as the clip padding) */
  lead: number;
  /** title of the first chapter when the first song does not start right away */
  intro?: string;
}

export function youtubeChapters(songs: Song[], { offset, lead, intro = "시작" }: ChapterOptions): { text: string; ok: boolean } {
  const lines: { at: number; label: string }[] = [];
  songs.forEach((s, i) => {
    const at = Math.max(0, Math.round(s.start - lead + offset));
    const last = lines[lines.length - 1];
    // keep every chapter at least 10 s long
    if (last && at - last.at < CHAPTER_RULES.minLength) return;
    lines.push({ at, label: songLabel(s, i) });
  });
  if (!lines.length || lines[0].at > 0) {
    if (lines.length && lines[0].at < CHAPTER_RULES.minLength) lines[0].at = 0;
    else lines.unshift({ at: 0, label: intro });
  }
  return {
    text: lines.map((l) => `${stamp(l.at)} ${l.label}`).join("\n"),
    ok: lines.length >= CHAPTER_RULES.minCount,
  };
}
