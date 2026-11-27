import type { Play, PlayDetails } from "./lib/songs";

export interface Me {
  id: string;
  name: string;
  avatar: string | null;
}

/** what the Android app sends after a broadcast (see android LiveSummary) */
export interface LiveSummary {
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  resolution?: string;
  fps?: number;
  targetVideoKbps?: number;
  avgSentKbps?: number;
  minSentKbps?: number;
  avgFps?: number;
  minFps?: number;
  reconnects?: number;
  maxTempC?: number;
  batteryStart?: number;
  batteryEnd?: number;
  mic?: string;
  streamed?: boolean;
}

/** android GameActivity.toAnalysisJson: button clicks per second over the recording */
export interface RecordingAnalysis {
  v: number;
  clickDb?: number;
  clicksPerSecond: string;
}

export interface Recording {
  id: string;
  device_name: string;
  filename: string;
  size: number;
  status: "uploading" | "ready";
  recorded_at: number | null;
  duration_ms: number | null;
  summary: LiveSummary | null;
  created_at: number;
  completed_at: number | null;
  has_thumb?: number;
  /** detail only; null for recordings made before app v0.6 */
  analysis?: RecordingAnalysis | null;
  /** detail only: imported maimai DX NET plays around this recording's time */
  plays?: Play[];
}

/** what the maimai DX NET bookmarklet sends (lib/maimaiScrape.js) */
export interface PlayImport {
  playedAt: number;
  track: number;
  title: string;
  difficulty: string | null;
  achievement: number | null;
  details: PlayDetails;
}

/** maimai DX NET player profile kept on the server (lib/maimaiScrape.js scrapeMaimaiProfile -> /api/plays) */
export interface MaimaiProfile {
  name: string;
  rating?: number;
  /** rating_base_<this>.png on maimai DX NET: normal, blue, …, rainbow, rainbow_kiwami */
  ratingBase?: string;
  trophy?: string;
  trophyRank?: string;
  /** img/Icon/<this>.png */
  icon?: string;
  /** course_rank_<n>: 1 = 初段 … 10 = 十段, 12 = 真初段 … 21 = 真十段, 22 = 真皆伝, 23 = 裏皆伝 */
  course?: number;
  /** class_rank_s_<n>: 0 = B5 … 24 = SSS1, 25 = LEGEND */
  cls?: number;
  stars?: number;
  playCount?: number;
  playCountCurrent?: number;
}

/** the same as it comes from the bookmarklet: the icon is still the full image address */
export type MaimaiProfileImport = MaimaiProfile;

export interface DeviceInfo {
  id: string;
  name: string;
  created_at: number;
  last_seen_at: number | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as { error?: string }).error ?? `요청 실패 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  importPlays: (plays: PlayImport[], profile?: MaimaiProfileImport | null) =>
    call<{ received: number; added: number; from: number; to: number; profile?: boolean }>("/api/plays", {
      method: "POST",
      body: JSON.stringify(profile ? { plays, profile } : { plays }),
    }),
  maimaiProfile: () => call<{ profile: MaimaiProfile | null; updatedAt: number | null }>("/api/maimai/profile"),
  me: () => call<Me>("/api/me"),
  logout: () => call<{ ok: true }>("/auth/logout", { method: "POST" }),
  recordings: () => call<{ items: Recording[]; usage: { used: number; cap: number } }>("/api/recordings"),
  recording: (id: string) => call<Recording>(`/api/recordings/${id}`),
  deleteRecording: (id: string) => call<{ ok: true }>(`/api/recordings/${id}`, { method: "DELETE" }),
  devices: () => call<{ items: DeviceInfo[] }>("/api/devices"),
  renameDevice: (id: string, name: string) =>
    call<{ ok: true; name: string }>(`/api/devices/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  removeDevice: (id: string) => call<{ ok: true }>(`/api/devices/${id}`, { method: "DELETE" }),
  fileUrl: (id: string) => `/api/recordings/${id}/file`,
  thumbUrl: (id: string) => `/api/recordings/${id}/thumbnail`,
  downloadUrl: (id: string) => `/api/recordings/${id}/file?download=1`,
};
