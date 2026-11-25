export function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

/** 1:02:03 / 4:05 */
export function clock(seconds: number, withTenths = false): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s / 60) % 60);
  const sec = s % 60;
  const ss = withTenths ? sec.toFixed(1).padStart(4, "0") : String(Math.floor(sec)).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** accepts 75, 1:15, 1:15.5, 0:01:15 */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(":");
  if (!parts.length || parts.length > 3) return null;
  let total = 0;
  for (const p of parts) {
    if (!/^\d+(\.\d+)?$/.test(p)) return null;
    total = total * 60 + Number(p);
  }
  return total;
}

export function dateTime(ms: number | null | undefined): string {
  if (!ms) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function relative(ms: number | null | undefined): string {
  if (!ms) return "아직 없음";
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}
