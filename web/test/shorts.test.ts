import { test } from "node:test";
import assert from "node:assert/strict";
import { cardImageUrls, classOf, coverRect, danOf, ratingTier } from "../src/lib/shorts/images.ts";
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

test("the player icon goes through the same image path", () => {
  assert.deepEqual(cardImageUrls(play({}), { icon: "39c1bbf3be79bcc5" }), { icon: "/api/maimai/img/Icon/39c1bbf3be79bcc5.png" });
  assert.deepEqual(cardImageUrls(play({}), { icon: "../x" }), {});
});

test("maimai DX NET image numbers map to dan and class names", () => {
  assert.deepEqual(danOf(1), { label: "初段", jin: false });
  assert.deepEqual(danOf(10), { label: "十段", jin: false });
  assert.deepEqual(danOf(12), { label: "真初段", jin: true });
  assert.deepEqual(danOf(15), { label: "真四段", jin: true }); // checked on the player data page
  assert.deepEqual(danOf(21), { label: "真十段", jin: true });
  assert.equal(danOf(22)?.label, "真皆伝");
  assert.equal(danOf(23)?.label, "裏皆伝");
  assert.equal(danOf(0), null);
  assert.equal(danOf(11), null);
  assert.equal(danOf(undefined), null);

  assert.equal(classOf(0)?.label, "B5");
  assert.equal(classOf(4)?.label, "B1");
  assert.equal(classOf(15)?.label, "SS5");
  assert.deepEqual(classOf(20), { label: "SSS5", tier: "SSS", step: 5 }); // checked on the player data page
  assert.equal(classOf(24)?.label, "SSS1");
  assert.equal(classOf(25)?.label, "LEGEND");
  assert.equal(classOf(26), null);
});

test("the rating frame follows the site's image name, else the number", () => {
  assert.equal(ratingTier(16366, "rainbow_kiwami"), "hyper");
  assert.equal(ratingTier(15200, "rainbow"), "rainbow");
  assert.equal(ratingTier(5000, "orange"), "yellow");
  assert.equal(ratingTier(15200), "rainbow");
  assert.equal(ratingTier(14600, "something_new"), "platinum");
  assert.equal(ratingTier(12999), "bronze");
  assert.equal(ratingTier(0), "white");
  assert.equal(ratingTier(undefined), "white");
});
