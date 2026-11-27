import { useEffect, useMemo, useState } from "react";
import { Button, Tabs, Tag } from "@team-carol/design-system/react";
import { api, type Recording } from "../api";
import { bytes, clock, dateTime } from "../format";
import { folderPath, link, navigate, type Route } from "../router";

type Sort = "date" | "size" | "length";
type View = "grid" | "list";

const RECENT_MS = 7 * 24 * 3600 * 1000;
const when = (r: Recording) => r.recorded_at ?? r.created_at;

function readPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

/** Google Drive style browser: sidebar (folders = devices), breadcrumb, grid/list, multi-select */
export function DrivePage({ route }: { route: Extract<Route, { name: "recordings" | "folder" }> }) {
  const [items, setItems] = useState<Recording[] | null>(null);
  const [usage, setUsage] = useState({ used: 0, cap: 1 });
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => readPref("cl.view", "grid", ["grid", "list"] as const));
  const [sort, setSort] = useState<Sort>(() => readPref("cl.sort", "date", ["date", "size", "length"] as const));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);

  const load = () =>
    api
      .recordings()
      .then((r) => {
        setItems(r.items);
        setUsage(r.usage);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  // leaving a folder clears the selection, like Drive
  useEffect(() => setSelected(new Set()), [route]);
  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const folders = useMemo(() => {
    const map = new Map<string, { count: number; size: number; latest: number; thumb?: string }>();
    for (const r of items ?? []) {
      const f = map.get(r.device_name) ?? { count: 0, size: 0, latest: 0 };
      f.count++;
      f.size += r.size;
      if (when(r) > f.latest) {
        f.latest = when(r);
        if (r.has_thumb) f.thumb = api.thumbUrl(r.id);
      }
      map.set(r.device_name, f);
    }
    return [...map.entries()].sort((a, b) => b[1].latest - a[1].latest);
  }, [items]);

  const files = useMemo(() => {
    let list = items ?? [];
    if (route.name === "folder") list = list.filter((r) => r.device_name === route.device);
    if (route.name === "recordings" && route.view === "recent") list = list.filter((r) => Date.now() - when(r) < RECENT_MS);
    const by: Record<Sort, (a: Recording, b: Recording) => number> = {
      date: (a, b) => when(b) - when(a),
      size: (a, b) => b.size - a.size,
      length: (a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0),
    };
    return [...list].sort(by[sort]);
  }, [items, route, sort]);

  // the root shows folders + all files; a folder only its files
  const showFolders = route.name === "recordings" && route.view === "all";

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const chosen = files.filter((f) => selected.has(f.id));

  const downloadAll = (list: Recording[]) => {
    // one anchor click per file; browsers may ask once to allow multiple downloads
    list
      .filter((r) => r.status === "ready")
      .forEach((r, i) =>
        setTimeout(() => {
          const a = document.createElement("a");
          a.href = api.downloadUrl(r.id);
          a.download = r.filename;
          a.click();
        }, i * 400),
      );
  };

  const remove = async (list: Recording[]) => {
    const what = list.length === 1 ? `'${dateTime(when(list[0]))}' 녹화를` : `녹화 ${list.length}개를`;
    if (!confirm(`${what} 지울까요? 되돌릴 수 없습니다`)) return;
    await Promise.all(list.map((r) => api.deleteRecording(r.id)));
    setSelected(new Set());
    load();
  };

  const pct = Math.min(100, (usage.used / usage.cap) * 100);
  const title =
    route.name === "folder" ? route.device : route.view === "recent" ? "최근" : "내 녹화";

  return (
    <div className="drive">
      <aside className="drive__side">
        <nav className="side-nav" aria-label="녹화 폴더">
          <a className={sideClass(route.name === "recordings" && route.view === "all")} {...link("/")}>
            <span className="side-nav__icon" aria-hidden>▤</span>내 녹화
            <span className="side-nav__count">{items?.length ?? ""}</span>
          </a>
          <a className={sideClass(route.name === "recordings" && route.view === "recent")} {...link("/recent")}>
            <span className="side-nav__icon" aria-hidden>◷</span>최근 7일
          </a>
          <div className="side-nav__label">기기</div>
          {folders.map(([name, f]) => (
            <a key={name} className={sideClass(route.name === "folder" && route.device === name)} {...link(folderPath(name))}>
              <span className="side-nav__icon side-nav__icon--folder" aria-hidden>■</span>
              <span className="side-nav__name">{name}</span>
              <span className="side-nav__count">{f.count}</span>
            </a>
          ))}
          {folders.length === 0 && <p className="side-nav__empty">아직 없습니다</p>}
        </nav>

        <div className="side-storage">
          <div className="meter" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className={pct > 85 ? "meter__fill meter__fill--warn" : "meter__fill"} style={{ width: `${pct}%` }} />
          </div>
          <p className="crl-caption">
            팀 저장공간 {bytes(usage.used)} / {bytes(usage.cap)}
          </p>
          <p className="crl-helper">가득 차면 팀 전체에서 가장 오래된 녹화부터 지워집니다</p>
        </div>
      </aside>

      <section className="drive__main">
        <div className="drive__bar">
          <nav className="crumbs" aria-label="경로">
            {route.name === "folder" ? (
              <>
                <a {...link("/")}>내 녹화</a>
                <span aria-hidden>›</span>
                <span className="crumbs__here">{title}</span>
              </>
            ) : (
              <span className="crumbs__here">{title}</span>
            )}
          </nav>
          <div className="drive__tools">
            <select
              className="crl-input drive__sort"
              value={sort}
              aria-label="정렬"
              onChange={(e) => {
                setSort(e.target.value as Sort);
                writePref("cl.sort", e.target.value);
              }}
            >
              <option value="date">최근 녹화순</option>
              <option value="size">큰 파일순</option>
              <option value="length">긴 영상순</option>
            </select>
            <Tabs
              variant="contained"
              aria-label="보기"
              value={view}
              onChange={(v) => {
                setView(v);
                writePref("cl.view", v);
              }}
              items={[
                { value: "grid", label: "바둑판" },
                { value: "list", label: "목록" },
              ]}
            />
          </div>
        </div>

        {chosen.length > 0 && (
          <div className="selection-bar" role="toolbar" aria-label="선택한 파일">
            <span>{chosen.length}개 선택됨</span>
            <span className="selection-bar__spacer" />
            <Button variant="secondary" size="sm" onClick={() => downloadAll(chosen)}>
              원본 받기
            </Button>
            <Button variant="secondary" size="sm" onClick={() => remove(chosen)}>
              삭제
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
              선택 해제
            </Button>
          </div>
        )}

        {error && <p className="crl-helper crl-helper--error">{error}</p>}
        {items === null && !error && <p className="caption-muted">불러오는 중…</p>}

        {showFolders && folders.length > 0 && (
          <>
            <h2 className="drive__section">폴더</h2>
            <div className="folder-grid">
              {folders.map(([name, f]) => (
                <a key={name} className="folder-tile" {...link(folderPath(name))}>
                  <span className="folder-tile__icon" aria-hidden>■</span>
                  <span className="folder-tile__text">
                    <span className="folder-tile__name">{name}</span>
                    <span className="crl-caption">
                      {f.count}개 · {bytes(f.size)}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </>
        )}

        {items !== null && (
          <h2 className="drive__section">{showFolders ? "모든 파일" : "파일"}</h2>
        )}
        {items !== null && files.length === 0 && (
          <div className="drive__empty">
            <p className="crl-body-sm">
              {items.length === 0
                ? "아직 녹화가 없습니다. 폰 앱 설정 → 업로드에서 기기를 연결하고 방송하면, 끝난 뒤 자동으로 올라옵니다."
                : "여기에는 파일이 없습니다."}
            </p>
          </div>
        )}

        {view === "grid" ? (
          <div className="file-grid">
            {files.map((r) => (
              <FileTile
                key={r.id}
                r={r}
                selected={selected.has(r.id)}
                selecting={selected.size > 0}
                onToggle={() => toggle(r.id)}
                menuOpen={menu === r.id}
                onMenu={() => setMenu(menu === r.id ? null : r.id)}
                onDownload={() => downloadAll([r])}
                onDelete={() => remove([r])}
              />
            ))}
          </div>
        ) : (
          files.length > 0 && (
            <div className="file-table" role="table">
              <div className="file-table__head" role="row">
                <span role="columnheader" />
                <span role="columnheader">이름</span>
                <span role="columnheader">기기</span>
                <span role="columnheader">녹화</span>
                <span role="columnheader">길이</span>
                <span role="columnheader">크기</span>
                <span role="columnheader" />
              </div>
              {files.map((r) => (
                <div
                  key={r.id}
                  role="row"
                  className={selected.has(r.id) ? "file-row is-selected" : "file-row"}
                  onClick={() => (selected.size > 0 ? toggle(r.id) : r.status === "ready" && navigate(`/r/${r.id}`))}
                >
                  <span role="cell" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="check" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label="선택" />
                  </span>
                  <span role="cell" className="file-row__name">
                    <Thumb r={r} small />
                    <span className="file-row__title">{r.filename}</span>
                    {r.status !== "ready" && <Tag tone="danger">업로드 중</Tag>}
                  </span>
                  <span role="cell" className="file-row__muted">{r.device_name}</span>
                  <span role="cell" className="file-row__muted">{dateTime(when(r))}</span>
                  <span role="cell" className="file-row__num">{r.duration_ms ? clock(r.duration_ms / 1000) : "-"}</span>
                  <span role="cell" className="file-row__num">{bytes(r.size)}</span>
                  <span role="cell" onClick={(e) => e.stopPropagation()}>
                    <RowMenu
                      open={menu === r.id}
                      onMenu={() => setMenu(menu === r.id ? null : r.id)}
                      r={r}
                      onDownload={() => downloadAll([r])}
                      onDelete={() => remove([r])}
                    />
                  </span>
                </div>
              ))}
            </div>
          )
        )}
      </section>
    </div>
  );
}

function sideClass(active: boolean) {
  return active ? "side-nav__item is-active" : "side-nav__item";
}

function Thumb({ r, small }: { r: Recording; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  const cls = small ? "thumb thumb--small" : "thumb";
  if (r.has_thumb && !broken) {
    return <img className={cls} src={api.thumbUrl(r.id)} alt="" loading="lazy" onError={() => setBroken(true)} />;
  }
  return (
    <span className={`${cls} thumb--empty`} aria-hidden>
      ▶
    </span>
  );
}

function FileTile(props: {
  r: Recording;
  selected: boolean;
  selecting: boolean;
  onToggle: () => void;
  menuOpen: boolean;
  onMenu: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const { r, selected, selecting } = props;
  const ready = r.status === "ready";
  const open = () => {
    if (selecting) props.onToggle();
    else if (ready) navigate(`/r/${r.id}`);
  };
  return (
    <article className={selected ? "file-tile is-selected" : "file-tile"}>
      <div className="file-tile__media" onClick={open} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open()}>
        <Thumb r={r} />
        {r.duration_ms ? <span className="file-tile__dur">{clock(r.duration_ms / 1000)}</span> : null}
        {!ready && <span className="file-tile__badge"><Tag tone="danger">업로드 중</Tag></span>}
        <label className="file-tile__check" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" className="check" checked={selected} onChange={props.onToggle} aria-label="선택" />
        </label>
      </div>
      <div className="file-tile__info">
        <div className="file-tile__text" onClick={open}>
          <span className="file-tile__name">{dateTime(when(r))}</span>
          <span className="crl-caption">
            {r.device_name} · {bytes(r.size)}
            {r.summary?.streamed === false ? " · 녹화만" : ""}
          </span>
        </div>
        <RowMenu open={props.menuOpen} onMenu={props.onMenu} r={r} onDownload={props.onDownload} onDelete={props.onDelete} />
      </div>
    </article>
  );
}

function RowMenu(props: { open: boolean; onMenu: () => void; r: Recording; onDownload: () => void; onDelete: () => void }) {
  const ready = props.r.status === "ready";
  return (
    <div className="kebab">
      <button
        type="button"
        className="kebab__btn"
        aria-label="더보기"
        aria-expanded={props.open}
        onClick={(e) => {
          e.stopPropagation();
          props.onMenu();
        }}
      >
        ⋮
      </button>
      {props.open && (
        <div className="kebab__menu" role="menu" onClick={(e) => e.stopPropagation()}>
          {ready && (
            <a role="menuitem" {...link(`/r/${props.r.id}`)}>
              구간 자르기
            </a>
          )}
          {ready && (
            <button role="menuitem" type="button" onClick={props.onDownload}>
              원본 받기
            </button>
          )}
          <button role="menuitem" type="button" className="kebab__danger" onClick={props.onDelete}>
            삭제
          </button>
        </div>
      )}
    </div>
  );
}
