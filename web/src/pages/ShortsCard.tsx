import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Button, Card, TextInput } from "@team-carol/design-system/react";
import { api, type MaimaiProfile } from "../api";
import { clock } from "../format";
import { CARD, type CardImages } from "../lib/shorts/card";
import { loadFonts } from "../lib/shorts/draw";
import { CARD_MAX_Y, SHORTS, cardLayout, drawFrame, legacyLayout, loadCardImages } from "../lib/shorts/layout";
import type { Play } from "../lib/songs";
import { link } from "../router";

/** YouTube Shorts takes videos up to 3 minutes */
const SHORTS_MAX_SECONDS = 180;
/** rough areas the Shorts player covers with its own UI (1080×1920 frame) */
const UI_ZONES = [
  { x: 0, y: 1520, w: 1080, h: 400 },
  { x: 930, y: 880, w: 150, h: 640 },
];
const PRESETS = [
  { label: "위", y: CARD.defaultY },
  { label: "아래", y: 1520 - CARD.height - 30 },
];
type Mode = "card" | "legacy";
const PREFS_KEY = "carol.shorts";

/** levels typed by hand (maimai DX NET only says "14+"), remembered per chart on this browser */
const LEVELS_KEY = "carol.shortsLevels";
const chartKey = (p: Play) => [p.title, p.difficulty ?? "", p.details?.kind ?? ""].join("|");

