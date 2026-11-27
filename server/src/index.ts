import { Hono, type Context, type MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { pairedPage, errorPage } from "./pages";
import { YtError, chatPage, errorStatus, findLive, type YtEnv } from "./youtube";

export interface Env extends YtEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  /** secret: comma separated Discord user ids that may log in */
  ALLOWED_DISCORD_IDS?: string;
  STORAGE_CAP_BYTES: string;
  /** "1" enables /auth/dev for local testing. never set in production */
  DEV_LOGIN?: string;
}

interface User {
  id: string;
  name: string;
  avatar: string | null;
}

interface Device {
  id: string;
  user_id: string;
  name: string;
}

type Vars = { user: User; device: Device };
type App = { Bindings: Env; Variables: Vars };
type Ctx = Context<App>;

const SESSION_COOKIE = "cl_session";
const STATE_COOKIE = "cl_oauth_state";
const PAIR_COOKIE = "cl_pair";
const SESSION_DAYS = 30;
/** R2 parts must all be the same size (except the last); 50 MB stays under the Workers body limit */
const PART_SIZE = 50 * 1024 * 1024;
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
const APP_SCHEME = "carollive://paired";

const app = new Hono<App>();

// ------------------------------------------------------------------ helpers

const now = () => Date.now();
const id = () => crypto.randomUUID();

function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function secure(c: Ctx): boolean {
  return new URL(c.req.url).protocol === "https:";
}

function cleanDeviceName(raw: string | undefined | null): string | null {
  const name = (raw ?? "").trim().replace(/[\u0000-\u001f/\\]/g, "").slice(0, 40);
  return name.length ? name : null;
}

/** keep R2 keys readable but safe */
function keyPart(text: string): string {
  return text.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 60) || "device";
}

