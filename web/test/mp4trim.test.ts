// node --experimental-strip-types --test web/test/mp4trim.test.ts
// needs ffmpeg/ffprobe on PATH and SAMPLE_DIR with nob.mp4 (no B-frames) / bf_end.mp4 (B-frames, moov at end)
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSync, readSync, fstatSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { trimMp4, probeDuration, type RangeReader } from "../src/lib/mp4trim.ts";

const dir = process.env.SAMPLE_DIR!;

function fileReader(path: string): RangeReader & { bytesRead: number } {
  const fd = openSync(path, "r");
  const size = fstatSync(fd).size;
  const r = {
    size,
    bytesRead: 0,
    async read(offset: number, length: number) {
      const buf = Buffer.alloc(length);
      readSync(fd, buf, 0, length, offset);
      r.bytesRead += length;
      return new Uint8Array(buf);
    },
  };
  return r;
}

function probe(path: string) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,start_time,duration",
    "-of", "json", path,
  ]).toString();
  return JSON.parse(out);
}

function countDecodedFrames(path: string): number {
  // decode for real; any corruption shows up as errors on stderr
  const out = execFileSync("ffprobe", [
    "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path,
  ]).toString();
  return Number(out.trim());
}

for (const name of ["nob.mp4", "bf_end.mp4"]) {
  test(`trim ${name} 5.3s..12.7s`, async () => {
    const src = join(dir, name);
    const reader = fileReader(src);
    assert.ok(Math.abs((await probeDuration(fileReader(src))) - 20) < 0.1);

    const res = await trimMp4(reader, 5.3, 12.7);
    const out = join(dir, `clip_${name}`);
    writeFileSync(out, Buffer.from(await res.blob.arrayBuffer()));

    // decodes without errors (execFileSync throws on non-zero exit)
    const err = execFileSync("ffmpeg", ["-v", "error", "-i", out, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(err.toString().trim(), "");

    const info = probe(out);
    const dur = Number(info.format.duration);
    assert.ok(Math.abs(dur - 7.4) < 0.15, `duration ${dur}`);
    // edit list hides the frames before 5.3s that were only needed to decode
    const frames = countDecodedFrames(out);
    assert.ok(Math.abs(frames - 7.4 * 60) <= 3, `frames ${frames}`);
    // only a part of the source was downloaded
    assert.ok(reader.bytesRead < reader.size * 0.6, `read ${reader.bytesRead} of ${reader.size}`);
  });
}

test("rejects reversed range", async () => {
  await assert.rejects(trimMp4(fileReader(join(dir, "nob.mp4")), 5, 4));
});
