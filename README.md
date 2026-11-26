# carol live

마이마이 플레이를 폰 하나로 유튜브 라이브하고, 녹화본을 웹에서 보고 원하는 구간만 잘라 받는 프로젝트.
UI는 전부 [Carol Design System](https://github.com/team-carol/carol-design-system)을 씀.

```
carol-live/
├─ android/   폰 앱 (Kotlin, RootEncoder) — 송출·녹화·업로드
├─ server/    Cloudflare Workers + R2 + D1 — 로그인·업로드 API·파일 제공
└─ web/       React + @team-carol/design-system — 드라이브형 녹화 목록·구간 자르기
```

## 흐름

1. 앱에서 방송(+녹화). 화면이 꺼져도 포그라운드 서비스로 계속 송출됨
2. 방송이 끝나면 결과 요약 화면이 뜨고, 녹화 파일이 업로드 대기열에 들어감
3. 와이파이가 잡히면 50MB 조각으로 이어 올림 (끊겨도 이어서), 끝나면 썸네일도 올림
4. 웹에서 디스코드 로그인 → 기기별 폴더에서 영상 열기 → 시작·끝 지정 → **재인코딩 없이** 잘라 받기
   (필요한 구간의 바이트만 Range로 받아서 브라우저에서 mp4를 새로 씀)

## android

```powershell
cd android
git clone --depth 1 https://github.com/pedroSG94/RootEncoder.git   # 처음 한 번 (gitignore 됨)
.\gradlew.bat :app:assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

- 색·모서리·간격 토큰은 `app/src/main/res/values/carol_tokens.xml` 에만 있음. 다른 곳은 `@color/crl_*`
- 폰트: Pretendard (OFL, `app/src/main/assets/licenses`)

## 릴리스 (폰에서 APK 받기)

GitHub Actions가 서명된 APK를 만들어 [Releases](https://github.com/team-carol/carol-live/releases)에 올림.
앱은 최신 릴리스를 확인해서 새 버전이 있으면 화면 오른쪽 위에 **새 버전** 버튼을 띄움 (설정 → 앱 정보 → 업데이트 확인으로도 가능).
설치할 때만 갤럭시 '보안 위험 자동 차단'을 잠깐 꺼야 함.

릴리스하는 방법은 둘 중 하나 (PR들을 main에 머지한 다음):

- **웹/폰에서**: [Actions → Release](https://github.com/team-carol/carol-live/actions/workflows/release.yml) → **Run workflow** →
  branch `main`, 버전 `0.5.0` 입력 → 실행. main 최신 커밋에 `v0.5.0` 태그를 만들고 릴리스함
- **터미널에서**: `git tag v0.5.0 && git push origin v0.5.0`

이미 있는 버전 번호는 거부됨. 앱은 숫자로 비교하니 항상 올려서 씀.

### 서명 키 (처음 한 번)

업데이트가 덮어써지려면 항상 같은 키로 서명해야 함. 키는 레포에 올리지 않음(`.gitignore`).

```powershell
cd android
keytool -genkeypair -v -keystore release.jks -storetype PKCS12 -alias carol-live -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=carol live, O=team carol"
# 비밀번호를 물어보면 하나 정해서 두 번 입력

# 로컬에서 release 빌드할 때 쓰는 파일 (gitignore 됨)
@"
storeFile=release.jks
storePassword=<비밀번호>
keyAlias=carol-live
keyPassword=<비밀번호>
"@ | Set-Content keystore.properties

# GitHub Secret에 넣을 값을 클립보드로 복사
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.jks")) | Set-Clipboard
```

GitHub 레포 → Settings → Secrets and variables → Actions → New repository secret:

| 이름 | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 위에서 클립보드로 복사한 값 |
| `ANDROID_KEYSTORE_PASSWORD` | 비밀번호 |
| `ANDROID_KEY_ALIAS` | `carol-live` |
| `ANDROID_KEY_PASSWORD` | 비밀번호 (PKCS12라 같은 값) |

`release.jks`와 비밀번호는 잃어버리면 기존 설치본 위에 업데이트를 못 하니 따로 백업해둘 것.

## server + web 배포

주소는 `https://live.team-carol.com` (`wrangler.jsonc`의 `routes`). team-carol.com이 같은 Cloudflare 계정에 있어서
배포하면 DNS·인증서가 자동으로 붙음. 이 주소 하나만 씀 (`workers_dev: false`).

Windows PowerShell에서 `npm`/`npx`가 "스크립트를 실행할 수 없으므로"로 막히면
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`를 한 번 하거나 `npm.cmd`/`npx.cmd`로 실행.

처음 한 번 (R2 버킷 `carol-live`, D1 `carol-live`는 team carol 계정에 이미 있음. 새 계정에 세울 때만):

1. [디스코드 개발자 포털](https://discord.com/developers/applications)에서 앱 만들기
   → OAuth2 → Redirects에 `https://live.team-carol.com/auth/callback` 추가 → Client ID / Client Secret 복사
2. Cloudflare 대시보드 → R2 → 사용 설정 (무료 10GB, 결제 수단 등록이 필요할 수 있음)
3. 리소스 만들기
   ```bash
   cd server && npm install
   npx wrangler login
   npx wrangler r2 bucket create carol-live
   npx wrangler d1 create carol-live        # 나온 database_id를 wrangler.jsonc에 붙여넣기
   ```
   `d1 create`가 "add it on your behalf?"라고 물으면 **no**. 바인딩 이름이 `DB`여야 해서 직접 붙여넣는 게 맞음
4. `wrangler.jsonc` 채우기 (둘 다 비밀값 아님)
   - `database_id`
   - `vars.DISCORD_CLIENT_ID`
   - `vars.STORAGE_CAP_BYTES`: 기본 100GB. 넘으면 팀 전체에서 가장 오래된 녹화부터 지움
     (R2는 10GB까지 무료, 그 뒤 GB당 월 $0.015라 100GB를 꽉 채워도 월 약 $1.35. 다운로드 트래픽은 무료)
5. DB 테이블 만들고 배포
   ```bash
   npm run db:migrate:remote
   (cd ../web && npm install)
   npm run deploy          # web을 빌드해서 워커의 정적 파일로 같이 올림
   ```
6. 비밀값 넣기 (레포에 안 올라감)
   ```bash
   npx wrangler secret put DISCORD_CLIENT_SECRET
   npx wrangler secret put ALLOWED_DISCORD_IDS     # 로그인 허용할 팀원 디스코드 ID, 쉼표로 구분
   ```
   디스코드 ID: 디스코드 설정 → 고급 → 개발자 모드 켜기 → 프로필 우클릭 → 사용자 ID 복사

이후 배포는 자동임: main에 `server/`나 `web/` 변경이 들어오면 [Deploy server](https://github.com/team-carol/carol-live/actions/workflows/deploy.yml)가
D1 마이그레이션 + `wrangler deploy`를 함 (Actions 탭에서 Run workflow로 수동 실행도 됨). 터미널에서 직접 하려면 `cd server && npm run deploy`.

자동 배포용 토큰 (처음 한 번):
1. Cloudflare 대시보드 → 오른쪽 위 프로필 → 내 프로필 → API 토큰 → 토큰 생성 → **Cloudflare Workers 편집** 템플릿
2. 권한에 **계정 · D1 · 편집** 추가, 영역 리소스는 `team-carol.com`
3. 만든 토큰을 GitHub [Settings → Secrets → Actions](https://github.com/team-carol/carol-live/settings/secrets/actions)에 `CLOUDFLARE_API_TOKEN`으로 등록

워커 비밀값(`DISCORD_CLIENT_SECRET` 등)은 터미널 없이 Cloudflare 대시보드 → Workers 및 Pages → carol-live → 설정 → 변수 및 비밀에서도 추가·변경할 수 있음.
배포해도 비밀값은 그대로 남음.

### 로컬 개발

```bash
cd server
printf 'DEV_LOGIN=1\nALLOWED_DISCORD_IDS=dev\nDISCORD_CLIENT_SECRET=x\n' > .dev.vars
npm run db:migrate:local && npm run dev          # http://localhost:8787
# 다른 터미널: cd web && npm run dev   (API는 8787로 프록시)
```

`DEV_LOGIN=1`이면 `/auth/dev?id=dev&name=나`로 디스코드 없이 로그인됨. 운영에는 절대 넣지 말 것.

### 테스트

```bash
cd web && SAMPLE_DIR=<mp4 폴더> npm test    # mp4 무손실 자르기 (ffmpeg/ffprobe 필요)
cd server && npm run typecheck
```

## 앱 ↔ 서버 연결 (기기 페어링)

앱 설정 → 업로드에서 서버 주소(기본값 `https://live.team-carol.com`)와 기기 이름(기본값은 폰 이름)을 확인하고 **연결하기**
→ 브라우저에서 디스코드 로그인 한 번 → `carollive://paired`로 앱에 기기 토큰이 돌아옴.
앱이 연결을 시작할 때 만든 nonce가 같이 돌아와야만 받아들임. 웹의 **기기** 메뉴에서 이름 변경·연결 해제 가능.