function readLevels(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(LEVELS_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function saveLevel(p: Play, level: string) {
  try {
    const all = readLevels();
    if (level && level !== (p.details?.level ?? "")) all[chartKey(p)] = level;
    else delete all[chartKey(p)];
    localStorage.setItem(LEVELS_KEY, JSON.stringify(all));
  } catch {
    // only a convenience
  }
}

function readPrefs(): { mode?: Mode; background?: boolean; songCard?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

interface Props {
  play: Play;
  /** the editor's player: the preview shows whatever frame it is on */
  video: RefObject<HTMLVideoElement | null>;
  fileUrl: string;
  from: number;
  to: number;
  name: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onDone: (clip: { name: string; url: string; size: number; duration: number }) => void;
  onClose: () => void;
}

export function ShortsCard({ play, video, fileUrl, from, to, name, disabled, onBusy, onDone, onClose }: Props) {
  const preview = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>(() => (readPrefs().mode === "legacy" ? "legacy" : "card"));
  const [background, setBackground] = useState(() => readPrefs().background !== false);
  const [songCard, setSongCard] = useState(() => readPrefs().songCard !== false);
  const [y, setY] = useState(CARD.defaultY);
  const [align, setAlign] = useState(0.55);
  const [zoom, setZoom] = useState(1);
  const [level, setLevel] = useState(() => readLevels()[chartKey(play)] ?? play.details?.level ?? "");
  const [guide, setGuide] = useState(false);
  const [fonts, setFonts] = useState(false);
  const [images, setImages] = useState<CardImages>({});
  /** undefined while loading, null when the user has not imported one */
  const [profile, setProfile] = useState<MaimaiProfile | null | undefined>(undefined);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    api.maimaiProfile().then(
      (r) => setProfile(r.profile),
      () => setProfile(null),
    );
    import("../lib/shorts/render").then((m) => m.shortsSupported()).then(setSupported, () => setSupported(false));
    return () => abort.current?.abort();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ mode, background, songCard }));
    } catch {
      // only a convenience
    }
  }, [mode, background, songCard]);

  // fonts for every text on the overlay (title, name, dan) before the first draw
  useEffect(() => {
    if (profile === undefined) return;
    let alive = true;
    const text = [play.title, profile?.name, "初二三四五六七八九十真裏皆伝段"].filter(Boolean).join("");
    loadFonts(text).then(() => alive && setFonts(true));
    return () => {
      alive = false;
    };
  }, [play, profile]);

  // maimai DX NET images: the overlay is drawn with letters first and again once they arrive
  useEffect(() => {
    if (profile === undefined) return;
    let alive = true;
    setImages({});
    loadCardImages(play, profile).then((loaded) => alive && setImages(loaded));
    return () => {
      alive = false;
    };
  }, [play, profile]);

  // another song: its own remembered level, or what maimai DX NET shows
  useEffect(() => {
    setLevel(readLevels()[chartKey(play)] ?? play.details?.level ?? "");
  }, [play]);

  /** the play as it is drawn: with the level typed here */
  const shown = useMemo<Play>(() => ({ ...play, details: { ...play.details, level: level.trim() || undefined } }), [play, level]);

  const layout = useMemo(() => {
    if (!fonts) return null;
    return mode === "card"
      ? cardLayout(shown, images, y, { align, zoom })
      : legacyLayout(shown, profile ?? null, images, { background, songCard, align, zoom });
  }, [fonts, mode, shown, images, y, profile, background, songCard, align, zoom]);

  const paint = useCallback(() => {
    const c = preview.current;
    const v = video.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, SHORTS.width, SHORTS.height);
    const ready = !!v && v.readyState >= 2 && v.videoWidth > 0;
    if (layout) drawFrame(ctx, layout, ready ? v!.videoWidth : 0, ready ? v!.videoHeight : 0, (x, yy, w, h) => ctx.drawImage(v!, x, yy, w, h));
    if (guide) {
      ctx.fillStyle = "rgba(255, 80, 80, 0.3)";
      for (const z of UI_ZONES) ctx.fillRect(z.x, z.y, z.w, z.h);
    }
  }, [video, layout, guide]);

  useEffect(() => {
    paint();
    const v = video.current;
    if (!v) return;
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    };
    const events = ["seeked", "timeupdate", "loadeddata"] as const;
    events.forEach((e) => v.addEventListener(e, later));
    return () => {
      cancelAnimationFrame(frame);
      events.forEach((e) => v.removeEventListener(e, later));
    };
  }, [paint, video]);

  // drag on the preview: the card in card mode, the footage in legacy mode
  const busy = progress !== null;
  const draggable = !busy;
  const drag = useRef<{ at: number; y: number; align: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggable) return;
    drag.current = { at: e.clientY, y, align };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    const moved = ((e.clientY - drag.current.at) * SHORTS.height) / e.currentTarget.getBoundingClientRect().height;
    if (mode === "card") setY(Math.round(Math.min(CARD_MAX_Y, Math.max(0, drag.current.y + moved))));
    // pulling the footage down shows more of its top
    else setAlign(Math.min(1, Math.max(0, drag.current.align - moved / 800)));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const length = to - from;
  const make = async () => {
    if (!layout) return;
    setError(null);
    setProgress(0);
    onBusy(true);
    abort.current = new AbortController();
    try {
      const { renderShorts } = await import("../lib/shorts/render");
      const res = await renderShorts({ url: fileUrl, from, to, layout, onProgress: setProgress, signal: abort.current.signal });
      const url = URL.createObjectURL(res.blob);
      onDone({ name, url, size: res.blob.size, duration: res.duration });
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
    } catch (e) {
      if (!abort.current?.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abort.current = null;
      setProgress(null);
      onBusy(false);
    }
  };

  const chip = (on: boolean) => `crl-chip nudge${on ? " is-on" : ""}`;

  return (
    <Card className="shorts">
      <div className="songs__head">
        <h2 className="crl-card__title">쇼츠 만들기</h2>
        <button type="button" className="crl-chip nudge shorts__close" onClick={onClose} disabled={busy}>
          닫기
        </button>
      </div>
      <p className="crl-card__body">
        {play.title} · {clock(from)}~{clock(to)} ({clock(length)}). 구간은 아래 "구간 자르기"의 시작·끝을 그대로 씀.
      </p>

      <div className="shorts__body">
        <canvas
          ref={preview}
          className={`shorts__preview${draggable ? " is-draggable" : ""}`}
          width={SHORTS.width}
          height={SHORTS.height}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="쇼츠 미리보기"
        />
        <div className="shorts__controls">
          <TextInput
            label="레벨"
            value={level}
            maxLength={5}
            inputMode="decimal"
            placeholder={play.details?.level ?? "14.6"}
            helperText="카드 오른쪽 숫자. 14.6처럼 직접 고칠 수 있고 이 곡은 다음에도 기억함"
            disabled={busy}
            onChange={(e) => {
              setLevel(e.target.value);
              saveLevel(play, e.target.value.trim());
            }}
          />

          <span className="crl-label">레이아웃</span>
          <div className="nudges" role="group" aria-label="레이아웃">
            <button type="button" className={chip(mode === "card")} aria-pressed={mode === "card"} disabled={busy} onClick={() => setMode("card")}>
              곡 카드만
            </button>
            <button type="button" className={chip(mode === "legacy")} aria-pressed={mode === "legacy"} disabled={busy} onClick={() => setMode("legacy")}>
              레거시
            </button>
          </div>

          {mode === "card" ? (
            <>
              <label className="crl-label" htmlFor="shorts-y">
                곡 카드 위치
              </label>
              <input
                id="shorts-y"
                className="shorts__slider"
                type="range"
                min={0}
                max={Math.floor(CARD_MAX_Y)}
                step={2}
                value={y}
                disabled={busy}
                onChange={(e) => setY(Number(e.target.value))}
              />
              <div className="nudges">
                {PRESETS.map((p) => (
                  <button key={p.label} type="button" className="crl-chip nudge" disabled={busy} onClick={() => setY(Math.round(p.y))}>
                    {p.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="nudges">
                <button type="button" className={chip(background)} aria-pressed={background} disabled={busy} onClick={() => setBackground((b) => !b)}>
                  파란 배경
                </button>
                <button type="button" className={chip(songCard)} aria-pressed={songCard} disabled={busy} onClick={() => setSongCard((v) => !v)}>
                  곡 카드
                </button>
              </div>
              {profile === null && (
                <p className="crl-helper">
                  프로필이 아직 없어서 프로필 카드는 빠짐. <a {...link("/maimai")}>maimai 메뉴</a>에서 북마크를 새로 등록하고 기록 페이지에서 한 번
                  누르면 프로필 카드가 같이 나옴.
                </p>
              )}
            </>
          )}

          <label className="crl-label" htmlFor="shorts-align">
            영상 높이 (위 ↔ 아래)
          </label>
          <input
            id="shorts-align"
            className="shorts__slider"
            type="range"
            min={0}
            max={100}
            value={Math.round(align * 100)}
            disabled={busy}
            onChange={(e) => setAlign(Number(e.target.value) / 100)}
          />
          <label className="crl-label" htmlFor="shorts-zoom">
            영상 확대 {Math.round(zoom * 100)}%
          </label>
          <input
            id="shorts-zoom"
            className="shorts__slider"
            type="range"
            min={100}
            max={200}
            step={5}
            value={Math.round(zoom * 100)}
            disabled={busy}
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
          />

          <div className="nudges">
            <button type="button" className={chip(guide)} aria-pressed={guide} onClick={() => setGuide((g) => !g)}>
              쇼츠 UI 영역
            </button>
          </div>
          <p className="crl-helper">
            미리보기에서 {mode === "card" ? "카드" : "영상"}를 위아래로 끌어도 됨. 영상이 화면에 딱 맞으면 높이를 옮길 여유가 없으니 확대를
            올리면 됨. 빨간 영역은 쇼츠 앱의 제목·버튼이 덮는 대략적인 자리.
          </p>
        </div>
      </div>

      {length > SHORTS_MAX_SECONDS && (
        <p className="crl-helper crl-helper--error">유튜브 쇼츠는 3분까지임. 지금 구간은 {clock(length)}라 일반 영상으로 올라감.</p>
      )}
      {supported === false && (
        <p className="crl-helper crl-helper--error">이 브라우저는 영상 인코딩(WebCodecs H.264)을 지원하지 않음. 크롬이나 엣지에서 해줘.</p>
      )}

      <div className="panel-actions">
        {!busy ? (
          <Button variant="primary" onClick={make} disabled={disabled || !supported || !layout || length <= 0.1}>
            쇼츠 만들기
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => abort.current?.abort()}>
            취소
          </Button>
        )}
      </div>
      {progress !== null && (
        <>
          <div className="shorts__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="crl-helper">인코딩 중… {Math.round(progress * 100)}%. 이 탭을 열어둬야 함. 영상 길이만큼 걸릴 수 있음.</p>
        </>
      )}
      {error && <p className="crl-helper crl-helper--error">{error}</p>}
      <p className="crl-helper">1080×1920으로 다시 인코딩함. 소리는 원본 그대로.</p>
    </Card>
  );
}
