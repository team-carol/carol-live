/**
 * Lossless MP4 trimming that only downloads what it needs.
 *
 * 1. walk the top-level boxes with tiny range reads to find ftyp + moov (moov is at the end of
 *    files written by Android MediaMuxer)
 * 2. parse the sample tables of every video/audio track
 * 3. pick samples: video from the keyframe at/before `start` through the end of the GOP that
 *    covers `end`, audio from `start` to `end`
 * 4. range-fetch just those samples and write a fresh mp4 (no re-encode). Edit lists make the
 *    clip start/end exactly on the requested times even though video has to begin on a keyframe.
 */

export interface RangeReader {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface TrimProgress {
  phase: "index" | "download" | "write";
  loaded: number;
  total: number;
}

interface Box {
  type: string;
  start: number;
  size: number;
  header: number;
}

interface Sample {
  offset: number;
  size: number;
  dts: number;
  delta: number;
  cto: number;
  sync: boolean;
}

interface Track {
  id: number;
  handler: string;
  timescale: number;
  /** media time where presentation starts (from the original edit list) */
  mediaStart: number;
  tkhd: Uint8Array;
  mdhd: Uint8Array;
  hdlr: Uint8Array;
  mediaHeader: Uint8Array;
  dinf: Uint8Array;
  stsd: Uint8Array;
  samples: Sample[];
  hasSyncTable: boolean;
}

interface Movie {
  timescale: number;
  mvhd: Uint8Array;
  tracks: Track[];
}

// ------------------------------------------------------------------------------ reading

const td = new TextDecoder("latin1");

function u32(b: Uint8Array, p: number): number {
  return ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
}

function i32(b: Uint8Array, p: number): number {
  return (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
}

function u64(b: Uint8Array, p: number): number {
  return u32(b, p) * 0x100000000 + u32(b, p + 4);
}

function boxAt(b: Uint8Array, p: number, limit: number): Box {
  let size = u32(b, p);
  const type = td.decode(b.subarray(p + 4, p + 8));
  let header = 8;
  if (size === 1) {
    size = u64(b, p + 8);
    header = 16;
  } else if (size === 0) {
    size = limit - p;
  }
  return { type, start: p, size, header };
}

function children(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    const box = boxAt(b, p, end);
    if (box.size < 8) break;
    out.push(box);
    p += box.size;
  }
  return out;
}

function child(b: Uint8Array, parent: Box, type: string, skip = 0): Box | undefined {
  return children(b, parent.start + parent.header + skip, parent.start + parent.size).find((c) => c.type === type);
}

function must(box: Box | undefined, name: string): Box {
  if (!box) throw new Error(`mp4: ${name} 박스가 없음`);
  return box;
}

function raw(b: Uint8Array, box: Box): Uint8Array {
  return b.slice(box.start, box.start + box.size);
}

/** find ftyp and moov by reading only box headers */
async function locate(reader: RangeReader): Promise<{ ftyp: Uint8Array; moov: Uint8Array }> {
  let p = 0;
  let ftyp: Uint8Array | undefined;
  let moov: Uint8Array | undefined;
  while (p < reader.size && !(ftyp && moov)) {
    const head = await reader.read(p, Math.min(16, reader.size - p));
    const box = boxAt(head, 0, reader.size - p);
    if (box.size < 8) throw new Error("mp4: 박스 구조가 깨져 있음");
    if (box.type === "ftyp") ftyp = await reader.read(p, box.size);
    if (box.type === "moov") moov = await reader.read(p, box.size);
    p += box.size;
  }
  if (!ftyp || !moov) throw new Error("mp4: ftyp/moov를 못 찾음 (녹화가 정상 종료되지 않았을 수 있음)");
  return { ftyp, moov };
}

function parseSamples(b: Uint8Array, stbl: Box): { samples: Sample[]; hasSyncTable: boolean } {
  const fb = (t: string) => child(b, stbl, t);
  const stts = must(fb("stts"), "stts");
  const stsz = must(fb("stsz"), "stsz");
  const stsc = must(fb("stsc"), "stsc");
  const co = fb("co64") ?? must(fb("stco"), "stco");
  const ctts = fb("ctts");
  const stss = fb("stss");

  // sizes
  let q = stsz.start + stsz.header + 4;
  const fixed = u32(b, q);
  const count = u32(b, q + 4);
  q += 8;
  const sizes = new Array<number>(count);
  for (let i = 0; i < count; i++) sizes[i] = fixed || u32(b, q + i * 4);

  // decode times
  const dts = new Array<number>(count);
  const deltas = new Array<number>(count);
  q = stts.start + stts.header + 4;
  let n = u32(b, q);
  q += 4;
  let t = 0;
  let k = 0;
  for (let e = 0; e < n; e++) {
    const c = u32(b, q);
    const d = u32(b, q + 4);
    q += 8;
    for (let j = 0; j < c && k < count; j++, k++) {
      dts[k] = t;
      deltas[k] = d;
      t += d;
    }
  }

  // composition offsets
  const cto = new Array<number>(count).fill(0);
  if (ctts) {
    q = ctts.start + ctts.header + 4;
    n = u32(b, q);
    q += 4;
    k = 0;
    for (let e = 0; e < n; e++) {
      const c = u32(b, q);
      const o = i32(b, q + 4);
      q += 8;
      for (let j = 0; j < c && k < count; j++, k++) cto[k] = o;
    }
  }

  // sync samples
  const sync = new Array<boolean>(count).fill(!stss);
  if (stss) {
    q = stss.start + stss.header + 4;
    n = u32(b, q);
    q += 4;
    for (let e = 0; e < n; e++) sync[u32(b, q + e * 4) - 1] = true;
  }

  // chunk offsets
  const is64 = co.type === "co64";
  q = co.start + co.header + 4;
  const chunks = u32(b, q);
  q += 4;
  const chunkOffsets = new Array<number>(chunks);
  for (let c = 0; c < chunks; c++) chunkOffsets[c] = is64 ? u64(b, q + c * 8) : u32(b, q + c * 4);

  // sample -> chunk
  q = stsc.start + stsc.header + 4;
  n = u32(b, q);
  q += 4;
  const runs: { first: number; per: number }[] = [];
  for (let e = 0; e < n; e++) runs.push({ first: u32(b, q + e * 12), per: u32(b, q + e * 12 + 4) });

  const samples: Sample[] = new Array(count);
  let s = 0;
  for (let r = 0; r < runs.length; r++) {
    const lastChunk = r + 1 < runs.length ? runs[r + 1].first - 1 : chunks;
    for (let c = runs[r].first; c <= lastChunk && s < count; c++) {
      let off = chunkOffsets[c - 1];
      for (let j = 0; j < runs[r].per && s < count; j++, s++) {
        samples[s] = { offset: off, size: sizes[s], dts: dts[s], delta: deltas[s], cto: cto[s], sync: sync[s] };
        off += sizes[s];
      }
    }
  }
  return { samples: samples.slice(0, s), hasSyncTable: !!stss };
}

function parseMovie(moovBytes: Uint8Array): Movie {
  const b = moovBytes;
  const moov = boxAt(b, 0, b.length);
  const mvhdBox = must(child(b, moov, "mvhd"), "mvhd");
  const mv = mvhdBox.start + mvhdBox.header;
  const timescale = b[mv] === 1 ? u32(b, mv + 20) : u32(b, mv + 12);

  const tracks: Track[] = [];
  for (const trak of children(b, moov.start + moov.header, moov.size).filter((c) => c.type === "trak")) {
    const tkhd = must(child(b, trak, "tkhd"), "tkhd");
    const mdia = must(child(b, trak, "mdia"), "mdia");
    const mdhd = must(child(b, mdia, "mdhd"), "mdhd");
    const hdlr = must(child(b, mdia, "hdlr"), "hdlr");
    const handler = td.decode(b.subarray(hdlr.start + hdlr.header + 8, hdlr.start + hdlr.header + 12));
    if (handler !== "vide" && handler !== "soun") continue;
    const minf = must(child(b, mdia, "minf"), "minf");
    const mediaHeader = must(child(b, minf, handler === "vide" ? "vmhd" : "smhd"), "vmhd/smhd");
    const dinf = must(child(b, minf, "dinf"), "dinf");
    const stbl = must(child(b, minf, "stbl"), "stbl");
    const stsd = must(child(b, stbl, "stsd"), "stsd");

    const tk = tkhd.start + tkhd.header;
    const id = b[tk] === 1 ? u32(b, tk + 20) : u32(b, tk + 12);
    const md = mdhd.start + mdhd.header;
    const ts = b[md] === 1 ? u32(b, md + 20) : u32(b, md + 12);

    // first non-empty edit = where presentation starts in media time
    let mediaStart = 0;
    const edts = child(b, trak, "edts");
    const elst = edts && child(b, edts, "elst");
    if (elst) {
      const e = elst.start + elst.header;
      const v1 = b[e] === 1;
      const n = u32(b, e + 4);
      let q = e + 8;
      for (let i = 0; i < n; i++) {
        const mt = v1 ? u64(b, q + 8) : i32(b, q + 4);
        const isEmpty = v1 ? u32(b, q + 8) === 0xffffffff && u32(b, q + 12) === 0xffffffff : mt === -1;
        if (!isEmpty) {
          mediaStart = mt;
          break;
        }
        q += v1 ? 20 : 12;
      }
    }

    const { samples, hasSyncTable } = parseSamples(b, stbl);
    tracks.push({
      id,
      handler,
      timescale: ts,
      mediaStart,
      tkhd: raw(b, tkhd),
      mdhd: raw(b, mdhd),
      hdlr: raw(b, hdlr),
      mediaHeader: raw(b, mediaHeader),
      dinf: raw(b, dinf),
      stsd: raw(b, stsd),
      samples,
      hasSyncTable,
    });
  }
  if (!tracks.length) throw new Error("mp4: 영상/소리 트랙이 없음");
  return { timescale, mvhd: raw(b, mvhdBox), tracks };
}

/** duration in seconds, read from moov only */
export async function probeDuration(reader: RangeReader): Promise<number> {
  const { moov } = await locate(reader);
  const movie = parseMovie(moov);
  return Math.max(
    ...movie.tracks.map((t) => {
      const last = t.samples[t.samples.length - 1];
      return last ? (last.dts + last.delta - t.mediaStart) / t.timescale : 0;
    }),
  );
}

// ------------------------------------------------------------------------------ selecting

interface Pick {
  track: Track;
  samples: Sample[];
  /** media time (new timeline) where the edit starts */
  mediaTime: number;
  /** empty time before the track starts, seconds */
  lead: number;
  /** presented length, seconds */
  length: number;
}

const pts = (t: Track, s: Sample) => (s.dts + s.cto - t.mediaStart) / t.timescale;

function pickVideo(t: Track, start: number, end: number): Pick {
  const ss = t.samples;
  // keyframe at or before start
  let k = 0;
  for (let i = 0; i < ss.length; i++) {
    if (!ss[i].sync) continue;
    if (pts(t, ss[i]) <= start + 1e-6) k = i;
    else break;
  }
  // last sample (decode order) whose presentation is before `end`
  let e = k;
  for (let i = k; i < ss.length; i++) if (pts(t, ss[i]) < end) e = i;
  // with reordered frames, finish the GOP so every frame before `end` can be decoded
  const reordered = ss.some((s) => s.cto !== ss[0].cto);
  if (reordered) {
    let g = e + 1;
    while (g < ss.length && !ss[g].sync) g++;
    e = g - 1;
  }
  const samples = ss.slice(k, e + 1);
  const base = samples[0].dts;
  const first = Math.max(start, pts(t, samples[0]));
  // media time (new timeline) that is presented at `first`
  const mediaTime = Math.round(first * t.timescale + t.mediaStart - base);
  return { track: t, samples, mediaTime: Math.max(0, mediaTime), lead: 0, length: Math.max(0, end - first) };
}

function pickAudio(t: Track, start: number, end: number): Pick {
  const samples = t.samples.filter((s) => {
    const p = pts(t, s);
    return p >= start - 1e-6 && p < end;
  });
  if (!samples.length) return { track: t, samples, mediaTime: 0, lead: 0, length: 0 };
  const first = pts(t, samples[0]);
  const last = samples[samples.length - 1];
  const length = pts(t, last) + last.delta / t.timescale - first;
  return { track: t, samples, mediaTime: 0, lead: Math.max(0, first - start), length };
}

// ------------------------------------------------------------------------------ writing

class Writer {
  private parts: number[] = [];
  u8(v: number) {
    this.parts.push(v & 255);
  }
  u16(v: number) {
    this.u8(v >> 8);
    this.u8(v);
  }
  u32(v: number) {
    this.u8(v >>> 24);
    this.u8(v >>> 16);
    this.u8(v >>> 8);
    this.u8(v);
  }
  i32(v: number) {
    this.u32(v >>> 0);
  }
  u64(v: number) {
    this.u32(Math.floor(v / 0x100000000));
    this.u32(v >>> 0);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const len = 8 + payload.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, len);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let p = 8;
  for (const part of payload) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

function fullBox(type: string, version: number, flags: number, body: (w: Writer) => void): Uint8Array {
  const w = new Writer();
  w.u8(version);
  w.u8(flags >> 16);
  w.u16(flags & 0xffff);
  body(w);
  return box(type, w.done());
}

/** rewrite the duration field of mvhd/tkhd/mdhd copies (v0 and v1 layouts) */
function withDuration(src: Uint8Array, kind: "mvhd" | "tkhd" | "mdhd", duration: number): Uint8Array {
  const b = src.slice();
  const dv = new DataView(b.buffer);
  const header = u32(b, 0) === 1 ? 16 : 8;
  const v1 = b[header] === 1;
  const at = header + 4 + (v1 ? 16 : 8) + (kind === "tkhd" ? (v1 ? 8 : 8) : v1 ? 4 : 4);
  if (v1) {
    dv.setUint32(at, Math.floor(duration / 0x100000000));
    dv.setUint32(at + 4, duration >>> 0);
  } else {
    dv.setUint32(at, Math.min(duration, 0xffffffff) >>> 0);
  }
  return b;
}

function elst(movieTs: number, pick: Pick): Uint8Array {
  const entries: { dur: number; media: number }[] = [];
  if (pick.lead > 0.0005) entries.push({ dur: Math.round(pick.lead * movieTs), media: -1 });
  entries.push({ dur: Math.round(pick.length * movieTs), media: pick.mediaTime });
  return box(
    "edts",
    fullBox("elst", 0, 0, (w) => {
      w.u32(entries.length);
      for (const e of entries) {
        w.u32(e.dur);
        w.i32(e.media);
        w.u16(1);
        w.u16(0);
      }
    }),
  );
}

interface ChunkPlan {
  pick: Pick;
  /** sample index ranges per chunk */
  chunks: { from: number; to: number; offset: number }[];
}

function stbl(plan: ChunkPlan): Uint8Array {
  const ss = plan.pick.samples;

  const stts = fullBox("stts", 0, 0, (w) => {
    const runs: [number, number][] = [];
    for (let i = 0; i < ss.length; i++) {
      const d = i + 1 < ss.length ? ss[i + 1].dts - ss[i].dts : ss[i].delta;
      const last = runs[runs.length - 1];
      if (last && last[1] === d) last[0]++;
      else runs.push([1, d]);
    }
    w.u32(runs.length);
    for (const [c, d] of runs) {
      w.u32(c);
      w.u32(d);
    }
  });

  const needCtts = ss.some((s) => s.cto !== 0);
  const ctts = needCtts
    ? fullBox("ctts", ss.some((s) => s.cto < 0) ? 1 : 0, 0, (w) => {
        const runs: [number, number][] = [];
        for (const s of ss) {
          const last = runs[runs.length - 1];
          if (last && last[1] === s.cto) last[0]++;
          else runs.push([1, s.cto]);
        }
        w.u32(runs.length);
        for (const [c, o] of runs) {
          w.u32(c);
          w.i32(o);
        }
      })
    : new Uint8Array();

  const allSync = ss.every((s) => s.sync);
  const stss =
    plan.pick.track.hasSyncTable && !allSync
      ? fullBox("stss", 0, 0, (w) => {
          const idx = ss.map((s, i) => (s.sync ? i + 1 : 0)).filter(Boolean);
          w.u32(idx.length);
          for (const i of idx) w.u32(i);
        })
      : new Uint8Array();

  const stsc = fullBox("stsc", 0, 0, (w) => {
    const runs: [number, number][] = [];
    plan.chunks.forEach((c, i) => {
      const per = c.to - c.from;
      const last = runs[runs.length - 1];
      if (!last || last[1] !== per) runs.push([i + 1, per]);
    });
    w.u32(runs.length);
    for (const [first, per] of runs) {
      w.u32(first);
      w.u32(per);
      w.u32(1);
    }
  });

  const stsz = fullBox("stsz", 0, 0, (w) => {
    w.u32(0);
    w.u32(ss.length);
    for (const s of ss) w.u32(s.size);
  });

  const co64 = fullBox("co64", 0, 0, (w) => {
    w.u32(plan.chunks.length);
    for (const c of plan.chunks) w.u64(c.offset);
  });

  return box("stbl", plan.pick.track.stsd, stts, ctts, stss, stsc, stsz, co64);
}

function trak(movieTs: number, plan: ChunkPlan): Uint8Array {
  const t = plan.pick.track;
  const ss = plan.pick.samples;
  const mediaDur = ss[ss.length - 1].dts - ss[0].dts + ss[ss.length - 1].delta;
  const presented = Math.round((plan.pick.lead + plan.pick.length) * movieTs);
  return box(
    "trak",
    withDuration(t.tkhd, "tkhd", presented),
    elst(movieTs, plan.pick),
    box(
      "mdia",
      withDuration(t.mdhd, "mdhd", mediaDur),
      t.hdlr,
      box("minf", t.mediaHeader, t.dinf, stbl(plan)),
    ),
  );
}

function moov(movie: Movie, plans: ChunkPlan[]): Uint8Array {
  const length = Math.max(...plans.map((p) => p.pick.lead + p.pick.length));
  return box(
    "moov",
    withDuration(movie.mvhd, "mvhd", Math.round(length * movie.timescale)),
    ...plans.map((p) => trak(movie.timescale, p)),
  );
}

/** interleave ~0.5 s chunks of each track so the clip plays smoothly while streaming too */
function planChunks(picks: Pick[]): { plans: ChunkPlan[]; order: { plan: ChunkPlan; chunk: number }[] } {
  const plans: ChunkPlan[] = picks.map((pick) => ({ pick, chunks: [] }));
  const order: { plan: ChunkPlan; chunk: number; time: number }[] = [];
  for (const plan of plans) {
    const t = plan.pick.track;
    const ss = plan.pick.samples;
    let from = 0;
    for (let i = 1; i <= ss.length; i++) {
      const span = i < ss.length ? (ss[i].dts - ss[from].dts) / t.timescale : Infinity;
      if (span >= 0.5) {
        plan.chunks.push({ from, to: i, offset: 0 });
        order.push({ plan, chunk: plan.chunks.length - 1, time: ss[from].dts / t.timescale });
        from = i;
      }
    }
  }
  order.sort((a, b) => a.time - b.time);
  return { plans, order };
}

// ------------------------------------------------------------------------------ public

export interface TrimResult {
  blob: Blob;
  /** actual clip length in seconds */
  duration: number;
  /** bytes downloaded from the source */
  downloaded: number;
}

export async function trimMp4(
  reader: RangeReader,
  start: number,
  end: number,
  onProgress?: (p: TrimProgress) => void,
): Promise<TrimResult> {
  if (!(end > start)) throw new Error("끝 지점이 시작보다 뒤여야 함");
  onProgress?.({ phase: "index", loaded: 0, total: 1 });
  const { ftyp, moov: moovBytes } = await locate(reader);
  const movie = parseMovie(moovBytes);
  onProgress?.({ phase: "index", loaded: 1, total: 1 });

  const picks = movie.tracks
    .map((t) => (t.handler === "vide" ? pickVideo(t, start, end) : pickAudio(t, start, end)))
    .filter((p) => p.samples.length > 0);
  if (!picks.length) throw new Error("선택한 구간에 영상이 없음");

  // 1) download the needed byte ranges, merged when close together
  const wanted = picks.flatMap((p) => p.samples).sort((a, b) => a.offset - b.offset);
  const ranges: { start: number; end: number; data?: Uint8Array }[] = [];
  for (const s of wanted) {
    const last = ranges[ranges.length - 1];
    if (last && s.offset - last.end < 256 * 1024) last.end = Math.max(last.end, s.offset + s.size);
    else ranges.push({ start: s.offset, end: s.offset + s.size });
  }
  const total = ranges.reduce((a, r) => a + (r.end - r.start), 0);
  let loaded = 0;
  // split big ranges so progress moves and requests stay reasonable
  const jobs: { r: (typeof ranges)[number]; from: number; to: number; buf?: Uint8Array }[] = [];
  const PIECE = 8 * 1024 * 1024;
  for (const r of ranges) for (let p = r.start; p < r.end; p += PIECE) jobs.push({ r, from: p, to: Math.min(r.end, p + PIECE) });
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      job.buf = await reader.read(job.from, job.to - job.from);
      loaded += job.to - job.from;
      onProgress?.({ phase: "download", loaded, total });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  for (const r of ranges) {
    const pieces = jobs.filter((j) => j.r === r);
    const data = new Uint8Array(r.end - r.start);
    for (const j of pieces) data.set(j.buf!, j.from - r.start);
    r.data = data;
  }
  const slice = (s: Sample): Uint8Array => {
    // ranges are sorted; binary search the one holding this sample
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ranges[mid].start <= s.offset) lo = mid;
      else hi = mid - 1;
    }
    const r = ranges[lo];
    return r.data!.subarray(s.offset - r.start, s.offset - r.start + s.size);
  };

