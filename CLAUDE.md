# CLAUDE.md

carol live: 마이마이 플레이를 갤럭시 폰 하나로 유튜브 라이브하고, 녹화본을 클라우드에 올려 웹에서 구간만 잘라 받는 팀 캐롤 프로젝트.
사람용 설명·배포 절차는 `README.md`에 있음. 이 파일은 코드를 고칠 때 지켜야 할 것 위주.

## 구조

```
android/  Kotlin 앱 (com.teamcarol.live) — RootEncoder로 RTMP 송출 + 로컬 녹화 + 백그라운드 업로드
server/   Cloudflare Workers (Hono) + R2(영상) + D1(메타데이터) — 디스코드 로그인, 기기 업로드 API, Range 스트리밍
web/      React 19 + Vite + @team-carol/design-system — 드라이브형 녹화 목록, 브라우저 안 mp4 무손실 자르기
```

### android/app/src/main/java/com/teamcarol/live

| 파일 | 역할 |
|---|---|
| `LiveSession.kt` | 송출·녹화 파이프라인의 **유일한 소유자** (프로세스 단위 object). 액티비티는 preview를 붙였다 뗄 뿐 |
| `LiveService.kt` | camera·microphone 포그라운드 서비스. wake lock + Wi-Fi low-latency lock, 알림 갱신 |
| `MainActivity.kt` | UI만. `LiveSession.Listener`로 상태를 받아 `render()` |
| `StreamSettings.kt` | 설정 data class + SharedPreferences 저장 |
| `DeviceProbes.kt` | 후면 카메라 fps/노출 범위, USB 마이크 탐색, 배터리·발열 |
| `Recordings.kt` | `Movies/CarolLive` 저장, 저장공간 가드 (시작 2GB / 강제 종료 1GB) |
| `LiveSummary.kt` | 방송 결과 요약. `toWebJson()`이 서버·웹으로 감 |
| `Uploads.kt` | 페어링 설정, 업로드 큐, WorkManager `UploadWorker` (이어 올리기), 썸네일, 올린 뒤 폰에서 지우기(옵션, 서버 크기 = 로컬 크기일 때만) |
| `PairActivity.kt` | `carollive://paired` 딥링크 처리, nonce 검증 |
| `SummaryActivity.kt` / `SettingsActivity.kt` | 결과 요약 화면 / 설정 화면 |
| `Updates.kt` / `UpdateDialog.kt` | GitHub 최신 릴리스 확인(6시간 간격), 새 버전 안내 |
| `GameActivity.kt` | 마이크 원음에서 초당 버튼 클릭 수를 셈 → 녹화별로 잘라 업로드 때 `analysis`로 보냄. `MicEffects`가 감지기 → 리미터 순서로 묶음 |
| `ClickLimiter.kt` | 버튼 소리 줄이기 (끔/약/강). `tools/click-limiter.mjs`가 1:1 포트 |
| `YouTubeChat.kt` | 방송 화면 유튜브 채팅. 서버 `/api/device/youtube/*`로 라이브 찾기·채팅 폴링. 화면이 보일 때만 돎 |

### server/src, web/src

- `server/src/index.ts`: 모든 라우트. `/auth/*` (디스코드 OAuth, 기기 페어링), `/api/*` (웹, 세션 쿠키), `/api/device/*` (앱, 기기 토큰)
- `server/src/youtube.ts`: YouTube Data API v3 프록시 (채널 핸들 → 라이브 영상 → liveChatId, 채팅 메시지 정리)
- `server/src/pages.ts`: 페어링 완료/에러 HTML (carol.css 사용)
- `server/migrations/`: D1 스키마
- `web/src/lib/mp4trim.ts`: moov를 Range로 읽고 필요한 샘플 바이트만 받아 새 mp4를 씀 (재인코딩 없음)
- `web/src/lib/songs.ts`: 초당 클릭 수로 곡 구간 나누기(`findSongs`) + maimai 기록을 시간으로 맞추기(`matchPlays`). 기준값은 `web/test/fixtures/analysis-58min.json`(실제 58분 방송)과 `test/songs.test.ts`로 고정됨. 바꾸면 테스트가 통과해야 함
- `web/src/lib/chapters.ts`: 곡 목록 → 유튜브 설명란 챕터 (0:00 시작, 3개 이상, 10초 이상 규칙)
- `web/src/lib/shorts/`: 곡 구간 → 쇼츠 mp4. 수치·색·벡터는 전부 Figma mai-log 파일에서 옴
  - `layout.ts`: 레이아웃(`cardLayout` 곡 카드만 / `legacyLayout` 예전 레이아웃, 파란 배경 선택)과 `drawFrame`. 미리보기와 인코더가 같은 함수로 그림
  - `card.ts`(곡 카드: 자켓·난이도·ST/DX·곡명·레벨), `stats.ts`(영상 위 글자: 달성률 왼쪽 위, 랭크·마크 오른쪽 위), `profile.ts`(프로필 카드: 레이팅 틀은 Figma, 단·클래스는 maimai DX NET 이미지이고 못 받을 때만 Figma 배지), `draw.ts`(공통 캔버스 도구)
  - `images.ts`: maimai DX NET 이미지 경로와 번호 → 단/클래스/레이팅 색 (순수 함수, node 테스트)
  - `render.ts`: mediabunny로 디코드 → 오버레이 얹기 → H.264 인코드, 오디오는 복사. 편집 화면에서 필요할 때만 불러옴
