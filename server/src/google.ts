/**
 * A user's own YouTube channel, linked with Google OAuth, so the app can create a broadcast with a title,
 * description, visibility and thumbnail before going live (instead of pushing to a pasted stream key).
 *
 * - The refresh token stays in the worker: encrypted in D1, never sent to the web or the app.
 * - The stream key of the user's reusable stream is not stored either; it is read from YouTube when a
 *   broadcast is created and handed to the app over its authenticated connection, for that session only.
 *
 * Quota (shared 10,000 units/day): liveBroadcasts and liveStreams calls are 1 unit each, channels.list 1,
 * thumbnails.set 50. A broadcast with a thumbnail costs about 55.
 */

export interface GoogleEnv {
  /** OAuth client (type "Web application") of the team's Google Cloud project. Both are worker secrets. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** tests point these at a fake Google */
  GOOGLE_OAUTH_BASE?: string;
  YOUTUBE_API_BASE?: string;
  YOUTUBE_UPLOAD_BASE?: string;
}

/** manage the account's broadcasts, streams and thumbnails */
const SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API_BASE = "https://www.googleapis.com/youtube/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3";
/** name of the stream we create in the user's account, so it is recognisable in YouTube Studio */
const STREAM_TITLE = "carol live";

export type GoogleErrorCode =
  | "not_configured" // the worker has no OAuth client yet
  | "not_linked" // this user has not linked a channel
  | "relink" // the link no longer works (revoked, or expired while the consent screen is in testing)
  | "no_channel" // the Google account has no YouTube channel
  | "live_disabled" // live streaming is not enabled for the channel
  | "quota"
  | "invalid" // YouTube rejected what was sent (title, thumbnail, …)
  | "upstream";

export class GoogleError extends Error {
  constructor(
    public code: GoogleErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}

/** what to tell the person, in the app or on the web */
export function googleErrorMessage(e: GoogleError): string {
  switch (e.code) {
    case "not_configured":
      return "서버에 유튜브 연결 설정이 아직 없습니다";
    case "not_linked":
      return "유튜브 채널이 연결되어 있지 않습니다. 웹의 유튜브 메뉴에서 연결해 주세요";
    case "relink":
      return "유튜브 연결이 만료됐습니다. 웹의 유튜브 메뉴에서 다시 연결해 주세요";
    case "no_channel":
      return "이 구글 계정에는 유튜브 채널이 없습니다";
    case "live_disabled":
      return "이 채널은 라이브 스트리밍이 켜져 있지 않습니다. 유튜브 스튜디오에서 먼저 켜 주세요";
    case "quota":
      return "오늘 유튜브 할당량을 다 썼습니다. 한국 시간 오후 4~5시에 초기화됩니다";
    case "invalid":
      return `유튜브가 요청을 받아들이지 않았습니다 (${e.message})`;
    default:
      return "유튜브에서 응답을 받지 못했습니다. 잠시 뒤 다시 해 주세요";
  }
}

export function googleErrorStatus(code: GoogleErrorCode): 400 | 403 | 409 | 429 | 502 | 503 {
  switch (code) {
    case "not_configured":
      return 503;
    case "not_linked":
    case "relink":
    case "no_channel":
      return 409;
    case "live_disabled":
      return 403;
    case "quota":
      return 429;
    case "invalid":
      return 400;
    default:
      return 502;
  }
}

export const configured = (env: GoogleEnv) => !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;

function client(env: GoogleEnv): { id: string; secret: string } {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new GoogleError("not_configured");
  return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };
}

// ------------------------------------------------------------------ OAuth

