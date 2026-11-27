import { test } from "node:test";
import assert from "node:assert/strict";
import { cardImageUrls, coverRect } from "../src/lib/shorts/images.ts";
import type { Play } from "../src/lib/songs.ts";

const play = (details: Play["details"]): Play => ({ played_at: 0, track: 1, title: "Titania", difficulty: "master", achievement: 100.829, details });

test("card images go through our server, by the names maimai DX NET uses", () => {
  const urls = cardImageUrls(
    play({ kind: "dx", rank: "sssplus", fc: "fcplus", sync: "fsd", jacket: "https://maimaidx-eng.com/maimai-mobile/img/Music/7bf12d9c7382a32c.png" }),
  );
  assert.deepEqual(urls, {
    jacket: "/api/maimai/img/Music/7bf12d9c7382a32c.png",
    kind: "/api/maimai/img/music_dx.png",
    rank: "/api/maimai/img/playlog/sssplus.png",
    fc: "/api/maimai/img/playlog/fcplus.png",
    sync: "/api/maimai/img/playlog/fsd.png",
  });
});

test("older short spellings map to the real file names; missing or odd values are left out", () => {
  assert.deepEqual(cardImageUrls(play({ kind: "std", rank: "sssp", fc: "app", sync: null })), {
    kind: "/api/maimai/img/music_standard.png",
    rank: "/api/maimai/img/playlog/sssplus.png",
    fc: "/api/maimai/img/playlog/applus.png",
  });
  assert.deepEqual(cardImageUrls(play({ rank: "../x", fc: "FC", jacket: "https://example.com/a.png" })), {});
  assert.deepEqual(cardImageUrls({ ...play({}), details: null as never }), {});
});

test("footage is scaled to cover the 9:16 frame", () => {
  assert.deepEqual(coverRect(1080, 1920, 1080, 1920), { x: 0, y: 0, w: 1080, h: 1920 });
  // 1080×1792 (a little short): scaled up, sides cropped
  const r = coverRect(1080, 1792, 1080, 1920);
  assert.equal(r.h, 1920);
  assert.ok(Math.abs(r.w - 1157.14) < 0.01 && Math.abs(r.x + 38.57) < 0.01 && r.y === 0);
  // landscape: height fits, most of the width is cropped
  const l = coverRect(1920, 1080, 1080, 1920);
  assert.equal(l.h, 1920);
  assert.ok(l.x < -1000);
});