- `web/src/lib/maimaiLabels.ts`: 난이도·랭크·FC/AP 라벨과 게임 색(`@team-carol/design-system/game`). node 테스트에서도 불러오게 번들러 전용 import 금지
- `web/src/lib/maimaiScrape.js`: maimai DX NET 기록 페이지에서 도는 북마클릿 본체 (순수 JS, 다른 파일 import 금지). 그 사이트 HTML에 기대고 있음. `scrapeMaimaiRecord`(플레이 기록) + `scrapeMaimaiProfile`(플레이어 데이터 페이지의 프로필). 고치면 사용자가 북마크를 다시 등록해야 반영됨
- `web/src/pages/`: `DrivePage`(목록), `EditorPage`(곡 목록 + 자르기), `ShortsCard`(쇼츠 미리보기·레이아웃·인코딩), `ProfileEditor`(프로필 직접 수정), `MaimaiPage`(기록 연결 안내 + `/import`), `DevicesPage`, `LoginPage`
- `web/src/api.ts`: 서버 타입·호출. `web/src/router.ts`: pathname 기반 간단한 라우터 (워커가 SPA fallback으로 index.html을 줌)

## 명령어

```bash
# android (RootEncoder를 android/RootEncoder에 먼저 받아둬야 함, gitignore 됨)
cd android && ./gradlew :app:assembleDebug        # Windows: .\gradlew.bat

# web
cd web && npm ci && npm run build                  # tsc --noEmit + vite build
cd web && SAMPLE_DIR=<mp4 폴더> npm test           # mp4trim 테스트 (ffmpeg/ffprobe 필요)

# server
cd server && npm ci && npm run typecheck
cd server && npm run db:migrate:local && npm run dev   # .dev.vars에 DEV_LOGIN=1 (README 참고)
```

CI(`.github/workflows/ci.yml`)는 PR과 main 푸시에서 android debug 빌드, web 빌드, server typecheck를 돌림. 고친 뒤 이 셋이 통과해야 함.

## 지켜야 할 것

### 디자인