function storageCap(env: Env): number {
  const n = Number(env.STORAGE_CAP_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 100 * 1024 ** 3;
}

async function createSession(c: Ctx, user: User) {
  const sid = randomToken();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sid, user.id, now() + SESSION_DAYS * 86400_000)
    .run();
  setCookie(c, SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: secure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

async function sessionUser(c: Ctx): Promise<User | null> {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) return null;
  return c.env.DB.prepare(
    `SELECT u.id, u.name, u.avatar FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(sid, now())
    .first<User>();
}

async function upsertUser(env: Env, user: User) {
  await env.DB.prepare(
    `INSERT INTO users (id, name, avatar, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar`,
  )
    .bind(user.id, user.name, user.avatar, now())
    .run();
}

function allowed(env: Env, discordId: string): boolean {
  return (env.ALLOWED_DISCORD_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(discordId);
}

interface PairRequest {
  name: string;
  /** random value from the app; echoed back so the app only accepts pairings it started */
  nonce: string;
}

function readPair(c: Ctx): PairRequest | null {
  const raw = getCookie(c, PAIR_COOKIE);
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as PairRequest;
    const name = cleanDeviceName(v.name);
    return name && /^[A-Za-z0-9_-]{8,64}$/.test(v.nonce) ? { name, nonce: v.nonce } : null;
  } catch {
    return null;
  }
}

/** creates a device + one-time-visible token and returns the page that hands it to the app */
async function pairDevice(c: Ctx, user: User, { name, nonce }: PairRequest) {
  const token = "cld_" + randomToken();
  await c.env.DB.prepare(
    "INSERT INTO devices (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id(), user.id, name, await sha256(token), now())
    .run();
  const origin = new URL(c.req.url).origin;
  const url =
    `${APP_SCHEME}?token=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}` +
    `&server=${encodeURIComponent(origin)}&nonce=${encodeURIComponent(nonce)}`;
  return c.html(pairedPage(name, url));
}

const requireUser: MiddlewareHandler<App> = async (c, next) => {
  const user = await sessionUser(c);
  if (!user) return c.json({ error: "login required" }, 401);
  c.set("user", user);
  await next();
};

const requireDevice: MiddlewareHandler<App> = async (c, next) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return c.json({ error: "device token required" }, 401);
  const device = await c.env.DB.prepare("SELECT id, user_id, name FROM devices WHERE token_hash = ?")
    .bind(await sha256(token))
    .first<Device>();
  if (!device) return c.json({ error: "unknown device (연결이 끊겼을 수 있음)" }, 401);
  await c.env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(now(), device.id).run();
  c.set("device", device);
  await next();
};

// ------------------------------------------------------------------ auth

app.get("/auth/login", (c) => {
  if (!c.env.DISCORD_CLIENT_ID) return c.html(errorPage("서버에 DISCORD_CLIENT_ID가 설정되지 않음"), 500);
  const state = randomToken(16);
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: secure(c), sameSite: "Lax", path: "/auth", maxAge: 600 });
  const redirect = new URL("/auth/callback", c.req.url).toString();
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", c.env.DISCORD_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "none");
  return c.redirect(url.toString());
});

app.get("/auth/callback", async (c) => {
  const state = c.req.query("state");
  const code = c.req.query("code");
  if (!code || !state || state !== getCookie(c, STATE_COOKIE)) {
    return c.html(errorPage("로그인 요청이 만료됐음. 다시 시도해줘"), 400);
  }
  deleteCookie(c, STATE_COOKIE, { path: "/auth" });

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID,
      client_secret: c.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: new URL("/auth/callback", c.req.url).toString(),
    }),
  });
  if (!tokenRes.ok) return c.html(errorPage("디스코드 로그인 실패"), 502);
  const { access_token } = await tokenRes.json<{ access_token: string }>();
  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) return c.html(errorPage("디스코드 계정 정보를 못 가져옴"), 502);
  const me = await meRes.json<{ id: string; username: string; global_name?: string; avatar?: string }>();

  if (!allowed(c.env, me.id)) {
    return c.html(errorPage(`팀 캐롤 멤버만 쓸 수 있음. 관리자에게 디스코드 ID ${me.id}를 추가해달라고 해줘`), 403);
  }
  const user: User = {
    id: me.id,
    name: me.global_name || me.username,
    avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null,
  };
  await upsertUser(c.env, user);
  await createSession(c, user);

  const pair = readPair(c);
  if (pair) {
    deleteCookie(c, PAIR_COOKIE, { path: "/auth" });
    return pairDevice(c, user, pair);
  }
  return c.redirect("/");
});

/** local testing only: /auth/dev?id=123&name=tester */
app.get("/auth/dev", async (c) => {
  if (c.env.DEV_LOGIN !== "1") return c.notFound();
  const user: User = { id: c.req.query("id") ?? "dev", name: c.req.query("name") ?? "dev", avatar: null };
  await upsertUser(c.env, user);
  await createSession(c, user);
  const pair = readPair(c);
  if (pair) {
    deleteCookie(c, PAIR_COOKIE, { path: "/auth" });
    return pairDevice(c, user, pair);
  }
  return c.redirect("/");
});

/** the app opens this in a browser: log in once, then hand a device token back to the app */
app.get("/auth/device", async (c) => {
  const name = cleanDeviceName(c.req.query("name"));
  const nonce = c.req.query("nonce") ?? "";
  if (!name) return c.html(errorPage("기기 이름이 비어 있음"), 400);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(nonce)) return c.html(errorPage("앱에서 연결하기를 다시 눌러줘"), 400);
  const user = await sessionUser(c);
  if (user) return pairDevice(c, user, { name, nonce });
  setCookie(c, PAIR_COOKIE, encodeURIComponent(JSON.stringify({ name, nonce })), {
    httpOnly: true,
    secure: secure(c),
    sameSite: "Lax",
    path: "/auth",
    maxAge: 600,
  });
  return c.redirect(c.env.DEV_LOGIN === "1" ? "/auth/dev" : "/auth/login");
});

app.post("/auth/logout", async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ web api (session)

app.get("/api/me", requireUser, (c) => c.json(c.get("user")));

app.get("/api/recordings", requireUser, async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT id, device_name, filename, size, status, recorded_at, duration_ms, summary, created_at, completed_at, has_thumb
     FROM recordings WHERE user_id = ? ORDER BY COALESCE(recorded_at, created_at) DESC`,
  )
    .bind(user.id)
    .all();
  const usage = await c.env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS used FROM recordings").first<{ used: number }>();
  return c.json({
    items: results.map((r) => ({ ...r, summary: r.summary ? JSON.parse(r.summary as string) : null })),
    usage: { used: usage?.used ?? 0, cap: storageCap(c.env) },
  });
});