/** where to send the browser to ask for consent. Always asks again so that a refresh token comes back. */
export function consentUrl(env: GoogleEnv, redirectUri: string, state: string): string {
  const url = new URL(env.GOOGLE_OAUTH_BASE ? `${env.GOOGLE_OAUTH_BASE}/auth` : AUTH_URL);
  url.searchParams.set("client_id", client(env).id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

async function token(env: GoogleEnv, params: Record<string, string>): Promise<TokenResponse> {
  const c = client(env);
  const res = await fetch(env.GOOGLE_OAUTH_BASE ? `${env.GOOGLE_OAUTH_BASE}/token` : TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (res.ok && body.access_token) return body;
  // the grant is gone: revoked by the user, or expired (7 days while the consent screen is in testing)
  if (body.error === "invalid_grant") throw new GoogleError("relink");
  throw new GoogleError("upstream", `token ${res.status} ${body.error ?? ""}`.trim());
}

/** code from the consent redirect -> tokens. Fails when Google gave no refresh token. */
export async function exchangeCode(env: GoogleEnv, code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken: string }> {
  const t = await token(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
  if (!t.refresh_token) throw new GoogleError("upstream", "no refresh token");
  return { accessToken: t.access_token!, refreshToken: t.refresh_token };
}

export async function accessToken(env: GoogleEnv, refreshToken: string): Promise<string> {
  return (await token(env, { grant_type: "refresh_token", refresh_token: refreshToken })).access_token!;
}

/** best effort: the link is removed on our side whether or not Google answers */
export async function revoke(env: GoogleEnv, refreshToken: string): Promise<void> {
  await fetch(env.GOOGLE_OAUTH_BASE ? `${env.GOOGLE_OAUTH_BASE}/revoke` : REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => undefined);
}

// ------------------------------------------------------------------ refresh token at rest

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

/** The key comes from the client secret: a copy of the database alone cannot read (or use) the tokens. */
async function tokenKey(env: GoogleEnv): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`carol-live:youtube:${client(env).secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealToken(env: GoogleEnv, refreshToken: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(env), new TextEncoder().encode(refreshToken));
  return `${b64(iv)}.${b64(new Uint8Array(data))}`;
}

/** throws "relink" when it cannot be read (for example after the client secret was replaced) */
export async function openToken(env: GoogleEnv, sealed: string): Promise<string> {
  try {
    const [iv, data] = sealed.split(".");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await tokenKey(env), unb64(data));
    return new TextDecoder().decode(plain);
  } catch (e) {
    if (e instanceof GoogleError) throw e;
    throw new GoogleError("relink");
  }
}

// ------------------------------------------------------------------ YouTube API as the user

interface ApiErrorBody {
  error?: { code?: number; message?: string; errors?: { reason?: string; message?: string }[] };
}

function apiError(status: number, body: ApiErrorBody): GoogleError {
  const first = body.error?.errors?.[0];
  const reason = first?.reason ?? "";
  if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded|userRequestsExceedRateLimit/i.test(reason)) return new GoogleError("quota");
  if (/liveStreamingNotEnabled|livePermissionBlocked|insufficientLivePermissions/i.test(reason)) return new GoogleError("live_disabled");
  if (status === 401 || /authError|invalidCredentials/i.test(reason)) return new GoogleError("relink");
  if (status === 400 || status === 403) return new GoogleError("invalid", (first?.message || body.error?.message || reason || `HTTP ${status}`).slice(0, 160));
  return new GoogleError("upstream", `YouTube ${status} ${reason}`.trim());
}

async function yt<T>(
  env: GoogleEnv,
  access: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string>,
  body?: unknown,
): Promise<T> {
  const url = new URL(`${env.YOUTUBE_API_BASE || API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { accept: "application/json", Authorization: `Bearer ${access}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const parsed = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (res.ok) return parsed;
  throw apiError(res.status, parsed);
}

export interface Channel {
  id: string;
  title: string;
}

/** the channel of the account that just consented */
export async function ownChannel(env: GoogleEnv, access: string): Promise<Channel> {
  const r = await yt<{ items?: { id: string; snippet?: { title?: string } }[] }>(env, access, "GET", "channels", { part: "snippet", mine: "true" });
  const c = r.items?.[0];
  if (!c) throw new GoogleError("no_channel");
  return { id: c.id, title: c.snippet?.title ?? c.id };
}

export type Privacy = "public" | "unlisted" | "private";

export interface BroadcastInput {
  title: string;
  description: string;
  privacy: Privacy;
}

export interface Ingest {
  streamId: string;
  /** rtmp://… and rtmps://… addresses to push to, and the stream name (key) that goes after them */
  rtmpUrl: string;
  rtmpsUrl: string | null;
  key: string;
}

interface StreamResource {
  id: string;
  cdn?: { ingestionInfo?: { ingestionAddress?: string; rtmpsIngestionAddress?: string; streamName?: string } };
}

function ingestOf(s: StreamResource): Ingest | null {
  const info = s.cdn?.ingestionInfo;
  if (!info?.ingestionAddress || !info.streamName) return null;
  return { streamId: s.id, rtmpUrl: info.ingestionAddress, rtmpsUrl: info.rtmpsIngestionAddress ?? null, key: info.streamName };
}

/**
 * The user's reusable stream: the one remembered in [streamId] if YouTube still has it, else a new one.
 * One stream serves every broadcast, the way the default stream key does in YouTube Studio.
 */
export async function reusableStream(env: GoogleEnv, access: string, streamId: string | null): Promise<Ingest> {
  if (streamId) {
    const r = await yt<{ items?: StreamResource[] }>(env, access, "GET", "liveStreams", { part: "id,cdn", id: streamId });
    const found = r.items?.[0] && ingestOf(r.items[0]);
    if (found) return found;
  }
  const made = await yt<StreamResource>(
    env,
    access,
    "POST",
    "liveStreams",
    { part: "snippet,cdn,contentDetails" },
    {
      snippet: { title: STREAM_TITLE },
      // "variable": YouTube takes whatever resolution and frame rate the phone sends
      cdn: { ingestionType: "rtmp", resolution: "variable", frameRate: "variable" },
      contentDetails: { isReusable: true },
    },
  );
  const ingest = ingestOf(made);
  if (!ingest) throw new GoogleError("upstream", "stream without ingestion info");
  return ingest;
}

export interface Broadcast {
  id: string;
  liveChatId: string | null;
}

/**
 * Creates the broadcast and binds it to [streamId]. It goes live by itself when the phone starts sending
 * (enableAutoStart). It does not end by itself: a dropped connection at the arcade must not close the
 * broadcast, so the app ends it when the person stops ([endBroadcast]).
 */
export async function createBroadcast(env: GoogleEnv, access: string, input: BroadcastInput, streamId: string): Promise<Broadcast> {
  const made = await yt<{ id: string; snippet?: { liveChatId?: string } }>(
    env,
    access,
    "POST",
    "liveBroadcasts",
    { part: "snippet,status,contentDetails" },
    {
      snippet: {
        title: input.title,
        description: input.description,
        // has to be in the future; the stream starts it as soon as data arrives
        scheduledStartTime: new Date(Date.now() + 30_000).toISOString(),
      },
      status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: false },
      contentDetails: { enableAutoStart: true, enableAutoStop: false, monitorStream: { enableMonitorStream: false } },
    },
  );
  try {
    await yt(env, access, "POST", "liveBroadcasts/bind", { part: "id", id: made.id, streamId });
  } catch (e) {
    // do not leave a broadcast nobody can stream to
    await yt(env, access, "DELETE", "liveBroadcasts", { id: made.id }).catch(() => undefined);
    throw e;
  }
  return { id: made.id, liveChatId: made.snippet?.liveChatId ?? null };
}

/** [type] is image/jpeg or image/png, at most 2 MB (YouTube's limit) */
export async function setThumbnail(env: GoogleEnv, access: string, videoId: string, image: ArrayBuffer, type: string): Promise<void> {
  const url = new URL(`${env.YOUTUBE_UPLOAD_BASE || UPLOAD_BASE}/thumbnails/set`);
  url.searchParams.set("videoId", videoId);
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": type }, body: image });
  if (res.ok) return;
  throw apiError(res.status, (await res.json().catch(() => ({}))) as ApiErrorBody);
}

/**
 * Ends a broadcast the app started: completes it when it is (or was being tested as) live, removes it when
 * it never started. Returns what was done.
 */
export async function endBroadcast(env: GoogleEnv, access: string, id: string): Promise<"completed" | "deleted" | "already"> {
  const r = await yt<{ items?: { status?: { lifeCycleStatus?: string } }[] }>(env, access, "GET", "liveBroadcasts", { part: "status", id });
  const status = r.items?.[0]?.status?.lifeCycleStatus;
  if (!status || status === "complete" || status === "revoked") return "already";
  if (status === "live" || status === "testing" || status === "liveStarting" || status === "testStarting") {
    await yt(env, access, "POST", "liveBroadcasts/transition", { part: "status", id, broadcastStatus: "complete" });
    return "completed";
  }
  await yt(env, access, "DELETE", "liveBroadcasts", { id });
  return "deleted";
}