  // 2) lay out mdat, then patch chunk offsets once moov's size is known
  onProgress?.({ phase: "write", loaded: 0, total: 1 });
  const { plans, order } = planChunks(picks);
  const firstMoov = moov(movie, plans); // co64 has fixed size, so this length is final
  const mdatHeader = 16;
  let pos = ftyp.length + firstMoov.length + mdatHeader;
  const payload: Uint8Array[] = [];
  for (const o of order) {
    const c = o.plan.chunks[o.chunk];
    c.offset = pos;
    for (let i = c.from; i < c.to; i++) {
      const data = slice(o.plan.pick.samples[i]);
      payload.push(data);
      pos += data.length;
    }
  }
  const finalMoov = moov(movie, plans);
  const mdatSize = pos - ftyp.length - finalMoov.length;
  const mdat = new Uint8Array(16);
  const dv = new DataView(mdat.buffer);
  dv.setUint32(0, 1);
  mdat.set([0x6d, 0x64, 0x61, 0x74], 4);
  dv.setUint32(8, Math.floor(mdatSize / 0x100000000));
  dv.setUint32(12, mdatSize >>> 0);

  const blob = new Blob([ftyp, finalMoov, mdat, ...payload] as BlobPart[], { type: "video/mp4" });
  onProgress?.({ phase: "write", loaded: 1, total: 1 });
  return {
    blob,
    duration: Math.max(...picks.map((p) => p.lead + p.length)),
    downloaded: total,
  };
}

/** RangeReader over HTTP (server must support Range) */
export async function httpReader(url: string, init?: RequestInit): Promise<RangeReader> {
  const head = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), Range: "bytes=0-0" } });
  if (head.status !== 206) throw new Error("서버가 Range 요청을 지원하지 않음");
  const cr = head.headers.get("Content-Range") ?? "";
  const size = Number(cr.split("/")[1]);
  await head.arrayBuffer();
  if (!Number.isFinite(size)) throw new Error("파일 크기를 알 수 없음");
  return {
    size,
    async read(offset, length) {
      const res = await fetch(url, {
        ...init,
        headers: { ...(init?.headers ?? {}), Range: `bytes=${offset}-${offset + length - 1}` },
      });
      if (res.status !== 206) throw new Error(`Range 요청 실패 (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
