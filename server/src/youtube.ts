/**
 * YouTube Data API v3 proxy for the phone's live chat overlay.
 * The API key stays in the worker (secret YOUTUBE_API_KEY); the app only talks to /api/device/youtube/*.
 *
 * Quota (default 10,000 units/day, shared by the team):
 *   channels.list 1 (cached a day), playlistItems.list 1, videos.list 1, search.list 1 (max 100 calls/day),
 *   liveChatMessages.list 5 per poll -> the app slows its polling when chat is quiet.
 */

export interface YtEnv {
  YOUTUBE_API_KEY?: string;
  /** tests point this at a fake API */
  YOUTUBE_API_BASE?: string;
}

export type YtErrorCode = "no_key" | "quota" | "too_fast" | "not_found" | "chat_ended" | "chat_disabled" | "upstream";

export class YtError extends Error {
  constructor(
    public code: YtErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}

const DEFAULT_BASE = "https://www.googleapis.com/youtube/v3";

interface ApiErrorBody {
  error?: { code?: number; message?: string; errors?: { reason?: string }[] };
}

async function call<T>(env: YtEnv, path: string, params: Record<string, string | undefined>): Promise<T> {
  if (!env.YOUTUBE_API_KEY) throw new YtError("no_key");
  const url = new URL(`${env.YOUTUBE_API_BASE || DEFAULT_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, v);
  url.searchParams.set("key", env.YOUTUBE_API_KEY);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (res.ok) return body;

  const reason = body.error?.errors?.[0]?.reason ?? "";
  if (/quotaExceeded|dailyLimitExceeded/i.test(reason)) throw new YtError("quota");
  if (/rateLimitExceeded/i.test(reason)) throw new YtError("too_fast");
  if (/liveChatEnded|liveChatNotFound/i.test(reason)) throw new YtError("chat_ended");
  if (/liveChatDisabled/i.test(reason)) throw new YtError("chat_disabled");
  if (res.status === 404) throw new YtError("not_found");
  throw new YtError("upstream", `YouTube ${res.status} ${reason}`.trim());
}

// ------------------------------------------------------------------ channel

/**
 * "@handle", "handle", "https://www.youtube.com/@handle/live", "UC..." or a /channel/UC... URL
 * -> { handle } or { id }
 */
export function parseChannel(raw: string): { id: string } | { handle: string } | null {
  let s = raw.trim();
  if (!s) return null;
  const url = /^https?:\/\//i.test(s) ? safeUrl(s) : null;
  if (url) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "channel" && parts[1]) s = parts[1];
    else if (parts[0]?.startsWith("@")) s = parts[0];
    else return null;
  }
  s = decodeURIComponent(s);
  if (/^UC[\w-]{22}$/.test(s)) return { id: s };
  const handle = s.startsWith("@") ? s : `@${s}`;
  // handles: letters/digits (any script), _ - . ; 3-30 chars
  if (!/^@[\p{L}\p{N}._-]{3,30}$/u.test(handle)) return null;
  return { handle };
}

function safeUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T | null>): Promise<T | null> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const req = new Request(`https://cache.carol-live.internal/${encodeURIComponent(key)}`);
  if (cache) {
    const hit = await cache.match(req);
    if (hit) return (await hit.json()) as T;
  }
  const value = await load();
  if (value !== null && cache) {
    await cache.put(req, new Response(JSON.stringify(value), { headers: { "cache-control": `max-age=${ttlSeconds}` } }));
  }
  return value;
}

export async function channelId(env: YtEnv, raw: string): Promise<string> {
  const parsed = parseChannel(raw);
  if (!parsed) throw new YtError("not_found", "channel");
  if ("id" in parsed) return parsed.id;
  const id = await cached(`yt-channel:${parsed.handle.toLowerCase()}`, 24 * 3600, async () => {
    const r = await call<{ items?: { id: string }[] }>(env, "channels", { part: "id", forHandle: parsed.handle });
    return r.items?.[0]?.id ?? null;
  });
  if (!id) throw new YtError("not_found", "channel");
  return id;
}

// ------------------------------------------------------------------ live video

interface VideoItem {
  id: string;
  snippet?: { title?: string; liveBroadcastContent?: string };
  liveStreamingDetails?: { activeLiveChatId?: string; actualStartTime?: string; actualEndTime?: string };
}

export interface LiveInfo {
  live: boolean;
  channelId: string;
  videoId?: string;
  liveChatId?: string;
  title?: string;
}

async function liveAmong(env: YtEnv, ids: string[]): Promise<VideoItem | null> {
  if (!ids.length) return null;
  const r = await call<{ items?: VideoItem[] }>(env, "videos", { part: "snippet,liveStreamingDetails", id: ids.join(",") });
  return (
    r.items?.find(
      (v) =>
        v.liveStreamingDetails?.activeLiveChatId &&
        v.liveStreamingDetails.actualStartTime &&
        !v.liveStreamingDetails.actualEndTime,
    ) ?? null
  );
}

/**
 * The broadcast that is live on the channel right now.
 * Recent uploads first (a running live shows up there, 2 units); search.list only as a fallback
 * because it is capped at 100 calls a day.
 */
export async function findLive(env: YtEnv, channel: string, deep: boolean): Promise<LiveInfo> {
  const cid = await channelId(env, channel);
  const uploads = `UU${cid.slice(2)}`;
  const recent = await call<{ items?: { contentDetails?: { videoId?: string } }[] }>(env, "playlistItems", {
    part: "contentDetails",
    playlistId: uploads,
    maxResults: "5",
  }).catch((e) => {
    // a brand-new channel has no uploads playlist yet
    if (e instanceof YtError && e.code === "not_found") return { items: [] };
    throw e;
  });
  let video = await liveAmong(env, (recent.items ?? []).map((i) => i.contentDetails?.videoId ?? "").filter(Boolean));

  if (!video && deep) {
    const s = await call<{ items?: { id?: { videoId?: string } }[] }>(env, "search", {
      part: "id",
      channelId: cid,
      eventType: "live",
      type: "video",
      maxResults: "3",
    });
    video = await liveAmong(env, (s.items ?? []).map((i) => i.id?.videoId ?? "").filter(Boolean));
  }

  if (!video) return { live: false, channelId: cid };
  return {
    live: true,
    channelId: cid,
    videoId: video.id,
    liveChatId: video.liveStreamingDetails!.activeLiveChatId!,
    title: video.snippet?.title,
  };
}

// ------------------------------------------------------------------ chat

interface ChatItem {
  id: string;
  snippet?: {
    type?: string;
    displayMessage?: string;
    publishedAt?: string;
    superChatDetails?: { amountDisplayString?: string; userComment?: string };
    superStickerDetails?: { amountDisplayString?: string };
    messageDeletedDetails?: { deletedMessageId?: string };
  };
  authorDetails?: {
    displayName?: string;
    isChatOwner?: boolean;
    isChatModerator?: boolean;
    isChatSponsor?: boolean;
    isVerified?: boolean;
  };
}

export interface ChatMessage {
  id: string;
  /** text | superchat | supersticker | member | deleted */
  type: string;
  author: string;
  text: string;
  amount?: string;
  owner?: boolean;
  mod?: boolean;
  member?: boolean;
  /** for type=deleted: the message to remove */
  target?: string;
  at: number;
}

const TYPE_MAP: Record<string, string> = {
  textMessageEvent: "text",
  superChatEvent: "superchat",
  superStickerEvent: "supersticker",
  newSponsorEvent: "member",
  memberMilestoneChatEvent: "member",
  membershipGiftingEvent: "member",
  giftMembershipReceivedEvent: "member",
  messageDeletedEvent: "deleted",
};

export async function chatPage(
  env: YtEnv,
  liveChatId: string,
  pageToken: string | undefined,
): Promise<{ messages: ChatMessage[]; nextPageToken?: string; pollingIntervalMillis: number; offline: boolean }> {
  const r = await call<{
    items?: ChatItem[];
    nextPageToken?: string;
    pollingIntervalMillis?: number;
    offlineAt?: string;
  }>(env, "liveChat/messages", {
    liveChatId,
    part: "snippet,authorDetails",
    maxResults: "200",
    pageToken,
  });

  const messages: ChatMessage[] = [];
  for (const item of r.items ?? []) {
    const type = TYPE_MAP[item.snippet?.type ?? ""];
    if (!type) continue;
    const a = item.authorDetails ?? {};
    const sn = item.snippet ?? {};
    messages.push({
      id: item.id,
      type,
      author: a.displayName ?? "",
      text: (sn.superChatDetails?.userComment ?? sn.displayMessage ?? "").slice(0, 300),
      amount: sn.superChatDetails?.amountDisplayString ?? sn.superStickerDetails?.amountDisplayString,
      owner: a.isChatOwner || undefined,
      mod: a.isChatModerator || undefined,
      member: a.isChatSponsor || undefined,
      target: sn.messageDeletedDetails?.deletedMessageId,
      at: sn.publishedAt ? Date.parse(sn.publishedAt) : Date.now(),
    });
  }
  return {
    messages,
    nextPageToken: r.nextPageToken,
    pollingIntervalMillis: r.pollingIntervalMillis ?? 5000,
    offline: Boolean(r.offlineAt),
  };
}

export function errorStatus(code: YtErrorCode): 400 | 403 | 404 | 410 | 429 | 502 | 503 {
  switch (code) {
    case "no_key":
      return 503;
    case "quota":
    case "too_fast":
      return 429;
    case "not_found":
      return 404;
    case "chat_ended":
      return 410;
    case "chat_disabled":
      return 403;
    default:
      return 502;
  }
}
