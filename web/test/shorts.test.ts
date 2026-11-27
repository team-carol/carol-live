import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DESIGN, applyPreset, cleanDesign, cleanSaved, frameGeometry, snapBox, withSaved, type CardBox, type ShortsDesign } from "../src/lib/shorts/design.ts";
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
  // short spellings from older imports
  assert.equal(cardImageUrls(play({ rank: "sssp", fc: "app" })).rank, "/api/maimai/img/playlog/sssplus.png");
  assert.equal(cardImageUrls(play({ rank: "sssp", fc: "app" })).fc, "/api/maimai/img/playlog/applus.png");
});

test("missing or odd values are left out", () => {
  assert.deepEqual(cardImageUrls(play({ kind: "std" })), { kind: "/api/maimai/img/music_standard.png" });
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
  assert.deepEqual(cardImageUrls(play({}), { courseImg: "course_rank_15DlEMWlRz", classImg: "class_rank_s_20OmGGNvGh" }), {
    dan: "/api/maimai/img/course/course_rank_15DlEMWlRz.png",
    cls: "/api/maimai/img/class/class_rank_s_20OmGGNvGh.png",
  });
  assert.deepEqual(cardImageUrls(play({}), { courseImg: "course_rank_../x", classImg: "class_rank_20" }), {});
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

// ---- the design the editor changes ----

const SONG: CardBox = { y: 68.8, h: 185.2, shadow: 5.2, above: 68.8, below: 68.8 };
const PROFILE: CardBox = { y: 1417, h: 258, shadow: 9.2, above: -75, below: 68.8 };
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

test("panels follow the cards: the Figma frame with both cards", () => {
  const g = frameGeometry(true, [SONG, PROFILE]);
  assert.ok(near(g.top!, 322.8) && g.bottom === 1492);
  // the footage is tucked 20 px under the top panel and 16 px under the bottom one
  assert.ok(near(g.footage.y, 302.8) && near(g.footage.y + g.footage.h, 1508));
  assert.ok(near(g.statsTop, 355.8));
});

test("without a song card the footage starts at the top and the result goes below the Shorts icons", () => {
  const g = frameGeometry(true, [PROFILE]);
  assert.equal(g.top, null);
  assert.deepEqual(g.footage, { x: 0, y: 0, w: 1080, h: 1508 });
  assert.equal(g.statsTop, 130);
  assert.equal(g.scrimFrom, 0);
});

test("without panels the footage fills the frame and the result sits under a card in the upper half", () => {
  const g = frameGeometry(false, [{ ...SONG, y: 110 }]);
  assert.deepEqual(g.footage, { x: 0, y: 0, w: 1080, h: 1920 });
  assert.ok(near(g.statsTop, 110 + 185.2 + 5.2 + 33));
  // the gradient starts behind the card
  assert.ok(near(g.scrimFrom, 110 + 185.2 / 2));
  // a card moved to the lower half leaves the top to the result
  assert.equal(frameGeometry(false, [{ ...SONG, y: 1300 }]).statsTop, 130);
  assert.equal(frameGeometry(false, []).statsTop, 130);
});

test("a song card dragged down gets a bottom panel; panels that would meet are dropped", () => {
  const g = frameGeometry(true, [{ ...SONG, y: 1300 }, { ...PROFILE, y: 1520 }]);
  assert.equal(g.top, null);
  assert.ok(near(g.bottom!, 1300 - 68.8));
  const tight = frameGeometry(true, [{ ...SONG, y: 700 }, { ...PROFILE, y: 990 }]);
  assert.equal(tight.top, null);
  assert.equal(tight.bottom, null);
  assert.equal(tight.footage.h, 1920);
});

test("presets set what shows and where, and keep the looks", () => {
  const mine: ShortsDesign = { ...DEFAULT_DESIGN, scrim: 0.8, marks: { ...DEFAULT_DESIGN.marks, style: "text", scale: 1.4, pos: { x: 500, y: 900 } } };
  const legacy = applyPreset(mine, "legacy");
  assert.ok(legacy.panels && legacy.song.show && legacy.profile.show && legacy.song.y === 68.8);
  assert.deepEqual(legacy.marks, { show: true, style: "text", row: false, scale: 1.4, pos: null });
  assert.equal(legacy.scrim, 0.8);
  // the original card carries the result itself
  const figma = applyPreset(mine, "figma");
  assert.ok(figma.song.style === "full" && !figma.achievement.show && !figma.marks.show);
  const bare = applyPreset(mine, "bare");
  assert.ok(!bare.song.show && bare.profile.show && !bare.panels && bare.achievement.show);
  const card = applyPreset(figma, "card");
  assert.ok(card.song.style === "compact" && card.song.y === 110 && !card.profile.show && card.marks.show);
});

test("a stored design is cleaned: odd values fall back, the first version's settings are carried over", () => {
  assert.deepEqual(cleanDesign(null), DEFAULT_DESIGN);
  assert.deepEqual(cleanDesign(JSON.parse(JSON.stringify(DEFAULT_DESIGN))), DEFAULT_DESIGN);
  const odd = cleanDesign({ scrim: 7, footage: { align: "x", zoom: 9 }, song: { style: "huge", y: -40 }, marks: { style: "text", scale: 100, pos: { x: 1 } }, achievement: { pos: { x: 99999, y: 12 } } });
  assert.equal(odd.scrim, 1);
  assert.deepEqual(odd.footage, { align: 0.55, zoom: 2 });
  assert.deepEqual(odd.song, { show: true, style: "compact", y: 0 });
  assert.deepEqual(odd.marks, { show: true, style: "text", row: false, scale: 2, pos: null });
  assert.deepEqual(odd.achievement.pos, { x: 1080, y: 12 });
  // { mode, background, songCard } from before the editor
  const old = cleanDesign({ mode: "legacy", background: false, songCard: false });
  assert.ok(!old.panels && !old.song.show && old.profile.show);
  assert.ok(cleanDesign({ mode: "legacy" }).panels);
  assert.deepEqual(cleanDesign({ mode: "card" }), applyPreset(DEFAULT_DESIGN, "card"));
});

test("a dragged piece sticks to the frame's centre, the margins and the other pieces, and says which lines", () => {
  const other = { x: 636, y: 300, w: 400, h: 200 };
  // 10 px left of the margin and 9 px above the other piece's top: pulled onto both
  const a = snapBox({ x: 34, y: 291, w: 420, h: 56 }, [other], { threshold: 14 });
  assert.equal(a.x, 44);
  assert.equal(a.y, 300);
  assert.deepEqual(a.guides, [
    { axis: "x", at: 44 },
    { axis: "y", at: 300 },
  ]);
  // centres: the box's middle onto the middle of the frame, its middle line onto the other's
  const b = snapBox({ x: 335, y: 366, w: 420, h: 56 }, [other], { threshold: 14 });
  assert.equal(b.x + 210, 540);
  assert.equal(b.y + 28, 400);
  // nothing near: left where it is, no lines
  const c = snapBox({ x: 200, y: 700, w: 300, h: 56 }, [other], { threshold: 14 });
  assert.deepEqual(c, { x: 200, y: 700, guides: [] });
  // cards only move up and down; extra lines (their Figma places) count
  const d = snapBox({ x: 16, y: 104, w: 1048, h: 185.2 }, [], { threshold: 14, x: false, extraY: [110] });
  assert.deepEqual(d, { x: 16, y: 110, guides: [{ axis: "y", at: 110 }] });
  // the nearest line wins
  assert.equal(snapBox({ x: 100, y: 293, w: 100, h: 10 }, [other], { threshold: 14, extraY: [296] }).y, 295);
});

test("designs are saved under a name: same name replaces, storage is cleaned", () => {
  const a = withSaved([], "  세로 영상  ", DEFAULT_DESIGN);
  assert.deepEqual(a.map((s) => s.name), ["세로 영상"]);
  const moved = { ...DEFAULT_DESIGN, scrim: 0.9 };
  const b = withSaved(withSaved(a, "레거시", applyPreset(DEFAULT_DESIGN, "legacy")), "세로 영상", moved);
  assert.deepEqual(b.map((s) => s.name), ["세로 영상", "레거시"]);
  assert.equal(b[0].design.scrim, 0.9);
  assert.equal(withSaved(b, "   ", moved), b);
  let many = b;
  for (let i = 0; i < 30; i++) many = withSaved(many, `구성 ${i}`, moved);
  assert.equal(many.length, 20);
  assert.equal(many[19].name, "구성 29");
  // from storage
  assert.deepEqual(cleanSaved("x"), []);
  const read = cleanSaved([{ name: "a", design: { scrim: 5 } }, { name: "a", design: {} }, { name: 3 }, null, { name: "b" }]);
  assert.deepEqual(read.map((s) => s.name), ["a", "b"]);
  assert.equal(read[0].design.scrim, 1);
  assert.deepEqual(read[1].design, DEFAULT_DESIGN);
});