async function ownRecording(c: Ctx) {
  return c.env.DB.prepare("SELECT * FROM recordings WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.get("user").id)
    .first<Record<string, unknown> & { id: string; r2_key: string; filename: string; status: string; upload_id: string | null }>();
}

app.get("/api/recordings/:id", requireUser, async (c) => {
  const rec = await ownRecording(c);
  if (!rec) return c.json({ error: "not found" }, 404);
  const { r2_key, upload_id, ...rest } = rec;
  void r2_key;
  void upload_id;
  // maimai DX NET plays that could belong to this recording (matched to songs on the web)
  const startAt = Number(rest.recorded_at ?? rest.created_at);
  const endAt = startAt + Number(rest.duration_ms ?? 0);
  const { results: plays } = await c.env.DB.prepare(
    `SELECT played_at, track, title, difficulty, achievement, details FROM plays
     WHERE user_id = ? AND played_at BETWEEN ? AND ? ORDER BY played_at, track`,
  )
    .bind(c.get("user").id, startAt - PLAY_WINDOW_BEFORE_MS, endAt + PLAY_WINDOW_AFTER_MS)
    .all();
  return c.json({
    ...rest,
    summary: rest.summary ? JSON.parse(rest.summary as string) : null,
    analysis: rest.analysis ? JSON.parse(rest.analysis as string) : null,
    plays: plays.map((p) => ({ ...p, details: p.details ? JSON.parse(p.details as string) : null })),
  });
});

// ------------------------------------------------------------------ maimai DX NET plays

const PLAY_WINDOW_BEFORE_MS = 5 * 60_000;
const PLAY_WINDOW_AFTER_MS = 10 * 60_000;
const DIFFICULTIES = new Set(["basic", "advanced", "expert", "master", "remaster", "utage"]);

interface PlayIn {
  playedAt?: number;
  track?: number;
  title?: string;
  difficulty?: string;
  achievement?: number;
  details?: Record<string, unknown>;
}

/** import from the bookmarklet (via /import on the web); re-importing the same plays is harmless */
app.post("/api/plays", requireUser, async (c) => {
  const user = c.get("user");
  const body = await c.req
    .json<{ plays?: PlayIn[]; profile?: unknown }>()
    .catch(() => ({}) as { plays?: PlayIn[]; profile?: unknown });
  const list = Array.isArray(body.plays) ? body.plays.slice(0, 200) : [];
  const rows = list.flatMap((p) => {
    const playedAt = Number(p.playedAt);
    const title = typeof p.title === "string" ? p.title.trim().slice(0, 200) : "";
    if (!Number.isFinite(playedAt) || playedAt <= 0 || !title) return [];
    const difficulty = typeof p.difficulty === "string" && DIFFICULTIES.has(p.difficulty) ? p.difficulty : null;
    const achievement = Number.isFinite(Number(p.achievement)) ? Number(p.achievement) : null;
    const track = Number.isInteger(Number(p.track)) ? Number(p.track) : 0;
    const details = p.details && typeof p.details === "object" ? JSON.stringify(p.details).slice(0, 2000) : null;
    return [{ playedAt, track, title, difficulty, achievement, details }];
  });
  if (!rows.length) return c.json({ error: "가져올 플레이 기록이 없음" }, 400);

  const before = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM plays WHERE user_id = ?").bind(user.id).first<{ n: number }>();
  const stmt = c.env.DB.prepare(
    `INSERT INTO plays (user_id, played_at, track, title, difficulty, achievement, details, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, played_at, track, title) DO UPDATE SET
       difficulty = excluded.difficulty, achievement = excluded.achievement, details = excluded.details`,
  );
  const t = now();
  await c.env.DB.batch(rows.map((r) => stmt.bind(user.id, r.playedAt, r.track, r.title, r.difficulty, r.achievement, r.details, t)));
  const after = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM plays WHERE user_id = ?").bind(user.id).first<{ n: number }>();
  const range = rows.reduce((a, r) => ({ from: Math.min(a.from, r.playedAt), to: Math.max(a.to, r.playedAt) }), {
    from: Infinity,
    to: 0,
  });
  // the bookmarklet also reads the player profile (for the legacy shorts layout); keep the latest one
  const profile = cleanProfile(body.profile);
  if (profile) {
    await c.env.DB.prepare(
      `INSERT INTO maimai_profiles (user_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
      .bind(user.id, JSON.stringify(profile), t)
      .run();
  }
  return c.json({
    received: rows.length,
    added: (after?.n ?? 0) - (before?.n ?? 0),
    from: range.from,
    to: range.to,
    profile: !!profile,
  });
});

/** only the fields the profile card draws, each checked (it comes from a page script) */
function cleanProfile(input: unknown): Record<string, string | number> | null {
  if (!input || typeof input !== "object") return null;
  const p = input as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name.trim().slice(0, 32) : "";
  if (!name) return null;
  const out: Record<string, string | number> = { name };
  const int = (key: string, max: number) => {
    const n = Number(p[key]);
    if (p[key] != null && Number.isInteger(n) && n >= 0 && n <= max) out[key] = n;
  };
  int("rating", 99999);
  int("course", 99);
  int("cls", 99);
  int("playCount", 9_999_999);
  int("playCountCurrent", 9_999_999);
  if (typeof p.ratingBase === "string" && /^[a-z_]{1,24}$/.test(p.ratingBase)) out.ratingBase = p.ratingBase;
  if (typeof p.courseImg === "string" && /^course_rank_[0-9A-Za-z]{1,24}$/.test(p.courseImg)) out.courseImg = p.courseImg;
  if (typeof p.classImg === "string" && /^class_rank_s_[0-9A-Za-z]{1,24}$/.test(p.classImg)) out.classImg = p.classImg;
  // the bookmarklet sends the image address, the profile form sends back the stored name
  const icon = typeof p.icon === "string" ? (/img\/Icon\/([0-9a-f]{8,32})\.png/.exec(p.icon)?.[1] ?? /^[0-9a-f]{8,32}$/.exec(p.icon)?.[0]) : undefined;
  if (icon) out.icon = icon;
  return out;
}

/** the profile typed or corrected by hand on the web (the next bookmarklet import replaces it again) */
app.put("/api/maimai/profile", requireUser, async (c) => {
  const profile = cleanProfile(await c.req.json().catch(() => null));
  if (!profile) return c.json({ error: "닉네임은 꼭 있어야 함" }, 400);
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO maimai_profiles (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  )
    .bind(c.get("user").id, JSON.stringify(profile), t)
    .run();
  return c.json({ profile, updatedAt: t });
});

app.get("/api/maimai/profile", requireUser, async (c) => {
  const row = await c.env.DB.prepare("SELECT data, updated_at FROM maimai_profiles WHERE user_id = ?")
    .bind(c.get("user").id)
    .first<{ data: string; updated_at: number }>();
  return c.json({ profile: row ? JSON.parse(row.data) : null, updatedAt: row?.updated_at ?? null });
});

/**
 * maimai DX NET images (jacket, ST/DX badge, rank, FC/sync marks, player icon, dan and class badges) for the shorts cards.
 * The browser can't draw them onto a canvas straight from maimai DX NET (no CORS header), so they pass
 * through here. Only these image paths are allowed, they need no maimai login, and nothing is stored.
 */
const MAIMAI_IMG_BASE = "https://maimaidx-eng.com/maimai-mobile/img/";
const MAIMAI_IMG_PATH =
  /^((Music|Icon)\/[0-9a-f]{8,32}|playlog\/[a-z0-9_]{1,24}|course\/course_rank_[0-9A-Za-z]{1,24}|class\/class_rank_s_[0-9A-Za-z]{1,24}|music_(dx|standard)|diff_[a-z]{1,12})\.png$/;
const MAIMAI_IMG_MAX_BYTES = 2 * 1024 * 1024;

app.get("/api/maimai/img/:dir{[A-Za-z]+}/:file", requireUser, (c) => maimaiImage(c, `${c.req.param("dir")}/${c.req.param("file")}`));
app.get("/api/maimai/img/:file", requireUser, (c) => maimaiImage(c, c.req.param("file")));

async function maimaiImage(c: Ctx, path: string): Promise<Response> {
  if (!MAIMAI_IMG_PATH.test(path)) return c.json({ error: "not found" }, 404);
  const res = await fetch(MAIMAI_IMG_BASE + path, { redirect: "error", cf: { cacheTtl: 86400, cacheEverything: true } }).catch(
    () => null,
  );
  const length = Number(res?.headers.get("Content-Length") ?? 0);
  if (!res?.ok || !(res.headers.get("Content-Type") ?? "").startsWith("image/") || length > MAIMAI_IMG_MAX_BYTES) {
    return c.json({ error: "이미지를 못 받아옴" }, 502);
  }
  return new Response(res.body, {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=604800" },
  });
}

app.delete("/api/recordings/:id", requireUser, async (c) => {
  const rec = await ownRecording(c);
  if (!rec) return c.json({ error: "not found" }, 404);
  await removeRecording(c.env, rec);
  return c.json({ ok: true });
});

/** streams the mp4 with Range support (video player + lossless trimming in the browser) */
app.get("/api/recordings/:id/file", requireUser, async (c) => {
  const rec = await ownRecording(c);
  if (!rec || rec.status !== "ready") return c.json({ error: "not found" }, 404);

  const head = await c.env.BUCKET.head(rec.r2_key);
  if (!head) return c.json({ error: "file missing" }, 404);
  const size = head.size;
  const range = parseRange(c.req.header("Range"), size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const obj = await c.env.BUCKET.get(rec.r2_key, range ? { range } : undefined);
  if (!obj) return c.json({ error: "file missing" }, 404);

  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    ETag: head.httpEtag,
    "Cache-Control": "private, max-age=3600",
  });
  if (c.req.query("download")) {
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(rec.filename)}`);
  }
  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
    headers.set("Content-Length", String(range.length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(obj.body, { status: 200, headers });
});

function parseRange(header: string | undefined, size: number): { offset: number; length: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return "invalid";
  return { offset: start, length: end - start + 1 };
}

app.get("/api/recordings/:id/thumbnail", requireUser, async (c) => {
  const rec = await ownRecording(c);
  if (!rec || !rec.has_thumb) return c.body(null, 404);
  const obj = await c.env.BUCKET.get(`${rec.r2_key}.jpg`);
  if (!obj) return c.body(null, 404);
  return new Response(obj.body, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400", ETag: obj.httpEtag },
  });
});

app.get("/api/devices", requireUser, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, created_at, last_seen_at FROM devices WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(c.get("user").id)
    .all();
  return c.json({ items: results });
});

app.patch("/api/devices/:id", requireUser, async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const name = cleanDeviceName(body.name);
  if (!name) return c.json({ error: "이름이 비어 있음" }, 400);
  const res = await c.env.DB.prepare("UPDATE devices SET name = ? WHERE id = ? AND user_id = ?")
    .bind(name, c.req.param("id"), c.get("user").id)
    .run();
  if (!res.meta.changes) return c.json({ error: "not found" }, 404);
  // keep the folder grouping in sync for existing recordings
  await c.env.DB.prepare("UPDATE recordings SET device_name = ? WHERE device_id = ?").bind(name, c.req.param("id")).run();
  return c.json({ ok: true, name });
});

