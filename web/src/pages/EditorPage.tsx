import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Stat, StatGrid, Tag, TextInput } from "@team-carol/design-system/react";
import { api, type Recording } from "../api";
import { bytes, clock, dateTime, parseClock } from "../format";
import { httpReader, trimMp4, type TrimProgress } from "../lib/mp4trim";
import { link } from "../router";

interface Clip {
  name: string;
  url: string;
  size: number;
  duration: number;
}

export function EditorPage({ id }: { id: string }) {
  const [rec, setRec] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [now, setNow] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [startText, setStartText] = useState("0:00.0");
  const [endText, setEndText] = useState("0:00.0");
  const [busy, setBusy] = useState<TrimProgress | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const previewUntil = useRef<number | null>(null);

  useEffect(() => {
    api.recording(id).then(setRec).catch((e) => setError(e.message));
  }, [id]);

  // release blob urls only when leaving the page
  const clipsRef = useRef<Clip[]>([]);
  clipsRef.current = clips;
  useEffect(() => () => clipsRef.current.forEach((c) => URL.revokeObjectURL(c.url)), []);

  const setIn = useCallback((t: number) => {
    setStart(t);
    setStartText(clock(t, true));
  }, []);
  const setOut = useCallback((t: number) => {
    setEnd(t);
    setEndText(clock(t, true));
  }, []);

  // keyboard: I / O mark, space play/pause, ←/→ 1s (shift = 5s)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = video.current;
      if (!v || (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "i" || e.key === "I") setIn(v.currentTime);
      else if (e.key === "o" || e.key === "O") setOut(v.currentTime);
      else if (e.key === " ") {
        e.preventDefault();
        if (v.paused) v.play();
        else v.pause();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = (e.shiftKey ? 5 : 1) * (e.key === "ArrowLeft" ? -1 : 1);
        v.currentTime = Math.min(duration, Math.max(0, v.currentTime + step));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration, setIn, setOut]);

  const onLoaded = () => {
    const d = video.current?.duration ?? 0;
    setDuration(d);
    setIn(0);
    setOut(d);
  };

  const onTime = () => {
    const v = video.current;
    if (!v) return;
    setNow(v.currentTime);
    if (previewUntil.current !== null && v.currentTime >= previewUntil.current) {
      v.pause();
      previewUntil.current = null;
    }
  };

  const preview = () => {
    const v = video.current;
    if (!v) return;
    v.currentTime = start;
    previewUntil.current = end;
    v.play();
  };

  const seekBar = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - box.left) / box.width) * duration;
    if (video.current) video.current.currentTime = t;
  };

  const valid = end > start + 0.1;

  const cut = async () => {
    if (!rec || !valid) return;
    setError(null);
    setBusy({ phase: "index", loaded: 0, total: 1 });
    try {
      const reader = await httpReader(api.fileUrl(rec.id), { credentials: "same-origin" });
      const res = await trimMp4(reader, start, end, setBusy);
      const base = rec.filename.replace(/\.mp4$/i, "");
      const name = `${base}_${clock(start).replace(/:/g, "-")}~${clock(end).replace(/:/g, "-")}.mp4`;
      const url = URL.createObjectURL(res.blob);
      setClips((c) => [{ name, url, size: res.blob.size, duration: res.duration }, ...c]);
      // start the download right away
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (error && !rec) return <p className="crl-helper crl-helper--error">{error}</p>;
  if (!rec) return <p className="caption-muted">불러오는 중…</p>;

  const s = rec.summary;
  const pct = (t: number) => (duration ? `${(t / duration) * 100}%` : "0%");
  const progressText =
    busy &&
    (busy.phase === "index"
      ? "영상 정보 읽는 중…"
      : busy.phase === "download"
        ? `필요한 구간만 받는 중… ${bytes(busy.loaded)} / ${bytes(busy.total)}`
        : "파일 만드는 중…");

  return (
    <>
      <header className="page-head">
        <a className="crl-caption" {...link("/")}>
          ← 녹화 목록
        </a>
        <h1 className="crl-heading-2">{dateTime(rec.recorded_at ?? rec.created_at)}</h1>
        <p className="crl-body-sm">
          {rec.device_name} · {bytes(rec.size)}
        </p>
      </header>

      <div className="editor">
        <div className="editor__player">
          <video
            ref={video}
            src={api.fileUrl(rec.id)}
            controls
            preload="metadata"
            playsInline
            onLoadedMetadata={onLoaded}
            onTimeUpdate={onTime}
          />

          <div className="timeline" onClick={seekBar} role="presentation">
            <div className="timeline__range" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
            <div className="timeline__head" style={{ left: pct(now) }} />
          </div>
          <div className="timeline__labels crl-caption">
            <span>{clock(now, true)}</span>
            <span>{clock(duration)}</span>
          </div>
        </div>

        <Card className="editor__panel">
          <h2 className="crl-card__title">구간 자르기</h2>
          <p className="crl-card__body">
            재인코딩 없이 원본 화질 그대로 잘라서 받음. 필요한 부분만 내려받아서 1시간짜리도 금방 끝남.
          </p>

          <div className="mark-row">
            <TextInput
              label="시작"
              value={startText}
              onChange={(e) => setStartText(e.target.value)}
              onBlur={() => {
                const t = parseClock(startText);
                if (t !== null) setIn(Math.min(t, duration));
                else setStartText(clock(start, true));
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => video.current && setIn(video.current.currentTime)}>
              현재 위치 (I)
            </Button>
          </div>
          <div className="mark-row">
            <TextInput
              label="끝"
              value={endText}
              error={valid ? undefined : "끝이 시작보다 뒤여야 함"}
              onChange={(e) => setEndText(e.target.value)}
              onBlur={() => {
                const t = parseClock(endText);
                if (t !== null) setOut(Math.min(t, duration));
                else setEndText(clock(end, true));
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => video.current && setOut(video.current.currentTime)}>
              현재 위치 (O)
            </Button>
          </div>

          <p className="crl-caption clip-len">클립 길이 {clock(Math.max(0, end - start), true)}</p>

          <div className="panel-actions">
            <Button variant="secondary" onClick={preview} disabled={!valid}>
              구간 미리보기
            </Button>
            <Button variant="primary" onClick={cut} disabled={!valid || !!busy}>
              {busy ? "만드는 중…" : "잘라서 받기"}
            </Button>
          </div>
          {progressText && <p className="crl-helper">{progressText}</p>}
          {error && <p className="crl-helper crl-helper--error">{error}</p>}
          <p className="crl-helper">단축키: I 시작 · O 끝 · Space 재생 · ←/→ 1초 (Shift 5초)</p>
        </Card>
      </div>

      {clips.length > 0 && (
        <section className="folder">
          <h2 className="folder__title">이번에 자른 클립</h2>
          <div className="rec-list">
            {clips.map((c) => (
              <Card key={c.url} as="article" className="rec">
                <div className="rec__main">
                  <div className="rec__title">
                    <span className="rec__date">{c.name}</span>
                    <Tag tone="success">완료</Tag>
                  </div>
                  <div className="rec__meta crl-caption">
                    {clock(c.duration, true)} · {bytes(c.size)}
                  </div>
                </div>
                <div className="rec__actions">
                  <Button variant="secondary" size="sm" href={c.url} download={c.name}>
                    다시 받기
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {s && (
        <Card className="summary">
          <h2 className="crl-card__title">방송 요약</h2>
          <StatGrid className="summary__grid">
            <Stat label="길이" value={s.durationMs ? clock(s.durationMs / 1000) : "-"} />
            <Stat label="화질" value={s.resolution ? `${s.resolution}${s.fps ?? ""}` : "-"} />
            <Stat label="평균 송출" value={s.avgSentKbps ? `${(s.avgSentKbps / 1000).toFixed(1)}M` : "-"} />
            <Stat label="평균 FPS" value={s.avgFps ? s.avgFps.toFixed(1) : "-"} />
            <Stat label="재연결" value={`${s.reconnects ?? 0}회`} />
            <Stat label="최고 온도" value={s.maxTempC ? `${Math.round(s.maxTempC)}°C` : "-"} />
            <Stat
              label="배터리"
              value={s.batteryStart != null && s.batteryEnd != null ? `${s.batteryStart}→${s.batteryEnd}%` : "-"}
            />
          </StatGrid>
          {s.mic && <p className="crl-helper summary__mic">마이크 {s.mic}</p>}
        </Card>
      )}
    </>
  );
}
