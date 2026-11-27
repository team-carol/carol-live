import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Button, Card } from "@team-carol/design-system/react";
import { clock } from "../format";
import { CARD, CARD_MAX_Y, SHORTS, loadCardFonts, loadCardImages, renderCard } from "../lib/shorts/card";
import { coverRect } from "../lib/shorts/images";
import type { Play } from "../lib/songs";

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
  const [card, setCard] = useState<HTMLCanvasElement | null>(null);
  const [y, setY] = useState(CARD.defaultY);
  const [guide, setGuide] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // the card bitmap: lettering first, then again with maimai DX NET images once they arrive
  useEffect(() => {
    let alive = true;
    setCard(null);
    (async () => {
      await loadCardFonts();
      if (!alive) return;
      setCard(renderCard(play));
      const images = await loadCardImages(play);
      if (alive && Object.keys(images).length) setCard(renderCard(play, images));
    })();
    return () => {
      alive = false;
    };
  }, [play]);

  useEffect(() => {
    import("../lib/shorts/render").then((m) => m.shortsSupported()).then(setSupported, () => setSupported(false));
    return () => abort.current?.abort();
  }, []);

  const paint = useCallback(() => {
    const c = preview.current;
    const v = video.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, SHORTS.width, SHORTS.height);
    if (v && v.readyState >= 2 && v.videoWidth) {
      const r = coverRect(v.videoWidth, v.videoHeight, SHORTS.width, SHORTS.height);
      ctx.drawImage(v, r.x, r.y, r.w, r.h);
    }
    if (card) ctx.drawImage(card, CARD.x, y);
    if (guide) {
      ctx.fillStyle = "rgba(255, 80, 80, 0.3)";
      for (const z of UI_ZONES) ctx.fillRect(z.x, z.y, z.w, z.h);
    }
  }, [video, card, y, guide]);

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

  // drag the card up and down right on the preview
  const drag = useRef<{ at: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (progress !== null) return;
    drag.current = { at: e.clientY, y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    const scale = SHORTS.height / e.currentTarget.getBoundingClientRect().height;
    setY(Math.round(Math.min(CARD_MAX_Y, Math.max(0, drag.current.y + (e.clientY - drag.current.at) * scale))));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const length = to - from;
  const make = async () => {
    setError(null);
    setProgress(0);
    onBusy(true);
    abort.current = new AbortController();
    try {
      const { renderShorts } = await import("../lib/shorts/render");
      const res = await renderShorts({ url: fileUrl, from, to, card, cardY: y, onProgress: setProgress, signal: abort.current.signal });
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

  return (
    <Card className="shorts">
      <div className="songs__head">
        <h2 className="crl-card__title">쇼츠 만들기</h2>
        <button type="button" className="crl-chip nudge shorts__close" onClick={onClose} disabled={progress !== null}>
          닫기
        </button>
      </div>
      <p className="crl-card__body">
        {play.title} · {clock(from)}~{clock(to)} ({clock(length)}). 구간은 아래 "구간 자르기"의 시작·끝을 그대로 씀.
      </p>

      <div className="shorts__body">
        <canvas
          ref={preview}
          className="shorts__preview"
          width={SHORTS.width}
          height={SHORTS.height}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="쇼츠 미리보기. 카드를 위아래로 끌어서 옮길 수 있음"
        />
        <div className="shorts__controls">
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
            disabled={progress !== null}
            onChange={(e) => setY(Number(e.target.value))}
          />
          <div className="nudges">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="crl-chip nudge" disabled={progress !== null} onClick={() => setY(Math.round(p.y))}>
                {p.label}
              </button>
            ))}
            <button type="button" className={`crl-chip nudge${guide ? " is-on" : ""}`} aria-pressed={guide} onClick={() => setGuide((g) => !g)}>
              쇼츠 UI 영역
            </button>
          </div>
          <p className="crl-helper">미리보기에서 카드를 끌어도 됨. 빨간 영역은 쇼츠 앱의 제목·버튼이 덮는 대략적인 자리.</p>
        </div>
      </div>

      {length > SHORTS_MAX_SECONDS && (
        <p className="crl-helper crl-helper--error">유튜브 쇼츠는 3분까지임. 지금 구간은 {clock(length)}라 일반 영상으로 올라감.</p>
      )}
      {supported === false && (
        <p className="crl-helper crl-helper--error">이 브라우저는 영상 인코딩(WebCodecs H.264)을 지원하지 않음. 크롬이나 엣지에서 해줘.</p>
      )}

      <div className="panel-actions">
        {progress === null ? (
          <Button variant="primary" onClick={make} disabled={disabled || !supported || !card || length <= 0.1}>
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
      <p className="crl-helper">화면을 9:16으로 채우고 다시 인코딩함 (1080×1920). 소리는 원본 그대로.</p>
    </Card>
  );
}