app.delete("/api/devices/:id", requireUser, async (c) => {
  await c.env.DB.prepare("DELETE FROM devices WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.get("user").id).run();
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ device api (phone)

app.get("/api/device/me", requireDevice, async (c) => {
  const device = c.get("device");
  const user = await c.env.DB.prepare("SELECT id, name FROM users WHERE id = ?").bind(device.user_id).first();
  return c.json({ device: { id: device.id, name: device.name }, user });
});

interface UploadRow {
  id: string;
  r2_key: string;
  upload_id: string | null;
  size: number;
  status: string;
}

async function removeRecording(env: Env, rec: { id: unknown; r2_key: string; status: string; upload_id: string | null }) {
  if (rec.status === "uploading" && rec.upload_id) {
    await env.BUCKET.resumeMultipartUpload(rec.r2_key, rec.upload_id).abort().catch(() => {});
  } else {
    await env.BUCKET.delete([rec.r2_key, `${rec.r2_key}.jpg`]);
  }
  await env.DB.prepare("DELETE FROM recordings WHERE id = ?").bind(rec.id).run();
}

/** abandoned uploads first, then the oldest finished recordings team-wide, until `incoming` fits */
async function makeRoom(env: Env, incoming: number): Promise<{ ok: boolean; deleted: string[] }> {
  const deleted: string[] = [];
  const { results: stale } = await env.DB.prepare(
    "SELECT id, r2_key, upload_id, size, status FROM recordings WHERE status = 'uploading' AND created_at < ?",
  )
    .bind(now() - STALE_UPLOAD_MS)
    .all<UploadRow>();
  for (const r of stale) await removeRecording(env, r);

  const cap = storageCap(env);
  if (incoming > cap) return { ok: false, deleted };
  let used = (await env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS used FROM recordings").first<{ used: number }>())?.used ?? 0;
  while (used + incoming > cap) {
    const oldest = await env.DB.prepare(
      "SELECT id, r2_key, upload_id, size, status, filename FROM recordings WHERE status = 'ready' ORDER BY completed_at ASC LIMIT 1",
    ).first<UploadRow & { filename: string }>();
    if (!oldest) return { ok: false, deleted };
    await removeRecording(env, oldest);
    deleted.push(oldest.filename);
    used -= oldest.size;
  }
  return { ok: true, deleted };
}

app.post("/api/device/uploads", requireDevice, async (c) => {
  const device = c.get("device");
  const body = await c.req.json<{
    filename?: string;
    size?: number;
    recordedAt?: number;
    durationMs?: number;
    summary?: unknown;
    /** android GameActivity.toAnalysisJson: { v, clickDb, clicksPerSecond: base64 } */
    analysis?: { clicksPerSecond?: unknown };
  }>();
  const size = Number(body.size);
  const filename = (body.filename ?? "").replace(/[\\/]/g, "_").slice(0, 120);
  if (!filename.toLowerCase().endsWith(".mp4") || !Number.isFinite(size) || size <= 0) {
    return c.json({ error: "filename(.mp4)과 size가 필요함" }, 400);
  }

  const room = await makeRoom(c.env, size);
  if (!room.ok) return c.json({ error: "저장 한도보다 큰 파일이라 올릴 수 없음" }, 413);

  const recId = id();
  const key = `recordings/${device.user_id}/${keyPart(device.name)}/${recId}_${filename}`;
  const mp = await c.env.BUCKET.createMultipartUpload(key, { httpMetadata: { contentType: "video/mp4" } });
  await c.env.DB.prepare(
    `INSERT INTO recordings (id, user_id, device_id, device_name, r2_key, filename, size, status, upload_id, part_size,
       recorded_at, duration_ms, summary, analysis, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      recId, device.user_id, device.id, device.name, key, filename, size, mp.uploadId, PART_SIZE,
      Number.isFinite(body.recordedAt) ? body.recordedAt : null,
      Number.isFinite(body.durationMs) ? body.durationMs : null,
      body.summary ? JSON.stringify(body.summary).slice(0, 20_000) : null,
      analysisJson(body.analysis),
      now(),
    )
    .run();
  return c.json({ id: recId, partSize: PART_SIZE, parts: Math.ceil(size / PART_SIZE), deleted: room.deleted });
});

/** keep only a well-formed analysis; 1 byte per second, so 12 h is ~58 KB of base64 */
function analysisJson(a: { clicksPerSecond?: unknown } | undefined): string | null {
  if (!a || typeof a.clicksPerSecond !== "string") return null;
  if (a.clicksPerSecond.length > 60_000 || !/^[A-Za-z0-9+/=]*$/.test(a.clicksPerSecond)) return null;
  return JSON.stringify(a);
}

async function deviceUpload(c: Ctx) {
  return c.env.DB.prepare("SELECT id, r2_key, upload_id, size, status FROM recordings WHERE id = ? AND device_id = ?")
    .bind(c.req.param("id"), c.get("device").id)
    .first<UploadRow>();
}

app.put("/api/device/uploads/:id/parts/:n", requireDevice, async (c) => {
  const up = await deviceUpload(c);
  if (!up || up.status !== "uploading" || !up.upload_id) return c.json({ error: "upload not found" }, 404);
  const n = Number(c.req.param("n"));
  if (!Number.isInteger(n) || n < 1 || n > 10000) return c.json({ error: "bad part number" }, 400);
  if (!c.req.raw.body) return c.json({ error: "empty body" }, 400);
  const mp = c.env.BUCKET.resumeMultipartUpload(up.r2_key, up.upload_id);
  const part = await mp.uploadPart(n, c.req.raw.body);
  return c.json({ partNumber: part.partNumber, etag: part.etag });
});

app.post("/api/device/uploads/:id/complete", requireDevice, async (c) => {
  const up = await deviceUpload(c);
  if (!up || up.status !== "uploading" || !up.upload_id) return c.json({ error: "upload not found" }, 404);
  const { parts } = await c.req.json<{ parts: R2UploadedPart[] }>();
  if (!Array.isArray(parts) || !parts.length) return c.json({ error: "parts required" }, 400);
  const mp = c.env.BUCKET.resumeMultipartUpload(up.r2_key, up.upload_id);
  const obj = await mp.complete(parts.sort((a, b) => a.partNumber - b.partNumber));
  await c.env.DB.prepare(
    "UPDATE recordings SET status = 'ready', upload_id = NULL, size = ?, completed_at = ? WHERE id = ?",
  )
    .bind(obj.size, now(), up.id)
    .run();
  return c.json({ ok: true, id: up.id, size: obj.size });
});

app.put("/api/device/recordings/:id/thumbnail", requireDevice, async (c) => {
  const rec = await c.env.DB.prepare("SELECT id, r2_key FROM recordings WHERE id = ? AND device_id = ? AND status = 'ready'")
    .bind(c.req.param("id"), c.get("device").id)
    .first<{ id: string; r2_key: string }>();
  if (!rec) return c.json({ error: "recording not found" }, 404);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > 1024 * 1024) return c.json({ error: "thumbnail must be under 1MB" }, 400);
  await c.env.BUCKET.put(`${rec.r2_key}.jpg`, body, { httpMetadata: { contentType: "image/jpeg" } });
  await c.env.DB.prepare("UPDATE recordings SET has_thumb = 1 WHERE id = ?").bind(rec.id).run();
  return c.json({ ok: true });
});

app.delete("/api/device/uploads/:id", requireDevice, async (c) => {
  const up = await deviceUpload(c);
  if (up && up.status === "uploading") await removeRecording(c.env, up);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ youtube chat (phone overlay)

function ytFail(c: Ctx, e: unknown) {
  if (e instanceof YtError) return c.json({ error: e.code }, errorStatus(e.code));
  console.error("youtube", e);
  return c.json({ error: "upstream" }, 502);
}

/** ?channel=@handle[&deep=1] -> the broadcast that is live now ({ live:false } while YouTube has not started it) */
app.get("/api/device/youtube/live", requireDevice, async (c) => {
  const channel = c.req.query("channel") ?? "";
  if (!channel.trim()) return c.json({ error: "not_found" }, 404);
  try {
    return c.json(await findLive(c.env, channel, c.req.query("deep") === "1"));
  } catch (e) {
    return ytFail(c, e);
  }
});

/** ?liveChatId=..[&pageToken=..] -> new messages since pageToken */
app.get("/api/device/youtube/chat", requireDevice, async (c) => {
  const liveChatId = c.req.query("liveChatId") ?? "";
  if (!liveChatId) return c.json({ error: "not_found" }, 404);
  try {
    return c.json(await chatPage(c.env, liveChatId, c.req.query("pageToken") || undefined));
  } catch (e) {
    return ytFail(c, e);
  }
});

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

export default app;
