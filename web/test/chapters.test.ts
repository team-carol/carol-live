import { test } from "node:test";
import assert from "node:assert/strict";
import { youtubeChapters, stamp } from "../src/lib/chapters.ts";
import type { Song } from "../src/lib/songs.ts";

const songs: Song[] = [
  { start: 188, end: 356, play: { played_at: 0, track: 1, title: "Titania", difficulty: "master", achievement: 100.3887, details: { level: "14+", rank: "sssplus", fc: "ap", sync: "fsplus" } } },
  { start: 414, end: 518 },
  { start: 3700, end: 3850 },
];

test("chapters start at 0:00, are labeled and shifted by the stream offset", () => {
  const { text, ok } = youtubeChapters(songs, { offset: 2, lead: 5 });
  assert.ok(ok);
  assert.equal(text, ["0:00 시작", "3:05 Titania [MASTER 14+] 100.3887% SSS+ AP FS+", "6:51 곡 2", "1:01:37 곡 3"].join("\n"));
});

test("a first song right at the start becomes the 0:00 chapter; short gaps are dropped", () => {
  const { text } = youtubeChapters([{ start: 6, end: 100 }, { start: 104, end: 200 }, { start: 108, end: 300 }, { start: 400, end: 500 }], { offset: 0, lead: 5 });
  assert.deepEqual(text.split("\n").map((l) => l.split(" ")[0]), ["0:00", "1:39", "6:35"]);
});

test("fewer than three chapters is flagged", () => {
  assert.equal(youtubeChapters([{ start: 300, end: 400 }], { offset: 0, lead: 5 }).ok, false);
  assert.equal(stamp(3725), "1:02:05");
});
