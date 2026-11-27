import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { color } from "@team-carol/design-system";
import { Button, Card, Select, TextInput } from "@team-carol/design-system/react";
import { api, type MaimaiProfile } from "../api";
import { clock } from "../format";
import type { CardImages } from "../lib/shorts/card";
import { DEFAULT_DESIGN, PRESETS, SCALE, SHORTS, applyPreset, cleanDesign, type ElementId, type PresetId, type ShortsDesign } from "../lib/shorts/design";
import { loadFonts } from "../lib/shorts/draw";
import { cardImageUrls } from "../lib/shorts/images";
import { buildLayout, drawFrame, loadCardImages, maxY, type Box } from "../lib/shorts/layout";
import { markList } from "../lib/shorts/stats";
import type { Play } from "../lib/songs";
import { link } from "../router";
import { ProfileEditor } from "./ProfileEditor";

/** YouTube Shorts takes videos up to 3 minutes */
const SHORTS_MAX_SECONDS = 180;
/** rough areas the Shorts player covers with its own UI (1080×1920 frame) */
const UI_ZONES = [
  { x: 0, y: 1520, w: 1080, h: 400 },
  { x: 930, y: 880, w: 150, h: 640 },
];
/** the design is remembered on this browser, so the next song starts from the same look */
const PREFS_KEY = "carol.shorts";
/** a dragged piece sticks to its automatic place within this many frame pixels */
const SNAP = 16;
/** easier to hit small lettering with a finger */
const HIT_PAD = 18;

/** the corner handle of a picked piece that can be resized: its size and how close a press counts (frame pixels) */
const HANDLE = { size: 30, reach: 46, out: 10 };

/** what the settings beside the preview are about: a piece, or the frame itself (background, gradient, footage) */
type Part = ElementId | "frame";
/** the pieces on the footage, which can be resized */
type Sized = "achievement" | "marks";
const isSized = (id: ElementId): id is Sized => id === "achievement" || id === "marks";
/** the handle sits on the corner away from the point the piece is placed by */
const handleOf = (b: Box) => ({ x: b.id === "marks" ? b.x - HANDLE.out : b.x + b.w + HANDLE.out, y: b.y + b.h + HANDLE.out });

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

