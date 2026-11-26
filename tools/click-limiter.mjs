#!/usr/bin/env node
// Line-by-line port of android/.../ClickLimiter.kt for tuning presets on real recordings.
// Keep the two in sync.
//
//   ffmpeg -i live.m4a -ss 600 -t 60 -f s16le -ac 2 -ar 48000 in.raw
//   node tools/click-limiter.mjs in.raw out.raw STRONG          # or LIGHT, or a JSON params object
//   ffmpeg -f s16le -ac 2 -ar 48000 -i out.raw out.wav
import { readFileSync, writeFileSync } from "node:fs";

export const LEVELS = {
  LIGHT: { marginDb: 12, ratio: 3, makeupDb: 5 },
  STRONG: { marginDb: 10, ratio: 8, makeupDb: 9 },
};
const DEFAULTS = { kneeDb: 6, floorDb: -36, releaseMs: 15, ceilingDb: -1 };

const LOOKAHEAD_MS = 2;
const ATTACK_MS = 0.4;
const BLOCK_MS = 10;
const HISTORY_BLOCKS = 100; // 1 s of blocks for the median reference
const f32 = Math.fround;

export function clickLimiter(sampleRate, channels, params) {
  const p = { ...DEFAULTS, ...params };
  const look = Math.max(1, Math.floor((sampleRate * LOOKAHEAD_MS) / 1000));
  const delay = new Float32Array(look * channels);
  const frame = new Float32Array(channels);
  let pos = 0;
  const attack = f32(Math.exp(-1 / ((sampleRate * ATTACK_MS) / 1000)));
  const release = f32(Math.exp(-1 / ((sampleRate * p.releaseMs) / 1000)));
  const dbToLin = (db) => f32(Math.pow(10, db / 20));
  const makeup = dbToLin(p.makeupDb);
  const ceiling = dbToLin(p.ceilingDb);
  const slope = f32(1 / p.ratio - 1);

  const blockFrames = Math.max(1, Math.floor((sampleRate * BLOCK_MS) / 1000));
  const history = new Float32Array(HISTORY_BLOCKS).fill(p.floorDb);
  const sorted = new Float32Array(HISTORY_BLOCKS);
  let historyPos = 0;
  let blockSum = 0;
  let blockCount = 0;
  let reference = p.floorDb;

  let env = 0;
  let hold = 0;
  let gain = 1;

  const curve = (level) => {
    if (level <= 1e-6) return 1;
    const over = f32(20 * Math.log10(level) - (reference + p.marginDb));
    const knee = p.kneeDb;
    let grDb;
    if (2 * over < -knee) return 1;
    else if (2 * Math.abs(over) <= knee) grDb = (slope * (over + knee / 2) ** 2) / (2 * knee);
    else grDb = slope * over;
    return dbToLin(grDb);
  };

  const endBlock = () => {
    const rms = Math.sqrt(blockSum / (blockCount * channels));
    history[historyPos] = rms > 1e-6 ? f32(20 * Math.log10(rms)) : -120;
    historyPos = historyPos + 1 === HISTORY_BLOCKS ? 0 : historyPos + 1;
    sorted.set(history);
    sorted.sort();
    reference = Math.max(sorted[HISTORY_BLOCKS >> 1], p.floorDb);
    blockSum = 0;
    blockCount = 0;
  };

  /** processes an Int16Array of interleaved samples in place */
  const process = (pcm) => {
    const frames = Math.floor(pcm.length / channels);
    for (let f = 0; f < frames; f++) {
      const base = f * channels;
      let peak = 0;
      for (let c = 0; c < channels; c++) {
        const s = f32(pcm[base + c] / 32768);
        frame[c] = s;
        peak = Math.max(peak, Math.abs(s));
        blockSum += s * s;
      }
      if (++blockCount === blockFrames) endBlock();

      if (peak >= env) {
        env = peak;
        hold = look;
      } else if (hold > 0) {
        hold--;
      } else {
        env = f32(peak + release * (env - peak));
      }
      const target = Math.min(curve(env), env * makeup > ceiling ? f32(ceiling / (env * makeup)) : 1);
      gain = target < gain ? f32(target + attack * (gain - target)) : target;
      const g = f32(gain * makeup);
      for (let c = 0; c < channels; c++) {
        const d = pos * channels + c;
        const y = Math.min(ceiling, Math.max(-ceiling, f32(delay[d] * g)));
        delay[d] = frame[c];
        pcm[base + c] = Math.trunc(y * 32767);
      }
      pos = pos + 1 === look ? 0 : pos + 1;
    }
    return pcm;
  };
  process.reference = () => reference;
  return process;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, output, level = "STRONG", rate = "48000", ch = "2"] = process.argv.slice(2);
  if (!input || !output) {
    console.error("usage: click-limiter.mjs in.raw out.raw [LIGHT|STRONG|<json>] [rate] [channels]");
    process.exit(1);
  }
  const params = LEVELS[level] ?? JSON.parse(level);
  const buf = readFileSync(input);
  const pcm = new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1);
  clickLimiter(Number(rate), Number(ch), params)(pcm);
  writeFileSync(output, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
}
