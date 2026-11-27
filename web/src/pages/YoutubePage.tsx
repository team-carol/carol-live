import { useEffect, useState } from "react";
import { Button, Card, CardBody, CardTitle, Select, Tag, TextArea, TextInput } from "@team-carol/design-system/react";
import { api, type YoutubeAccount, type YoutubePreset, type YoutubePresetInput, type YoutubePrivacy } from "../api";
import { fitThumbnail } from "../lib/thumbnail";

const PRIVACY: { value: YoutubePrivacy; label: string }[] = [
  { value: "public", label: "공개" },
  { value: "unlisted", label: "일부 공개" },
  { value: "private", label: "비공개" },
];
const privacyLabel = (p: YoutubePrivacy) => PRIVACY.find((x) => x.value === p)?.label ?? p;
const PRESET_MAX = 20;
/** yyyy-MM-dd, as the app writes {date} */
const TODAY = new Date().toLocaleDateString("sv-SE");
const BLANK: YoutubePresetInput = { name: "", title: "{date} maimai", description: "", privacy: "unlisted" };

/** what came back from the Google consent screen (/auth/youtube/callback → /youtube?link=…) */
function linkResult(): "ok" | "denied" | null {
  const v = new URLSearchParams(location.search).get("link");
  return v === "ok" || v === "denied" ? v : null;
}