function readDesign(): ShortsDesign {
  try {
    const saved = localStorage.getItem(PREFS_KEY);
    return saved ? cleanDesign(JSON.parse(saved)) : DEFAULT_DESIGN;
  } catch {
    return DEFAULT_DESIGN;
  }
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

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
  const [design, setDesign] = useState<ShortsDesign>(readDesign);
  /** the piece being edited, as in a video editor: picked on the preview or in the layer list */
  const [part, setPart] = useState<Part>("song");
  const [hover, setHover] = useState<ElementId | null>(null);
  const [level, setLevel] = useState(() => readLevels()[chartKey(play)] ?? play.details?.level ?? "");
  const [guide, setGuide] = useState(false);
  const [fonts, setFonts] = useState(false);
  /** goes up when more glyphs have loaded, so the overlay is drawn again with them */
  const [fontTick, setFontTick] = useState(0);
  const [editing, setEditing] = useState(false);
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
    // it opens under the player, which can be off screen from the song list
    preview.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return () => abort.current?.abort();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(design));
    } catch {
      // only a convenience
    }
  }, [design]);

  // fonts for every text on the overlay (title, name, dan) before the first draw
  useEffect(() => {
    if (profile === undefined) return;
    let alive = true;
    const text = [play.title, profile?.name, "初二三四五六七八九十真裏皆伝段"].filter(Boolean).join("");
    loadFonts(text).then(() => {
      if (!alive) return;
      setFonts(true);
      setFontTick((t) => t + 1);
    });
    return () => {
      alive = false;
    };
  }, [play.title, profile === undefined, profile?.name]);

  // maimai DX NET images: the overlay is drawn with letters first and again once they arrive
  const imageKey = profile === undefined ? null : JSON.stringify(cardImageUrls(play, profile));
  useEffect(() => {
    if (imageKey === null) return;
    let alive = true;
    setImages({});
    loadCardImages(play, profile).then((loaded) => alive && setImages(loaded));
    return () => {
      alive = false;
    };
    // only when the set of images changes, not on every typed character of the profile
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey]);

  // another song: its own remembered level, or what maimai DX NET shows
  useEffect(() => {
    setLevel(readLevels()[chartKey(play)] ?? play.details?.level ?? "");
  }, [play]);

  /** the play as it is drawn: with the level typed here */
  const shown = useMemo<Play>(() => ({ ...play, details: { ...play.details, level: level.trim() || undefined } }), [play, level]);

  const layout = useMemo(
    () => (fonts ? buildLayout(shown, profile ?? null, images, design) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fonts, fontTick, shown, images, profile, design],
  );
  const boxOf = (id: Part): Box | undefined => layout?.boxes.find((b) => b.id === id);

  const busy = progress !== null;

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
    // editing marks, on the preview only: the piece under the pointer, the picked piece and its resize handle
    if (busy || !layout) return;
    const frame = (b: Box, width: number, alpha: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color.accent;
      ctx.lineWidth = width;
      ctx.strokeRect(b.x - HANDLE.out, b.y - HANDLE.out, b.w + HANDLE.out * 2, b.h + HANDLE.out * 2);
      ctx.restore();
    };
    const over = layout.boxes.find((b) => b.id === hover && b.id !== part);
    if (over) frame(over, 3, 0.7);
    const picked = layout.boxes.find((b) => b.id === part);
    if (picked) {
      frame(picked, 5, 1);
      if (isSized(picked.id)) {
        const h = handleOf(picked);
        ctx.fillStyle = color.ink;
        ctx.strokeStyle = color.accent;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.rect(h.x - HANDLE.size / 2, h.y - HANDLE.size / 2, HANDLE.size, HANDLE.size);
        ctx.fill();
        ctx.stroke();
      }
    }
  }, [video, layout, guide, part, hover, busy]);

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

  /** moves a piece's anchor to [x, y] (frame pixels), kept inside the frame */
  const moveTo = (id: ElementId, x: number, y: number, box?: Box) => {
    setDesign((d) => {
      if (id === "song") return { ...d, song: { ...d.song, y: Math.round(clamp(y, 0, maxY("song", d))) } };
      if (id === "profile") return { ...d, profile: { ...d.profile, y: Math.round(clamp(y, 0, maxY("profile", d))) } };
      const w = box?.w ?? 0;
      const h = box?.h ?? 0;
      // the achievement is placed by its left edge, the marks by their right edge
      const pos = {
        x: Math.round(id === "achievement" ? clamp(x, 0, SHORTS.width - w) : clamp(x, w, SHORTS.width)),
        y: Math.round(clamp(y, 0, SHORTS.height - h)),
      };
      const auto = box?.auto;
      if (auto && Math.abs(pos.x - auto.x) < SNAP) pos.x = auto.x;
      if (auto && Math.abs(pos.y - auto.y) < SNAP) pos.y = auto.y;
      const back = !!auto && pos.x === auto.x && pos.y === auto.y;
      return { ...d, [id]: { ...d[id], pos: back ? null : pos } };
    });
  };
  const scaleTo = (id: Sized, scale: number) =>
    setDesign((d) => ({ ...d, [id]: { ...d[id], scale: Math.round(clamp(scale, SCALE.min, SCALE.max) * 100) / 100 } }));

  // On the preview, as in a video editor: press a piece to pick it, drag it to move it, drag the corner handle of
  // the picked achievement or marks to resize it. Dragging anywhere else moves the footage up and down.
  type Grab =
    | { kind: "move"; id: ElementId; box: Box }
    | { kind: "scale"; id: Sized; box: Box; scale: number; reach: number }
    | { kind: "footage"; align: number };
  const drag = useRef<(Grab & { x: number; y: number; moved: boolean }) | null>(null);
  const framePoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * SHORTS.width) / r.width, y: ((e.clientY - r.top) * SHORTS.height) / r.height };
  };
  /** what is under a point of the frame */
  const grabAt = (p: { x: number; y: number }): Grab => {
    const boxes = layout?.boxes ?? [];
    const picked = boxes.find((b) => b.id === part);
    if (picked && isSized(picked.id)) {
      const h = handleOf(picked);
      if (Math.hypot(p.x - h.x, p.y - h.y) < HANDLE.reach) {
        const reach = Math.max(1, Math.hypot(h.x - picked.anchor.x, h.y - picked.anchor.y));
        return { kind: "scale", id: picked.id, box: picked, scale: design[picked.id].scale, reach };
      }
    }
    const inside = (b: Box, pad: number) => p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
    const hit = boxes.find((b) => inside(b, 0)) ?? boxes.find((b) => inside(b, HIT_PAD));
    return hit ? { kind: "move", id: hit.id, box: hit } : { kind: "footage", align: design.footage.align };
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy) return;
    const p = framePoint(e);
    const g = grabAt(p);
    setPart(g.kind === "footage" ? "frame" : g.id);
    drag.current = { ...g, ...p, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = framePoint(e);
    const g = drag.current;
    if (!g) {
      // show what a press here would do
      if (busy) return;
      const over = grabAt(p);
      e.currentTarget.style.cursor = over.kind === "scale" ? (over.id === "marks" ? "nesw-resize" : "nwse-resize") : over.kind === "move" ? "move" : "ns-resize";
      setHover(over.kind === "move" ? over.id : null);
      return;
    }
    const [dx, dy] = [p.x - g.x, p.y - g.y];
    if (!g.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    g.moved = true;
    // pulling the footage down shows more of its top
    if (g.kind === "footage") setDesign((d) => ({ ...d, footage: { ...d.footage, align: clamp(g.align - dy / 800, 0, 1) } }));
    else if (g.kind === "scale") scaleTo(g.id, (g.scale * Math.hypot(p.x - g.box.anchor.x, p.y - g.box.anchor.y)) / g.reach);
    else moveTo(g.id, g.box.anchor.x + dx, g.box.anchor.y + dy, g.box);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  // arrow keys nudge the picked piece (Shift: bigger steps)
  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    const box = part === "frame" ? undefined : boxOf(part);
    if (!step || busy || !box) return;
    e.preventDefault();
    const by = e.shiftKey ? 20 : 2;
    moveTo(box.id, box.anchor.x + step[0] * by, box.anchor.y + step[1] * by, { ...box, auto: undefined });
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

  const set = <K extends keyof ShortsDesign>(key: K, patch: Partial<ShortsDesign[K]>) =>
    setDesign((d) => ({ ...d, [key]: { ...(d[key] as object), ...patch } }));

  /** one of a few looks */
  const choice = <T extends string>(label: string, value: T, options: { value: T; label: string }[], pick: (v: T) => void) => (
    <div className="shorts__row">
      <span className="crl-label">{label}</span>
      <div className="nudges" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`crl-chip nudge${o.value === value ? " is-on" : ""}`}
            aria-pressed={o.value === value}
            disabled={busy}
            onClick={() => pick(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
  const slider = (id: string, label: ReactNode, value: number, min: number, max: number, change: (v: number) => void, step = 1, className = "") => (
    <div className={`shorts__row ${className}`}>
      <label className="crl-label" htmlFor={`shorts-${id}`}>
        {label}
      </label>
      <input
        id={`shorts-${id}`}
        className="shorts__slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={busy}
        onChange={(e) => change(Number(e.target.value))}
      />
    </div>
  );
  const check = (label: string, on: boolean, change: (on: boolean) => void) => (
    <label className="shorts__check">
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => change(e.target.checked)} />
      {label}
    </label>
  );
  const percent = (v: number) => `${Math.round(v * 100)}%`;

  /** size and place of a piece on the footage (achievement or marks) */
  const onFootage = (id: Sized) => {
    const box = boxOf(id);
    const s = design[id];
    return (
      <>
        {slider(`${id}-scale`, `크기 ${percent(s.scale)}`, Math.round(s.scale * 100), SCALE.min * 100, SCALE.max * 100, (v) => scaleTo(id, v / 100), 5)}
        {/* with a mouse the piece is dragged on the preview; sliders are for fingers */}
        {box && slider(`${id}-x`, "가로 위치", Math.round(box.anchor.x), 0, SHORTS.width, (v) => moveTo(id, v, box.anchor.y, box), 2, "shorts__touch")}
        {box && slider(`${id}-y`, "세로 위치", Math.round(box.anchor.y), 0, SHORTS.height, (v) => moveTo(id, box.anchor.x, v, box), 2, "shorts__touch")}
        {s.pos && (
          <button type="button" className="crl-chip nudge shorts__reset" disabled={busy} onClick={() => set(id, { pos: null })}>
            자동 위치로 되돌리기
          </button>
        )}
      </>
    );
  };

  const noProfile = profile === null;
  /** the layer list: what is in the frame, whether it shows, and why it might not */
  const layers: { id: Part; label: string; shown?: boolean; show?: (on: boolean) => void; note?: string }[] = [
    { id: "song", label: "곡 카드", shown: design.song.show, show: (show) => set("song", { show }) },
    {
      id: "achievement",
      label: "달성률",
      shown: design.achievement.show,
      show: (show) => set("achievement", { show }),
      note: play.achievement == null ? "기록 없음" : design.achievement.pos ? "옮김" : undefined,
    },
    {
      id: "marks",
      label: "랭크·마크",
      shown: design.marks.show,
      show: (show) => set("marks", { show }),
      note: markList(shown).length === 0 ? "기록 없음" : design.marks.pos ? "옮김" : undefined,
    },
    { id: "profile", label: "프로필 카드", shown: design.profile.show, show: (show) => set("profile", { show }), note: noProfile ? "프로필 없음" : undefined },
    { id: "frame", label: "배경·영상" },
  ];

  const inspector: Record<Part, ReactNode> = {
    song: (
      <>
        {choice(
          "디자인",
          design.song.style,
          [
            { value: "compact", label: "간단" },
            { value: "full", label: "원본 (성적 포함)" },
          ],
          (style) =>
            setDesign((d) => ({
              ...d,
              song: { ...d.song, style, y: Math.min(d.song.y, maxY("song", { ...d, song: { ...d.song, style } })) },
              // the original card carries the result itself, so it comes off the footage (and back with the plain card)
              achievement: { ...d.achievement, show: style === "compact" },
              marks: { ...d.marks, show: style === "compact" },
            })),
        )}
        {slider("song-y", "세로 위치", design.song.y, 0, maxY("song", design), (v) => moveTo("song", 0, v), 2, "shorts__touch")}
        <TextInput
          label="레벨"
          value={level}
          maxLength={5}
          inputMode="decimal"
          placeholder={play.details?.level ?? "14.6"}
          helperText="14.6처럼 직접 고칠 수 있고 이 곡은 다음에도 기억함"
          disabled={busy}
          onChange={(e) => {
            setLevel(e.target.value);
            saveLevel(play, e.target.value.trim());
          }}
        />
      </>
    ),
    achievement: onFootage("achievement"),
    marks: (
      <>
        {choice(
          "모양",
          design.marks.style,
          [
            { value: "image", label: "넷 이미지" },
            { value: "text", label: "글자" },
          ],
          (style) => set("marks", { style }),
        )}
        {choice(
          "배치",
          design.marks.row ? "row" : "column",
          [
            { value: "column", label: "세로" },
            { value: "row", label: "가로" },
          ],
          (v) => set("marks", { row: v === "row" }),
        )}
        {onFootage("marks")}
      </>
    ),
    profile: (
      <>
        {choice(
          "단·클래스",
          design.profile.badges,
          [
            { value: "image", label: "넷 이미지" },
            { value: "figma", label: "배지" },
          ],
          (badges) => set("profile", { badges }),
        )}
        {slider("profile-y", "세로 위치", design.profile.y, 0, maxY("profile", design), (v) => moveTo("profile", 0, v), 2, "shorts__touch")}
        <button type="button" className={`crl-chip nudge shorts__reset${editing ? " is-on" : ""}`} aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
          닉네임·레이팅 수정
        </button>
        {noProfile && !editing && (
          <p className="crl-helper">
            프로필이 아직 없어서 카드가 안 나옴. <a {...link("/maimai")}>maimai 메뉴</a>의 북마크를 새로 등록해 기록 페이지에서 한 번 누르거나, 위
            버튼으로 직접 적으면 됨.
          </p>
        )}
      </>
    ),
    frame: (
      <>
        {check("카드 뒤에 파란 배경", design.panels, (panels) => setDesign((d) => ({ ...d, panels })))}
        {slider("scrim", `글자 뒤 그라데이션 ${percent(design.scrim)}`, Math.round(design.scrim * 100), 0, 100, (v) => setDesign((d) => ({ ...d, scrim: v / 100 })), 5)}
        {slider("align", "영상 높이 (위 ↔ 아래)", Math.round(design.footage.align * 100), 0, 100, (v) => set("footage", { align: v / 100 }))}
        {slider("zoom", `영상 확대 ${percent(design.footage.zoom)}`, Math.round(design.footage.zoom * 100), 100, 200, (v) => set("footage", { zoom: v / 100 }), 5)}
        {check("쇼츠 앱이 덮는 자리 보기", guide, setGuide)}
      </>
    ),
  };

  return (
    <Card className="shorts">
      <div className="songs__head">
        <h2 className="crl-card__title">쇼츠 만들기</h2>
        <button type="button" className="crl-chip nudge shorts__close" onClick={onClose} disabled={busy}>
          닫기
        </button>
      </div>
      <p className="crl-card__body">
        {play.title} · {clock(from)}~{clock(to)} ({clock(length)}). 구간은 "구간 자르기"의 시작·끝을 그대로 씀.
      </p>

      <div className="shorts__body">
        <div className="shorts__stage">
          <canvas
            ref={preview}
            className="shorts__preview"
            width={SHORTS.width}
            height={SHORTS.height}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKeyDown}
            aria-label="쇼츠 미리보기. 요소를 눌러 고르고 끌어서 옮김"
          />
          <p className="crl-helper shorts__hint">눌러서 고르고 끌어서 옮김 · 모서리 점을 끌면 크기 · 방향키로 조금씩 · 빈 곳을 끌면 영상</p>
        </div>

        <div className="shorts__controls">
          <Select
            label="구성 불러오기"
            value=""
            disabled={busy}
            onChange={(e) => {
              const id = e.target.value;
              if (id === "reset") setDesign(DEFAULT_DESIGN);
              else if (id) setDesign((d) => applyPreset(d, id as PresetId));
            }}
          >
            <option value="">고르기…</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="reset">처음 상태로</option>
          </Select>

          <ul className="layers" aria-label="화면 요소">
            {layers.map((l) => (
              <li key={l.id} className={`layer${part === l.id ? " is-picked" : ""}`}>
                {l.show ? (
                  <input type="checkbox" checked={!!l.shown} disabled={busy} aria-label={`${l.label} 표시`} onChange={(e) => l.show!(e.target.checked)} />
                ) : (
                  <span className="layer__gap" />
                )}
                <button type="button" className="layer__name" aria-pressed={part === l.id} onClick={() => setPart(l.id)}>
                  {l.label}
                  {l.note && <span className="layer__note">{l.note}</span>}
                </button>
              </li>
            ))}
          </ul>

          <div className="shorts__inspector" aria-label={`${layers.find((l) => l.id === part)?.label} 설정`}>
            {inspector[part]}
          </div>
        </div>
      </div>

      {editing && profile !== undefined && <ProfileEditor profile={profile} disabled={busy} onChange={setProfile} />}

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
      <p className="crl-helper">1080×1920으로 다시 인코딩함. 소리는 원본 그대로. 고친 구성은 이 브라우저에 기억됨.</p>
    </Card>
  );
}
