import { useState } from "react";
import { Button, Select, TextInput } from "@team-carol/design-system/react";
import { api, type MaimaiProfile } from "../api";
import { CLASS_NUMBERS, DAN_NUMBERS, classOf, danOf } from "../lib/shorts/images";

interface Props {
  profile: MaimaiProfile | null;
  disabled: boolean;
  /** every edit, so the shorts preview follows while typing */
  onChange: (profile: MaimaiProfile) => void;
}

const number = (text: string): number | undefined => {
  const n = Number(text.replace(/[^\d]/g, ""));
  return /\d/.test(text) && Number.isFinite(n) ? n : undefined;
};

/** the player info of the profile card, typed by hand: fixes what the bookmarklet read, or works without it */
export function ProfileEditor({ profile, disabled, onChange }: Props) {
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const p: MaimaiProfile = profile ?? { name: "" };
  const set = (patch: Partial<MaimaiProfile>) => {
    setState("idle");
    onChange({ ...p, ...patch });
  };

  const save = async () => {
    setError(null);
    setState("busy");
    try {
      onChange((await api.saveMaimaiProfile(p)).profile);
      setState("saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  };

  return (
    <div className="profile-edit">
      <TextInput label="닉네임" value={p.name} maxLength={32} disabled={disabled} onChange={(e) => set({ name: e.target.value })} />
      <div className="profile-edit__row">
        <TextInput
          label="레이팅"
          value={p.rating ?? ""}
          inputMode="numeric"
          maxLength={5}
          disabled={disabled}
          // the frame colour follows the number once it is typed by hand
          onChange={(e) => set({ rating: number(e.target.value), ratingBase: undefined })}
        />
        <Select
          label="단"
          value={p.course ?? ""}
          disabled={disabled}
          // the badge image belongs to the old dan, so the drawn badge takes over
          onChange={(e) => set({ course: e.target.value === "" ? undefined : Number(e.target.value), courseImg: undefined })}
        >
          <option value="">없음</option>
          {DAN_NUMBERS.map((n) => (
            <option key={n} value={n}>
              {danOf(n)?.label}
            </option>
          ))}
        </Select>
        <Select
          label="클래스"
          value={p.cls ?? ""}
          disabled={disabled}
          onChange={(e) => set({ cls: e.target.value === "" ? undefined : Number(e.target.value), classImg: undefined })}
        >
          <option value="">없음</option>
          {CLASS_NUMBERS.map((n) => (
            <option key={n} value={n}>
              {classOf(n)?.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="profile-edit__row">
        <TextInput
          label="플레이 수 (전체)"
          value={p.playCount ?? ""}
          inputMode="numeric"
          maxLength={7}
          disabled={disabled}
          onChange={(e) => set({ playCount: number(e.target.value) })}
        />
        <TextInput
          label="이번 버전"
          value={p.playCountCurrent ?? ""}
          inputMode="numeric"
          maxLength={7}
          disabled={disabled}
          onChange={(e) => set({ playCountCurrent: number(e.target.value) })}
        />
      </div>
      <div className="panel-actions">
        <Button variant="secondary" size="sm" onClick={save} disabled={disabled || state === "busy" || !p.name.trim()}>
          {state === "busy" ? "저장 중…" : state === "saved" ? "저장됨" : "프로필 저장"}
        </Button>
      </div>
      {error && <p className="crl-helper crl-helper--error">{error}</p>}
      <p className="crl-helper">
        고치면 미리보기에 바로 보이고, 저장하면 다음에도 씁니다. 단·클래스를 직접 고르면 그린 배지로 나옵니다. 아이콘은 북마크로만 가져올 수 있고,
        북마크를 다시 누르면 그때 값으로 덮어씁니다.
      </p>
    </div>
  );
}