/** link a YouTube channel and keep the presets the app starts a broadcast from */
export function YoutubePage() {
  const [account, setAccount] = useState<YoutubeAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linked] = useState(linkResult);
  /** preset id being edited, "new", or null */
  const [editing, setEditing] = useState<string | null>(null);

  const load = () =>
    api
      .youtube()
      .then(setAccount)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // the result is shown once; a reload should not show it again
    if (location.search) history.replaceState(null, "", location.pathname);
  }, []);

  const unlink = async () => {
    if (!confirm("유튜브 채널 연결을 끊을까요? 다시 연결하기 전까지 앱에서 방송을 만들 수 없습니다. 프리셋은 그대로 남습니다")) return;
    try {
      await api.unlinkYoutube();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (p: YoutubePreset) => {
    if (!confirm(`프리셋 "${p.name}"을(를) 지울까요?`)) return;
    try {
      await api.deleteYoutubePreset(p.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const done = async () => {
    setEditing(null);
    await load();
  };

  return (
    <>
      <header className="page-head">
        <h1 className="crl-heading-2">유튜브 방송</h1>
        <p className="crl-body-sm">
          유튜브 채널을 연결하면 폰 앱에서 스트림 키 없이 방송을 시작할 수 있습니다. 시작할 때 제목·설명·공개 범위·썸네일을 정하고, 자주 쓰는
          조합은 여기에서 프리셋으로 만들어 둡니다.
        </p>
      </header>
      {error && <p className="crl-helper crl-helper--error">{error}</p>}
      {linked === "ok" && <p className="yt-notice yt-notice--ok">채널을 연결했습니다.</p>}
      {linked === "denied" && <p className="yt-notice yt-notice--bad">연결하지 않았습니다. 구글 화면에서 허용해야 연결됩니다.</p>}

      {account && (
        <>
          <Card className="yt-channel">
            <div className="yt-channel__main">
              <CardTitle>채널</CardTitle>
              {account.channel ? (
                <div className="rec__title">
                  <span className="rec__date">{account.channel.title}</span>
                  <Tag tone="success">연결됨</Tag>
                </div>
              ) : (
                <CardBody>
                  {account.configured
                    ? "연결된 채널이 없습니다. 구글 계정을 고른 다음, 채널이 여러 개면 방송을 만들 채널을 고릅니다."
                    : "서버에 유튜브 연결 설정이 아직 없습니다. README의 유튜브 연결 설정을 먼저 해 주세요."}
                </CardBody>
              )}
              <p className="crl-caption yt-channel__note">
                방송 만들기·끝내기와 썸네일 올리기에만 씁니다. 연결 정보는 서버에만 암호화해서 두고, 폰과 이 화면에는 내려보내지 않습니다.
              </p>
            </div>
            <div className="rec__actions">
              {account.channel ? (
                <>
                  <Button variant="secondary" size="sm" href={api.youtubeLinkUrl}>
                    다시 연결
                  </Button>
                  <Button variant="secondary" size="sm" onClick={unlink}>
                    연결 끊기
                  </Button>
                </>
              ) : account.configured ? (
                <Button variant="primary" size="sm" href={api.youtubeLinkUrl}>
                  채널 연결
                </Button>
              ) : null}
            </div>
          </Card>

          <div className="yt-head">
            <h2 className="crl-heading-4">프리셋</h2>
            {editing !== "new" && account.presets.length < PRESET_MAX && (
              <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
                새 프리셋
              </Button>
            )}
          </div>
          {editing === "new" && <PresetEditor preset={null} onDone={done} onCancel={() => setEditing(null)} />}
          {account.presets.length === 0 && editing !== "new" && (
            <Card className="empty">
              <p className="crl-card__body">프리셋이 없습니다. 없어도 앱에서 제목을 직접 적고 방송할 수 있습니다.</p>
            </Card>
          )}
          <div className="rec-list">
            {account.presets.map((p) =>
              editing === p.id ? (
                <PresetEditor key={p.id} preset={p} onDone={done} onCancel={() => setEditing(null)} />
              ) : (
                <Card as="article" className="rec yt-preset" key={p.id}>
                  {p.hasThumbnail ? (
                    <img className="yt-thumb" src={api.youtubeThumbUrl(p)} alt="" />
                  ) : (
                    <div className="yt-thumb yt-thumb--none">썸네일 없음</div>
                  )}
                  <div className="rec__main">
                    <div className="rec__title">
                      <span className="rec__date">{p.name}</span>
                      <Tag>{privacyLabel(p.privacy)}</Tag>
                    </div>
                    <div className="yt-preset__title">{p.title}</div>
                    {p.description && <div className="rec__meta crl-caption yt-preset__desc">{p.description}</div>}
                  </div>
                  <div className="rec__actions">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(p.id)}>
                      고치기
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => remove(p)}>
                      지우기
                    </Button>
                  </div>
                </Card>
              ),
            )}
          </div>
        </>
      )}
    </>
  );
}

function PresetEditor({ preset, onDone, onCancel }: { preset: YoutubePreset | null; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<YoutubePresetInput>(
    preset ? { name: preset.name, title: preset.title, description: preset.description, privacy: preset.privacy } : BLANK,
  );
  /** a newly picked picture, "remove" to take the saved one away, or null to leave it */
  const [image, setImage] = useState<Blob | "remove" | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!(image instanceof Blob)) return setPreview(null);
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const set = <K extends keyof YoutubePresetInput>(k: K, v: YoutubePresetInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setImage(await fitThumbnail(file));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = preset ? preset.id : (await api.createYoutubePreset(form)).id;
      if (preset) await api.saveYoutubePreset(id, form);
      if (image instanceof Blob) await api.setYoutubeThumbnail(id, image);
      else if (image === "remove" && preset?.hasThumbnail) await api.deleteYoutubeThumbnail(id);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const shown = preview ?? (image !== "remove" && preset?.hasThumbnail ? api.youtubeThumbUrl(preset) : null);

  return (
    <Card className="yt-edit">
      <CardTitle>{preset ? "프리셋 고치기" : "새 프리셋"}</CardTitle>
      <div className="yt-edit__grid">
        <div className="yt-edit__fields">
          <TextInput label="프리셋 이름" value={form.name} maxLength={30} placeholder="평일 방송" onChange={(e) => set("name", e.target.value)} />
          <TextInput
            label="방송 제목"
            value={form.title}
            maxLength={100}
            helperText={`{date}는 방송하는 날짜(${TODAY})로 바뀝니다. 앱에서 시작하기 전에 고칠 수 있습니다.`}
            onChange={(e) => set("title", e.target.value)}
          />
          <TextArea label="설명" value={form.description} rows={5} maxLength={5000} onChange={(e) => set("description", e.target.value)} />
          <Select label="공개 범위" value={form.privacy} onChange={(e) => set("privacy", e.target.value as YoutubePrivacy)}>
            {PRIVACY.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="yt-edit__thumb">
          <span className="crl-label">썸네일</span>
          {shown ? <img className="yt-thumb yt-thumb--large" src={shown} alt="" /> : <div className="yt-thumb yt-thumb--large yt-thumb--none">썸네일 없음</div>}
          <div className="yt-edit__thumb-actions">
            <label className="crl-btn crl-btn--secondary crl-btn--sm">
              그림 고르기
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void pick(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {shown && (
              <Button variant="secondary" size="sm" onClick={() => setImage("remove")}>
                빼기
              </Button>
            )}
          </div>
          <p className="crl-caption">
            16:9 (1280×720)가 맞습니다. 2MB가 넘거나 JPG·PNG가 아니면 줄여서 올립니다. 썸네일은 채널이 유튜브에서 전화번호 인증을 마쳐야
            적용됩니다.
          </p>
        </div>
      </div>
      {error && <p className="crl-helper crl-helper--error">{error}</p>}
      <div className="yt-edit__actions">
        <Button variant="primary" size="sm" onClick={save} disabled={busy || !form.name.trim() || !form.title.trim()}>
          {busy ? "저장하는 중…" : "저장"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
          취소
        </Button>
      </div>
    </Card>
  );
}
