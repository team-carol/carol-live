import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Stat, StatGrid, Tag, TextArea, TextInput } from "@team-carol/design-system/react";
import { api, type Recording } from "../api";
import { bytes, clock, dateTime, parseClock } from "../format";
import { httpReader, trimMp4, type TrimProgress } from "../lib/mp4trim";
import { decodeCounts, findSongs, matchPlays, type Song } from "../lib/songs";
import { youtubeChapters } from "../lib/chapters";
import { achievementText, difficultyLabel, difficultyStyle, marks, playFilePart, rankColor, rankLabel } from "../lib/maimai";
import { link } from "../router";
import { ShortsCard } from "./ShortsCard";

interface Clip {
  name: string;
  url: string;
  size: number;
  duration: number;
}

/** a song clip starts a little before the first dense notes and ends a little after the last */
const PAD_BEFORE = 5;
const PAD_AFTER = 5;
const NUDGES = [-5, -1, 1, 5];

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
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [shortsFor, setShortsFor] = useState<number | null>(null);
  const [shortsBusy, setShortsBusy] = useState(false);
  const previewUntil = useRef<number | null>(null);

  useEffect(() => {
    api.recording(id).then(setRec).catch((e) => setError(e.message));
  }, [id]);

  // release blob urls only when leaving the page
  const clipsRef = useRef<Clip[]>([]);
  clipsRef.current = clips;
  useEffect(() => () => clipsRef.current.forEach((c) => URL.revokeObjectURL(c.url)), []);

  const counts = useMemo(() => (rec?.analysis ? decodeCounts(rec.analysis.clicksPerSecond) : null), [rec]);
  const songs: Song[] = useMemo(() => {
    if (!rec || !counts) return [];
    const found = findSongs(counts);
    return matchPlays(found, rec.plays ?? [], rec.recorded_at ?? rec.created_at).songs;
  }, [rec, counts]);

  const setIn = useCallback((t: number) => {
    setStart(t);
    setStartText(clock(t, true));
  }, []);
  const setOut = useCallback((t: number) => {
    setEnd(t);
    setEndText(clock(t, true));
  }, []);

  const seek = useCallback(
    (t: number, play = false) => {
      const v = video.current;
      if (!v) return;
      v.currentTime = Math.min(duration || t, Math.max(0, t));
      if (play) v.play();
    },
    [duration],
  );

  const songRange = useCallback(
    (s: Song) => ({ from: Math.max(0, s.start - PAD_BEFORE), to: Math.min(duration || s.end + PAD_AFTER, s.end + PAD_AFTER) }),
    [duration],
  );

  const pickSong = (i: number, play = false) => {
    const r = songRange(songs[i]);
    setPicked(i);
    setIn(r.from);
    setOut(r.to);
    seek(r.from, play);
  };

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
    seek(start, true);
    previewUntil.current = end;
  };

  const seekBar = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - box.left) / box.width) * duration);
  };

  const nudge = (which: "start" | "end", by: number) => {
    if (which === "start") {
      const t = Math.min(end - 0.1, Math.max(0, start + by));
      setIn(t);
      seek(t);
    } else {
      const t = Math.max(start + 0.1, Math.min(duration, end + by));
      setOut(t);
      seek(Math.max(start, t - 3));
    }
  };

  const valid = end > start + 0.1;

  const download = async (from: number, to: number, name: string) => {
    if (!rec) return;
    setError(null);
    setBusyLabel(name);
    setBusy({ phase: "index", loaded: 0, total: 1 });
    try {
      const reader = await httpReader(api.fileUrl(rec.id), { credentials: "same-origin" });
      const res = await trimMp4(reader, from, to, setBusy);
      const url = URL.createObjectURL(res.blob);
      setClips((c) => [{ name, url, size: res.blob.size, duration: res.duration }, ...c]);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setBusyLabel(null);
    }
  };

  const base = rec ? rec.filename.replace(/\.mp4$/i, "") : "";
  const rangeName = (from: number, to: number) =>
    `${base}_${clock(from).replace(/:/g, "-")}~${clock(to).replace(/:/g, "-")}.mp4`;
  const songName = (s: Song, i: number) =>
    s.play ? `${base}_${String(i + 1).padStart(2, "0")}_${playFilePart(s.play)}.mp4` : `${base}_곡${i + 1}.mp4`;

  const cut = () => {
    if (!valid) return;
    const i = picked;
    const r = i !== null ? songRange(songs[i]) : null;
    // still exactly the picked song's range -> name it after the song
    const name = r && Math.abs(r.from - start) < 0.05 && Math.abs(r.to - end) < 0.05 ? songName(songs[i!], i!) : rangeName(start, end);
    download(start, end, name);
  };

  if (error && !rec) return <p className="crl-helper crl-helper--error">{error}</p>;
  if (!rec) return <p className="caption-muted">불러오는 중…</p>;

  const s = rec.summary;
  const pct = (t: number) => (duration ? `${(t / duration) * 100}%` : "0%");
  const progressText =
    busy &&
    `${busyLabel ? `${busyLabel} · ` : ""}${
      busy.phase === "index"
        ? "영상 정보 읽는 중…"
        : busy.phase === "download"
          ? `필요한 구간만 받는 중… ${bytes(busy.loaded)} / ${bytes(busy.total)}`
          : "파일 만드는 중…"
    }`;
  const named = songs.filter((x) => x.play).length;

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
            {counts && duration > 0 && <Activity counts={counts} duration={duration} />}
            {duration > 0 &&
              songs.map((x, i) => (
                <div
                  key={x.start}
                  className={`timeline__song${picked === i ? " is-picked" : ""}`}
                  style={{ left: pct(x.start), width: `calc(${pct(x.end)} - ${pct(x.start)})` }}
                />
              ))}
            <div className="timeline__range" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
            <div className="timeline__head" style={{ left: pct(now) }} />
          </div>
          <div className="timeline__labels crl-caption">
            <span>{clock(now, true)}</span>
            <span>{clock(duration)}</span>
          </div>
        </div>

        <div className="editor__side">
          <Card className="songs">
            <div className="songs__head">
              <h2 className="crl-card__title">곡</h2>
              {songs.length > 0 && (
                <span className="crl-caption">
                  {songs.length}곡{named ? ` · 곡명 ${named}` : ""}
                </span>
              )}
            </div>
            {!counts && (
              <p className="crl-card__body">
                곡 구간 정보가 없는 녹화임. 앱 v0.6부터 녹화하면서 버튼 소리로 곡을 나눠둠.
              </p>
            )}
            {counts && songs.length === 0 && (
              <p className="crl-card__body">플레이한 구간을 못 찾았음. 아래에서 직접 잘라줘.</p>
            )}
            {songs.length > 0 && (
              <ol className="songs__list">
                {songs.map((x, i) => (
                  <li key={x.start} className={`song${picked === i ? " is-picked" : ""}`}>
                    <button type="button" className="song__main" onClick={() => pickSong(i)}>
                      <span className="song__no">{i + 1}</span>
                      <span className="song__text">
                        <span className="song__title">
                          {x.play ? x.play.title : `곡 ${i + 1}`}
                          {x.play?.difficulty && (
                            <span className="song__diff" style={difficultyStyle(x.play.difficulty)}>
                              {difficultyLabel(x.play.difficulty)}
                              {x.play.details?.level ? ` ${x.play.details.level}` : ""}
                            </span>
                          )}
                        </span>
                        <span className="song__meta crl-caption">
                          {clock(x.start)}~{clock(x.end)} · {clock(x.end - x.start)}
                          {x.play?.achievement != null && (
                            <>
                              {" · "}
                              <span style={{ color: rankColor(x.play.details?.rank) }}>
                                {achievementText(x.play.achievement)} {rankLabel(x.play.details?.rank)}
                              </span>
                            </>
                          )}
                          {x.play &&
                            marks(x.play).map((m) => (
                              <span key={m.label} className="song__mark" style={{ color: m.color }}>
                                {m.label}
                              </span>
                            ))}
                        </span>
                      </span>
                    </button>
                    <div className="song__actions">
                      <Button variant="secondary" size="sm" onClick={() => pickSong(i, true)} aria-label={`${i + 1}번 곡 재생`}>
                        재생
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!!busy || shortsBusy}
                        onClick={() => {
                          const r = songRange(x);
                          setPicked(i);
                          setIn(r.from);
                          setOut(r.to);
                          download(r.from, r.to, songName(x, i));
                        }}
                      >
                        받기
                      </Button>
                      {x.play && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={shortsBusy}
                          onClick={() => {
                            pickSong(i);
                            setShortsFor(i);
                          }}
                          aria-label={`${i + 1}번 곡 쇼츠 만들기`}
                        >
                          쇼츠
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {counts && songs.length > 0 && named === 0 && (
              <p className="crl-helper">
                곡 이름은 <a {...link("/maimai")}>maimai DX NET 기록</a>을 가져오면 붙음.
              </p>
            )}
          </Card>

          {shortsFor !== null && songs[shortsFor]?.play && (
            <ShortsCard
              play={songs[shortsFor].play}
              video={video}
              fileUrl={api.fileUrl(rec.id)}
              from={start}
              to={end}
              name={songName(songs[shortsFor], shortsFor).replace(/\.mp4$/, "_shorts.mp4")}
              disabled={!!busy || !valid}
              onBusy={setShortsBusy}
              onDone={(c) => setClips((list) => [c, ...list])}
              onClose={() => setShortsFor(null)}
            />
          )}

          {songs.length > 0 && <ChaptersCard rec={rec} songs={songs} />}

          <Card className="editor__panel">
            <h2 className="crl-card__title">구간 자르기</h2>
            <p className="crl-card__body">재인코딩 없이 원본 화질 그대로, 필요한 부분만 내려받아서 자름.</p>

            <div className="mark">
              <div className="mark-row">
                <TextInput
                  label="시작"
                  value={startText}
                  inputMode="decimal"
                  onChange={(e) => setStartText(e.target.value)}
                  onBlur={() => {
                    const t = parseClock(startText);
                    if (t !== null) setIn(Math.min(t, duration));
                    else setStartText(clock(start, true));
                  }}
                />
                <Button variant="secondary" size="sm" onClick={() => video.current && setIn(video.current.currentTime)}>
                  지금 위치
                </Button>
              </div>
              <div className="nudges" role="group" aria-label="시작 조정">
                {NUDGES.map((n) => (
                  <button key={n} type="button" className="crl-chip nudge" onClick={() => nudge("start", n)}>
                    {n > 0 ? `+${n}` : n}초
                  </button>
                ))}
              </div>
            </div>

            <div className="mark">
              <div className="mark-row">
                <TextInput
                  label="끝"
                  value={endText}
                  inputMode="decimal"
                  error={valid ? undefined : "끝이 시작보다 뒤여야 함"}
                  onChange={(e) => setEndText(e.target.value)}
                  onBlur={() => {
                    const t = parseClock(endText);
                    if (t !== null) setOut(Math.min(t, duration));
                    else setEndText(clock(end, true));
                  }}
                />
                <Button variant="secondary" size="sm" onClick={() => video.current && setOut(video.current.currentTime)}>
                  지금 위치
                </Button>
              </div>
              <div className="nudges" role="group" aria-label="끝 조정">
                {NUDGES.map((n) => (
                  <button key={n} type="button" className="crl-chip nudge" onClick={() => nudge("end", n)}>
                    {n > 0 ? `+${n}` : n}초
                  </button>
                ))}
              </div>
            </div>

            <p className="crl-caption clip-len">클립 길이 {clock(Math.max(0, end - start), true)}</p>

            <div className="panel-actions">
              <Button variant="secondary" onClick={preview} disabled={!valid}>
                구간 미리보기
              </Button>
              <Button variant="primary" onClick={cut} disabled={!valid || !!busy || shortsBusy}>
                {busy ? "만드는 중…" : "잘라서 받기"}
              </Button>
            </div>
            {progressText && <p className="crl-helper">{progressText}</p>}
            {error && <p className="crl-helper crl-helper--error">{error}</p>}
            <p className="crl-helper desktop-only">단축키: I 시작 · O 끝 · Space 재생 · ←/→ 1초 (Shift 5초)</p>
          </Card>
        </div>
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

/** YouTube description chapters, shifted by how far the recording started after the stream */
function ChaptersCard({ rec, songs }: { rec: Recording; songs: Song[] }) {
  const s = rec.summary;
  // YouTube's 0:00 is about when the stream started; the recording usually starts with it
  const initial =
    s?.streamed && s.startedAt && rec.recorded_at ? Math.round((rec.recorded_at - s.startedAt) / 1000) : 0;
  const [offset, setOffset] = useState(initial);
  const [copied, setCopied] = useState(false);
  const { text, ok } = useMemo(() => youtubeChapters(songs, { offset, lead: PAD_BEFORE }), [songs, offset]);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="chapters">
      <h2 className="crl-card__title">유튜브 챕터</h2>
      <TextArea
        label="영상 설명란에 붙여넣기"
        readOnly
        value={text}
        rows={Math.min(10, text.split("\n").length + 1)}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="chapters__offset">
        <span className="crl-caption">유튜브 영상과 시간 차이</span>
        <div className="nudges">
          <button type="button" className="crl-chip nudge" onClick={() => setOffset((o) => o - 1)}>
            -1초
          </button>
          <span className="chapters__value">{offset > 0 ? `+${offset}` : offset}초</span>
          <button type="button" className="crl-chip nudge" onClick={() => setOffset((o) => o + 1)}>
            +1초
          </button>
        </div>
      </div>
      <div className="panel-actions">
        <Button variant="primary" onClick={copy}>
          {copied ? "복사됨" : "챕터 복사"}
        </Button>
      </div>
      {!ok && <p className="crl-helper crl-helper--error">유튜브는 챕터가 3개 이상이어야 인식함</p>}
      <p className="crl-helper">
        유튜브 스튜디오 → 콘텐츠 → 이 방송 → 설명. 곡 시작이 어긋나면 시간 차이를 맞추면 전부 같이 움직임.
      </p>
    </Card>
  );
}

/** clicks per second drawn under the timeline: dense = playing */
function Activity({ counts, duration }: { counts: Uint8Array; duration: number }) {
  const path = useMemo(() => {
    const W = 1000;
    const bins = Math.min(counts.length, 500);
    const per = counts.length / bins;
    let d = `M0 40`;
    for (let b = 0; b < bins; b++) {
      let sum = 0;
      const from = Math.floor(b * per);
      const to = Math.max(from + 1, Math.floor((b + 1) * per));
      for (let i = from; i < to; i++) sum += counts[i];
      const v = Math.min(1, sum / (to - from) / 12);
      d += ` L${((from / duration) * W).toFixed(1)} ${(40 - v * 36).toFixed(1)}`;
    }
    return `${d} L${((counts.length / duration) * 1000).toFixed(1)} 40 Z`;
  }, [counts, duration]);
  return (
    <svg className="timeline__activity" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
