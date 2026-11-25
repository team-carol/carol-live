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
}

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
