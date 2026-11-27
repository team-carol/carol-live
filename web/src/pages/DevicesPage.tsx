import { useEffect, useState } from "react";
import { Button, Card, Tag, TextInput } from "@team-carol/design-system/react";
import { api, type DeviceInfo } from "../api";
import { dateTime, relative } from "../format";

export function DevicesPage() {
  const [items, setItems] = useState<DeviceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .devices()
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <header className="page-head">
        <h1 className="crl-heading-2">기기</h1>
        <p className="crl-body-sm">
          녹화를 올릴 수 있는 폰 목록입니다. 폰 앱 설정 → 업로드 → <b>연결하기</b>로 추가합니다. 이름을 바꾸면 이미 올라온 녹화의 폴더 이름도
          같이 바뀝니다.
        </p>
      </header>
      {error && <p className="crl-helper crl-helper--error">{error}</p>}
      {items?.length === 0 && (
        <Card className="empty">
          <p className="crl-card__body">연결된 기기가 없습니다.</p>
        </Card>
      )}
      <div className="rec-list">
        {items?.map((d) => <DeviceRow key={d.id} d={d} onChange={load} />)}
      </div>
    </>
  );
}

function DeviceRow({ d, onChange }: { d: DeviceInfo; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name);
  const [error, setError] = useState<string | null>(null);
  const active = d.last_seen_at && Date.now() - d.last_seen_at < 10 * 60 * 1000;

  const save = async () => {
    try {
      await api.renameDevice(d.id, name);
      setEditing(false);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const disconnect = async () => {
    if (!confirm(`${d.name} 연결을 끊을까요? 그 폰은 다시 연결하기 전까지 업로드할 수 없습니다`)) return;
    await api.removeDevice(d.id);
    onChange();
  };

  return (
    <Card as="article" className="rec">
      <div className="rec__main">
        {editing ? (
          <TextInput label="기기 이름" value={name} maxLength={40} error={error ?? undefined} onChange={(e) => setName(e.target.value)} />
        ) : (
          <div className="rec__title">
            <span className="rec__date">{d.name}</span>
            {active ? <Tag tone="success">업로드 중</Tag> : null}
          </div>
        )}
        <div className="rec__meta crl-caption">
          연결 {dateTime(d.created_at)} · 마지막 업로드 {relative(d.last_seen_at)}
        </div>
      </div>
      <div className="rec__actions">
        {editing ? (
          <>
            <Button variant="primary" size="sm" onClick={save}>
              저장
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
              취소
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              이름 바꾸기
            </Button>
            <Button variant="secondary" size="sm" onClick={disconnect}>
              연결 끊기
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