- UI는 전부 [Carol Design System](https://github.com/team-carol/carol-design-system)을 씀
- android: 색·모서리·간격·글자 크기 hex/값은 `res/values/carol_tokens.xml`에만 있음. 레이아웃·drawable·코드는 `@color/crl_*`, `@dimen/crl_*`, `Crl.*` 스타일만 씀
- web: 가능하면 `@team-carol/design-system` React 컴포넌트를 씀. `app.css`에는 `var(--crl-*)` 토큰만 쓰고 생 색상값을 넣지 않음
- 폰트는 Pretendard. 화면 문구는 한국어

### android

- 카메라·인코더·RTMP는 `LiveSession`만 만지게 함. 액티비티가 꺼지거나 화면이 꺼져도 방송은 계속돼야 함 (뒤로 가기도 방송 유지)
- `targetSdk = 34`는 일부러 고정. 35 이상은 edge-to-edge 강제, 37은 로컬 네트워크 권한 때문에 올리기 전 확인 필요
- RootEncoder는 maven이 아니라 included build (`settings.gradle.kts`). 버전을 바꾸면 `ci.yml`과 `release.yml`의 `ROOTENCODER_SHA` 두 곳을 같이 바꿈
- 버전: 릴리스는 태그에서 `versionName`, run number에서 `versionCode`를 받음. `build.gradle.kts` 기본값은 로컬 빌드용

### 앱 ↔ 서버 ↔ 웹 계약

- `LiveSummary.toWebJson()` 키와 `web/src/api.ts`의 `LiveSummary` 타입은 같이 바꿈
- `GameActivity.toAnalysisJson()`(`clicksPerSecond`: 1초 1바이트 base64)와 `api.ts`의 `RecordingAnalysis`도 같이 바꿈. 곡 나누는 규칙은 웹에만 둠 (앱 릴리스 없이 고칠 수 있게)
- 쇼츠 카드의 모양(`shorts/card.ts`)은 Figma mai-log 카드가 기준. 카드 색은 영상에 얹는 그림이라 `--crl-*` 토큰이 아니라 `card.ts` 상수에 둠 (난이도 색은 디자인 시스템 game 토큰)
- 프로필은 `maimai_profiles` 테이블(사용자당 하나, JSON). `POST /api/plays`가 `profile`을 같이 받아 검사한 뒤 저장하고 `GET /api/maimai/profile`로 읽음. 손으로 고친 값은 `PUT /api/maimai/profile`(같은 검사). 모양은 `api.ts`의 `MaimaiProfile`
- maimai 기록은 `plays` 테이블(사용자별, `(played_at, track, title)`로 중복 없음). 녹화 상세 API가 녹화 시간 앞 5분~뒤 10분의 기록을 같이 내려줌
- 업로드 조각 크기는 서버(`PART_SIZE`)가 정해서 내려줌. 앱은 받은 `partSize`를 씀. `/api/device/*` 응답 모양을 바꾸면 `Uploads.kt`도 같이 고침
- 이미 배포된 앱이 있으니 기기 API는 하위 호환을 유지함 (필드 추가는 OK, 이름 변경·삭제는 피함)
- D1 스키마 변경은 `server/migrations/000N_*.sql` 새 파일로. 이미 있는 마이그레이션은 고치지 않음
- 저장 한도(`STORAGE_CAP_BYTES`, 기본 100GB)를 넘으면 팀 전체에서 가장 오래된 녹화부터 지움 (`makeRoom`)

### 보안

- `android/keystore.properties`, `*.jks`, `server/.dev.vars`는 절대 커밋하지 않음 (`.gitignore`에 있음)
- `DEV_LOGIN=1`은 로컬 전용. `wrangler.jsonc` vars나 운영 secret에 넣지 않음
- 운영 주소는 `https://live.team-carol.com` 하나 (`workers_dev: false`). OAuth redirect와 페어링 주소가 요청 origin에서 만들어지기 때문
- `DISCORD_CLIENT_SECRET`, `ALLOWED_DISCORD_IDS`(팀원 디스코드 ID), `YOUTUBE_API_KEY`는 `wrangler secret`으로만 넣음. 공개 레포라 `wrangler.jsonc`에 쓰지 않음. 유튜브 키를 앱에 넣지 않음

### 유튜브 할당량

- YouTube Data API는 하루 10,000 단위를 팀 전체가 같이 씀. 채팅 폴링 1번 = 5 단위, `search.list`는 하루 100번 제한
- 그래서 채팅은 방송 중 + 앱 화면이 보일 때만 불러오고, 조용하면 12초 간격으로 늦춤. 폴링 간격을 줄이거나 화면 꺼진 상태에서 불러오게 바꾸지 않음
- 라이브 찾기는 업로드 목록(2 단위)을 먼저 보고, `search.list`는 세 번에 한 번(`deep=1`)만 씀
- 유튜브 스트림 키는 폰 앱 설정에만 저장됨. 코드·로그·이슈에 남기지 않음
- 기기 토큰은 서버에 sha256 해시로만 저장. 페어링은 앱이 만든 nonce가 돌아와야만 받아들임
- 웹 API는 항상 로그인한 사용자 본인의 녹화만 돌려줌 (`user_id` 조건 빠뜨리지 않기). maimai 기록(`plays`)도 마찬가지
- maimai DX NET 로그인 정보는 다루지 않음. 북마클릿은 사용자가 보고 있는 기록 페이지의 DOM과, 같은 사이트의 플레이어 데이터 페이지(프로필)만 읽고, 데이터는 URL fragment로 `/import`에 넘김. 읽는 범위를 넓히면 `MaimaiPage`의 안내 문구도 같이 고침
- `/api/maimai/img/*`는 maimai DX NET 이미지 중계. 정해진 경로(`Music/`, `Icon/`, `playlog/`, `course/`, `class/`, `music_*`, `diff_*`의 png)만 통과시키고 로그인한 사용자만 씀. 아무 주소나 받아오게 넓히지 않음.
  게임 이미지는 레포에 넣지 않고 그때그때 받아옴

## 릴리스

- main에 머지 → Actions의 Release를 `Run workflow`(버전 입력, 폰에서도 됨) 또는 `git tag vX.Y.Z && git push origin vX.Y.Z` → `release.yml`이 서명된 APK를 GitHub Releases에 올림
- 서버·웹은 main에 `server/`·`web/` 변경이 들어오면 `deploy.yml`이 D1 마이그레이션 + `wrangler deploy` (Secret `CLOUDFLARE_API_TOKEN`). 수동 배포는 필요 없음
- 앱은 `releases/latest`의 첫 `.apk` 에셋을 새 버전으로 봄. 에셋 이름 패턴(`carol-live-vX.Y.Z.apk`)을 바꿔도 `.apk`로 끝나야 함
- 서명 Secret 4개(`ANDROID_KEYSTORE_BASE64` 등)는 이미 등록돼 있음

## 작업 방식

- 커밋 메시지: `feat: …`, `fix: …`, `ci: …`, `chore: …` + 한국어 요약
- 기능은 브랜치 → PR → CI 통과 후 main 머지
- 개발 PC는 Windows 노트북 (PowerShell, Android Studio 없이 command-line SDK + 무선 adb). 테스트 폰은 갤럭시 S25, DJI Mic Mini 수신기를 USB-C로 꽂아 씀
