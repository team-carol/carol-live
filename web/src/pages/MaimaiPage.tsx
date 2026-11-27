import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, CardBody, CardTitle, Tag } from "@team-carol/design-system/react";
import { api, type PlayImport } from "../api";
import { achievementText, bookmarklet, difficultyLabel, difficultyStyle, readImportFragment } from "../lib/maimai";
import { link } from "../router";

const RECORD_URL = "https://maimaidx-eng.com/maimai-mobile/record/";
export const PENDING_IMPORT_KEY = "carol.pendingImport";

function safeStorage<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** how to bring maimai DX NET plays in (bookmarklet for PC and phone) */
export function MaimaiPage() {
  const code = useMemo(() => bookmarklet(location.origin), []);
  const anchor = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);

  // React blocks javascript: hrefs in JSX, so the bookmarklet link is set directly
  useEffect(() => {
    anchor.current?.setAttribute("href", code);
  }, [code]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <header className="page-head">
        <h1 className="crl-heading-2">maimai DX NET 기록 연결</h1>
        <p className="crl-body-sm">
          녹화에서 나눈 곡에 곡명·난이도·달성률을 붙이려고, maimai DX NET의 최근 플레이 기록(최근 50곡)을 가져옴.
          방송이 끝나고 한 번 눌러주면 됨. 시간으로 맞추니까 같은 날 방송이면 순서대로 붙음.
        </p>
      </header>

      <div className="maimai-steps">
        <Card>
          <CardTitle>PC (Chrome)</CardTitle>
          <ol className="steps">
            <li>
              아래 버튼을 북마크바로 끌어다 놓기
              <div className="steps__action">
                <a ref={anchor} className="crl-btn crl-btn--primary" onClick={(e) => e.preventDefault()} draggable>
                  carol 기록 가져오기
                </a>
              </div>
            </li>
            <li>
              <a href={RECORD_URL} target="_blank" rel="noreferrer">
                maimai DX NET 플레이 기록
              </a>
              을 열고 그 북마크를 누름
            </li>
            <li>새 탭에 carol live가 열리면 가져오기를 누름</li>
          </ol>
        </Card>

        <Card>
          <CardTitle>폰 (Chrome)</CardTitle>
          <ol className="steps">
            <li>
              코드 복사
              <div className="steps__action">
                <Button variant="primary" size="sm" onClick={copy}>
                  {copied ? "복사됨" : "북마크 코드 복사"}
                </Button>
              </div>
            </li>
            <li>아무 페이지나 북마크 → 북마크 수정 → 이름은 carol, URL 칸에 붙여넣기</li>
            <li>
              <a href={RECORD_URL} target="_blank" rel="noreferrer">
                maimai DX NET 플레이 기록
              </a>
              에서 주소창에 carol을 입력하고, 아래에 뜨는 북마크를 누름
            </li>
          </ol>
        </Card>
      </div>

      <p className="crl-helper maimai-note">
        기록은 이 사이트(내 계정)에만 저장되고 maimai DX NET에 로그인 정보를 넘기지 않음. 북마크는 지금 보고 있는 기록
        페이지의 내용만 읽음.
      </p>
    </>
  );
}

/** /import#<plays>: opened by the bookmarklet */
export function ImportPage() {
  const [plays] = useState<PlayImport[] | null>(() => {
    const fromHash = readImportFragment(location.hash);
    if (fromHash) {
      // keep it out of the address bar / history
      history.replaceState(null, "", "/import");
      safeStorage(() => localStorage.removeItem(PENDING_IMPORT_KEY));
      return fromHash;
    }
    return readImportFragment(safeStorage(() => localStorage.getItem(PENDING_IMPORT_KEY)) ?? "");
  });
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [result, setResult] = useState<{ received: number; added: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!plays) return;
    setState("busy");
    setError(null);
    try {
      setResult(await api.importPlays(plays));
      setState("done");
      safeStorage(() => localStorage.removeItem(PENDING_IMPORT_KEY));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  };

  if (!plays || plays.length === 0) {
    return (
      <Card>
        <CardTitle>가져올 기록이 없음</CardTitle>
        <CardBody>
          maimai DX NET 플레이 기록 페이지에서 북마크를 눌러서 열어야 함. <a {...link("/maimai")}>연결 방법 보기</a>
        </CardBody>
      </Card>
    );
  }

  const times = plays.map((p) => p.playedAt);
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

  return (
    <>
      <header className="page-head">
        <h1 className="crl-heading-2">maimai 기록 가져오기</h1>
        <p className="crl-body-sm">
          {plays.length}곡 · {fmt(Math.min(...times))} ~ {fmt(Math.max(...times))}
        </p>
      </header>

      <Card className="import">
        {state === "done" && result ? (
          <>
            <CardTitle>가져왔음</CardTitle>
            <CardBody>
              새로 {result.added}곡 저장 (받은 기록 {result.received}곡). 이 시간대 녹화를 열면 곡 이름이 붙어 있음.
            </CardBody>
            <div className="panel-actions">
              <Button variant="primary" {...link("/")}>
                녹화 목록으로
              </Button>
            </div>
          </>
        ) : (
          <>
            <CardBody>내 carol live 계정에 아래 플레이 기록을 저장함. 이미 있는 기록은 겹치지 않음.</CardBody>
            <div className="panel-actions">
              <Button variant="primary" onClick={run} disabled={state === "busy"}>
                {state === "busy" ? "가져오는 중…" : `${plays.length}곡 가져오기`}
              </Button>
            </div>
            {error && <p className="crl-helper crl-helper--error">{error}</p>}
          </>
        )}
      </Card>

      <ol className="import__list">
        {plays.map((p) => (
          <li key={`${p.playedAt}-${p.track}-${p.title}`} className="import__row">
            <span className="import__time crl-caption">{fmt(p.details?.playedAtSec ? p.details.playedAtSec * 1000 : p.playedAt)}</span>
            <span className="import__title">{p.title}</span>
            {p.difficulty && (
              <span className="song__diff" style={difficultyStyle(p.difficulty)}>
                {difficultyLabel(p.difficulty)}
                {p.details?.level ? ` ${p.details.level}` : ""}
              </span>
            )}
            {p.achievement != null && <Tag tone="neutral">{achievementText(p.achievement)}</Tag>}
          </li>
        ))}
      </ol>
    </>
  );
}
