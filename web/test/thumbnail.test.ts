import assert from "node:assert/strict";
import { test } from "node:test";
import { THUMBNAIL, fitSize, fitsAsIs } from "../src/lib/thumbnail.ts";

test("a JPG or PNG within YouTube's 2 MB goes up untouched; anything else is redrawn", () => {
  assert.equal(fitsAsIs("image/png", 5301), true);
  assert.equal(fitsAsIs("image/jpeg", THUMBNAIL.maxBytes), true);
  assert.equal(fitsAsIs("image/jpeg", THUMBNAIL.maxBytes + 1), false);
  assert.equal(fitsAsIs("image/webp", 1000), false);
});

test("a redrawn picture fits in 1280×720 without being enlarged or stretched", () => {
  assert.deepEqual(fitSize(1920, 1080), { w: 1280, h: 720 });
  assert.deepEqual(fitSize(3000, 4000), { w: 540, h: 720 });
  assert.deepEqual(fitSize(4000, 1000), { w: 1280, h: 320 });
  assert.deepEqual(fitSize(640, 360), { w: 640, h: 360 });
});
