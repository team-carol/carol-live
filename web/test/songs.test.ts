import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeCounts, findSongs, matchPlays, type Play } from "../src/lib/songs.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/analysis-58min.json", import.meta.url), "utf8"));
const counts = decodeCounts(fixture.clicksPerSecond);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

test("58 min stream: songs as checked by hand", () => {
  const songs = findSongs(counts);
  console.log(songs.map((s, i) => `${i + 1}: ${mmss(s.start)}~${mmss(s.end)} (${mmss(s.end - s.start)})`).join("\n"));
  // 곡 1 is one song (its sparse start looks like song-select taps, so it begins where notes get dense)
  const first = songs.filter((s) => s.start < 6 * 60);
  assert.equal(first.length, 1, "song 1 kept whole");
  assert.ok(first[0].start <= 3 * 60 + 10 && first[0].end >= 5 * 60 + 50, `song 1 ${mmss(first[0].start)}~${mmss(first[0].end)}`);
  // 곡 13 has a ~30 s quiet part in the middle but is one song
  assert.equal(songs.filter((s) => s.start >= 47 * 60 && s.start < 50 * 60).length, 1, "song 13 kept whole");
  // 곡 5: song select taps before 18:30 are not part of it
  const s5 = songs.find((s) => s.end > 18 * 60 + 40 && s.start < 19 * 60);
  assert.ok(s5 && s5.start >= 18 * 60 + 25, `song 5 starts at the first notes (got ${s5 && mmss(s5.start)})`);
  // 곡 9: same, notes start around 31:56
  const s9 = songs.find((s) => s.end > 32 * 60 + 30 && s.start < 32 * 60 + 30);
  assert.ok(s9 && s9.start >= 31 * 60 + 50, `song 9 starts at the first notes (got ${s9 && mmss(s9.start)})`);
  // taps on the result / select screens after a song are not part of it
  assert.ok(s5!.end <= 21 * 60 + 20, `song 5 ends with its notes (got ${mmss(s5!.end)})`);
  const s10 = songs.find((s) => s.end > 38 * 60 && s.start < 38 * 60);
  assert.ok(s10 && s10.start >= 35 * 60 + 50, `song 10 starts at its notes (got ${s10 && mmss(s10.start)})`);
  // 곡 15 + 16: one song with a quiet break
  const last = songs.filter((s) => s.start > 53 * 60 + 40);
  assert.equal(last.length, 1, `53:54~56:59 is one song (got ${last.map((s) => mmss(s.start)).join(", ")})`);
});

test("plays are matched by a common offset and keep their order", () => {
  const songs = findSongs(counts);
  const recordedAt = Date.UTC(2026, 10, 20, 10, 0, 0);
  // fake plays stamped 20 s after each song end, minute precision, one extra play from another session
  const plays: Play[] = songs.map((s, i) => ({
    played_at: Math.floor((recordedAt + (s.end + 20) * 1000) / 60000) * 60000,
    track: (i % 4) + 1,
    title: `song ${i + 1}`,
    difficulty: "master",
    achievement: 100,
    details: null,
  }));
  plays.unshift({ played_at: recordedAt - 3600_000, track: 1, title: "earlier", difficulty: null, achievement: null, details: null });
  const { songs: named, offset } = matchPlays(songs, plays, recordedAt);
  assert.ok(offset !== null && offset >= -40 && offset <= 60, `offset ${offset}`);
  const hits = named.filter((s, i) => s.play?.title === `song ${i + 1}`).length;
  assert.ok(hits >= songs.length - 1, `matched ${hits}/${songs.length}`);
});

test("plays stamped at song start are matched too", () => {
  const songs = findSongs(counts);
  const recordedAt = Date.UTC(2026, 10, 20, 10, 0, 0);
  const plays: Play[] = songs.map((s, i) => ({
    played_at: recordedAt + (s.start - 8) * 1000,
    track: (i % 4) + 1,
    title: `song ${i + 1}`,
    difficulty: "master",
    achievement: 100,
    details: { playedAtSec: Math.floor(recordedAt / 1000) + s.start - 8 },
  }));
  const res = matchPlays(songs, plays, recordedAt);
  assert.equal(res.anchor, "start");
  assert.equal(res.songs.filter((s, i) => s.play?.title === `song ${i + 1}`).length, songs.length);
});
