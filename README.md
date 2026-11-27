# carol live

마이마이 플레이를 폰 하나로 유튜브 라이브하고, 녹화본을 웹에서 보고 원하는 구간만 잘라 받는 프로젝트입니다.
UI는 전부 [Carol Design System](https://github.com/team-carol/carol-design-system)을 씁니다.

```
carol-live/
├─ android/   폰 앱 (Kotlin, RootEncoder) — 송출·녹화·업로드
├─ server/    Cloudflare Workers + R2 + D1 — 로그인·업로드 API·파일 제공
└─ web/       React + @team-carol/design-system — 드라이브형 녹화 목록·구간 자르기
```

## 흐름

1. 앱에서 방송(+녹화)을 합니다. 화면이 꺼져도 포그라운드 서비스로 계속 송출됩니다.
   스트림 키를 넣어 두는 방식과, 유튜브 채널을 연결해 두고 시작할 때 제목·설명·공개 범위·썸네일을 정하는 방식이 있습니다
   ([유튜브 계정으로 방송](#유튜브-계정으로-방송-제목설명썸네일)).
2. 방송이 끝나면 결과 요약 화면이 뜨고, 녹화 파일이 업로드 대기열에 들어갑니다.
3. 와이파이가 잡히면 50MB 조각으로 이어 올리고(끊겨도 이어서 올립니다), 끝나면 썸네일도 올립니다.
4. 웹에서 디스코드로 로그인한 뒤 기기별 폴더에서 영상을 열고, 시작·끝을 지정해 **재인코딩 없이** 잘라 받습니다.
   (필요한 구간의 바이트만 Range로 받아서 브라우저에서 mp4를 새로 씁니다.)

### 곡 단위로 나누기 (앱 v0.6+ 녹화)

- 앱이 녹화하면서 마이크로 **초당 버튼 클릭 수**를 세서 업로드할 때 같이 보냅니다 (`GameActivity.kt`).
- 웹이 그 값으로 곡 구간을 나눕니다 (`web/src/lib/songs.ts`). 게임 중에는 초당 5~15번 몰아치고, 곡 선택·결과 화면은 띄엄띄엄이거나 조용합니다.
  곡 중간 30초 안쪽의 쉬는 부분은 이어 붙이고, 곡 선택 때 두드린 것은 빼냅니다. 기준값은 58분짜리 실제 방송으로 맞췄습니다 (`web/test/fixtures`).
- 편집기에서 곡마다 **재생 / 받기**를 한 번 누르면 그 곡만 잘립니다 (앞뒤 5초 여유). 시작·끝은 ±1·5초 버튼으로 손가락으로도 조정할 수 있습니다.
- **유튜브 챕터**: 곡 목록으로 `3:04 Titania [MASTER 14+] 100.3887% SSS+ AP` 같은 줄을 만들어 복사합니다. 방송 영상 설명란에 붙이면 챕터가 됩니다.
  방송과 녹화의 시작 차이는 요약의 시작 시각으로 자동 보정하고, ±1초로 맞출 수 있습니다 (`web/src/lib/chapters.ts`).
- **곡 이름**: 웹 상단 `maimai` 메뉴의 북마크를 maimai DX NET 플레이 기록 페이지에서 누르면 최근 50곡(곡명·난이도·달성률·랭크·FC/AP·초 단위 시각)을
  가져옵니다. 녹화 시간과 맞춰서 곡에 이름이 붙습니다. 기록 페이지 HTML이 바뀌면 `web/src/lib/maimaiScrape.js`를 고칩니다.
- **쇼츠**: 곡 이름이 붙은 곡은 `쇼츠` 버튼으로 1080×1920 mp4를 만듭니다 (`web/src/lib/shorts/`). 화면을 9:16으로 채우고 곡 카드·달성률·랭크/마크·프로필 카드를
  얹어 브라우저에서 다시 인코딩합니다 (WebCodecs, 소리는 원본 그대로). 크롬·엣지에서 동작합니다.
- **프로필**: 닉네임·레이팅·아이콘·단·클래스·플레이 수는 북마크가 플레이어 데이터 페이지에서 같이 읽어옵니다. 쇼츠 에디터의 `닉네임·레이팅 수정`에서 직접 적거나
  고칠 수도 있습니다 (아이콘만 북마크로 가져옵니다). 칭호와 ★ 개수는 넣지 않습니다. **북마크 코드가 바뀌었으니 `maimai` 메뉴에서 다시 등록**해야 프로필이 들어옵니다.

### 쇼츠 에디터

플레이어 아래에 열리며, 영상 편집기처럼 미리보기에서 직접 편집합니다.

- **고르고 옮기기**: 미리보기에서 요소를 눌러 고르고 끌어서 옮깁니다. 달성률·랭크/마크는 모서리 점을 끌면 크기가 바뀌고, 방향키로 조금씩 옮길 수 있습니다.
  빈 곳을 끌면 영상이 위아래·좌우로 움직입니다 (영상이 창보다 큰 방향으로만). 휴대폰에서는 위치 슬라이더가 같이 나옵니다.
- **맞춤선**: 끌 때 화면 가운데·좌우 여백·다른 요소의 모서리와 가운데에 붙고, 그 선이 보입니다. Alt를 누르면 붙지 않고 자유롭게 움직입니다.
- **요소 목록**: 옆의 목록에서 체크로 켜고 끄며, 고른 요소의 설정만 그 아래에 나옵니다.
  - 곡 카드: 간단 / 성적 줄이 있는 Figma 원본. 레벨은 `14.6`처럼 직접 고칠 수 있고 곡별로 기억합니다 (maimai DX NET은 `14+`까지만 알려 줍니다).
  - 랭크·마크: maimai DX NET 이미지 / 글자, 세로 / 가로
  - 프로필 카드: 단·클래스를 넷 이미지 / Figma 배지로
  - 배경·영상: 카드 뒤 파란 배경, 글자 뒤 그라데이션 세기, 영상 높이·좌우·확대
- **구성**: 곡 카드만 / 레거시 / 레거시(원본 카드) / 카드 없이 중에서 골라 시작합니다. 지금 구성을 이름 붙여 저장해 두고 다시 불러올 수 있습니다
  (브라우저에 저장하며, 영상 높이·좌우·확대는 영상마다 달라서 저장하지 않습니다). 마지막 구성도 브라우저에 기억됩니다.
- **실행 취소**: Ctrl+Z로 취소하고 Ctrl+Shift+Z로 다시 실행합니다.
- **재생**: 미리보기 아래 `재생`을 누르면 플레이어가 구간을 재생하고, 미리보기가 프레임마다 따라갑니다.
- **이미지**: 자켓·ST/DX·랭크·마크·아이콘·단·클래스는 maimai DX NET 이미지를 서버(`/api/maimai/img/…`)를 거쳐 받아옵니다. 받지 못하면 글자·빈 칸·Figma 배지로 그립니다.

## android

```powershell
cd android
git clone --depth 1 https://github.com/pedroSG94/RootEncoder.git   # 처음 한 번 (gitignore 됨)
.\gradlew.bat :app:assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

- 색·모서리·간격 토큰은 `app/src/main/res/values/carol_tokens.xml`에만 있습니다. 다른 곳에서는 `@color/crl_*`를 씁니다.
- 폰트는 Pretendard입니다 (OFL, `app/src/main/assets/licenses`).

## 릴리스 (폰에서 APK 받기)

GitHub Actions가 서명된 APK를 만들어 [Releases](https://github.com/team-carol/carol-live/releases)에 올립니다.
앱은 최신 릴리스를 확인해서 새 버전이 있으면 화면 오른쪽 위에 **새 버전** 버튼을 띄웁니다 (설정 → 앱 정보 → 업데이트 확인으로도 볼 수 있습니다).
설치할 때만 갤럭시의 '보안 위험 자동 차단'을 잠깐 꺼야 합니다.

릴리스 방법은 둘 중 하나입니다 (PR들을 main에 머지한 다음에 합니다).

- **웹/폰에서**: [Actions → Release](https://github.com/team-carol/carol-live/actions/workflows/release.yml) → **Run workflow** →
  branch `main`, 버전 `0.5.0`을 입력하고 실행합니다. main 최신 커밋에 `v0.5.0` 태그를 만들고 릴리스합니다.
- **터미널에서**: `git tag v0.5.0 && git push origin v0.5.0`

이미 있는 버전 번호는 거부됩니다. 앱은 숫자로 비교하므로 항상 더 큰 번호를 씁니다.

### 서명 키 (처음 한 번)

업데이트가 기존 앱을 덮어쓰려면 항상 같은 키로 서명해야 합니다. 키는 레포에 올리지 않습니다 (`.gitignore`).

```powershell
cd android
keytool -genkeypair -v -keystore release.jks -storetype PKCS12 -alias carol-live -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=carol live, O=team carol"
# 비밀번호를 물어보면 하나 정해서 두 번 입력합니다

# 로컬에서 release 빌드할 때 쓰는 파일 (gitignore 됨)
@"
storeFile=release.jks
storePassword=<비밀번호>
keyAlias=carol-live
keyPassword=<비밀번호>
"@ | Set-Content keystore.properties

# GitHub Secret에 넣을 값을 클립보드로 복사합니다
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.jks")) | Set-Clipboard
```

GitHub 레포 → Settings → Secrets and variables → Actions → New repository secret에 아래 값을 넣습니다.

| 이름 | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 위에서 클립보드로 복사한 값 |
| `ANDROID_KEYSTORE_PASSWORD` | 비밀번호 |
| `ANDROID_KEY_ALIAS` | `carol-live` |
| `ANDROID_KEY_PASSWORD` | 비밀번호 (PKCS12라 같은 값) |

`release.jks`와 비밀번호를 잃어버리면 기존 설치본 위에 업데이트할 수 없으니 따로 백업해 두시기 바랍니다.

## server + web 배포

주소는 `https://live.team-carol.com`입니다 (`wrangler.jsonc`의 `routes`). team-carol.com이 같은 Cloudflare 계정에 있어서
배포하면 DNS·인증서가 자동으로 붙습니다. 이 주소 하나만 씁니다 (`workers_dev: false`).

Windows PowerShell에서 `npm`/`npx`가 "스크립트를 실행할 수 없으므로"라며 막히면
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`를 한 번 실행하거나 `npm.cmd`/`npx.cmd`로 실행합니다.

처음 한 번만 하는 설정입니다 (R2 버킷 `carol-live`와 D1 `carol-live`는 team carol 계정에 이미 있으므로, 새 계정에 세울 때만 필요합니다).

1. [디스코드 개발자 포털](https://discord.com/developers/applications)에서 앱을 만듭니다.
   OAuth2 → Redirects에 `https://live.team-carol.com/auth/callback`을 추가하고 Client ID / Client Secret을 복사합니다.
2. Cloudflare 대시보드 → R2 → 사용 설정을 합니다 (무료 10GB, 결제 수단 등록이 필요할 수 있습니다).
3. 리소스를 만듭니다.
   ```bash
   cd server && npm install
   npx wrangler login
   npx wrangler r2 bucket create carol-live
   npx wrangler d1 create carol-live        # 나온 database_id를 wrangler.jsonc에 붙여넣기
   ```
   `d1 create`가 "add it on your behalf?"라고 물으면 **no**를 고릅니다. 바인딩 이름이 `DB`여야 해서 직접 붙여넣는 것이 맞습니다.
4. `wrangler.jsonc`를 채웁니다 (둘 다 비밀값이 아닙니다).
   - `database_id`
   - `vars.DISCORD_CLIENT_ID`
   - `vars.STORAGE_CAP_BYTES`: 기본 100GB입니다. 넘으면 팀 전체에서 가장 오래된 녹화부터 지웁니다.
     (R2는 10GB까지 무료이고 그 뒤로는 GB당 월 $0.015라, 100GB를 꽉 채워도 월 약 $1.35입니다. 다운로드 트래픽은 무료입니다.)
5. DB 테이블을 만들고 배포합니다.
   ```bash
   npm run db:migrate:remote
   (cd ../web && npm install)
   npm run deploy          # web을 빌드해서 워커의 정적 파일로 같이 올림
   ```
6. 비밀값을 넣습니다 (레포에는 올라가지 않습니다).
   ```bash
   npx wrangler secret put DISCORD_CLIENT_SECRET
   npx wrangler secret put ALLOWED_DISCORD_IDS     # 로그인 허용할 팀원 디스코드 ID, 쉼표로 구분
   ```
   디스코드 ID는 디스코드 설정 → 고급 → 개발자 모드 켜기 → 프로필 우클릭 → 사용자 ID 복사로 확인합니다.

이후 배포는 자동입니다. main에 `server/`나 `web/` 변경이 들어오면 [Deploy server](https://github.com/team-carol/carol-live/actions/workflows/deploy.yml)가
D1 마이그레이션과 `wrangler deploy`를 실행합니다 (Actions 탭에서 Run workflow로 직접 실행할 수도 있습니다). 터미널에서 직접 하려면 `cd server && npm run deploy`를 실행합니다.

자동 배포용 토큰은 처음 한 번만 만듭니다.

1. Cloudflare 대시보드 → 오른쪽 위 프로필 → 내 프로필 → API 토큰 → 토큰 생성 → **Cloudflare Workers 편집** 템플릿을 고릅니다.
2. 권한에 **계정 · D1 · 편집**을 추가하고, 영역 리소스는 `team-carol.com`으로 합니다.
3. 만든 토큰을 GitHub [Settings → Secrets → Actions](https://github.com/team-carol/carol-live/settings/secrets/actions)에 `CLOUDFLARE_API_TOKEN`으로 등록합니다.

워커 비밀값(`DISCORD_CLIENT_SECRET` 등)은 터미널 없이 Cloudflare 대시보드 → Workers 및 Pages → carol-live → 설정 → 변수 및 비밀에서도 추가·변경할 수 있습니다.
배포해도 비밀값은 그대로 남습니다.

### 유튜브 채팅 (방송 화면 오버레이)

앱 설정 → 유튜브 채팅에 채널(`@핸들`)을 적으면, 방송 중 앱 화면 오른쪽 아래에 그 채널 라이브의 채팅이 뜹니다.
채팅은 폰 화면에만 보이고 방송 영상에는 들어가지 않습니다. 앱 → 서버(`/api/device/youtube/*`) → YouTube Data API 순서로 가져오며,
API 키는 서버에만 있습니다.

1. [Google Cloud 콘솔](https://console.cloud.google.com/)에서 프로젝트를 만듭니다.
2. API 및 서비스 → 라이브러리 → **YouTube Data API v3** → 사용을 누릅니다.
3. API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → **API 키**를 만들고,
   키 수정에서 API 제한사항을 "YouTube Data API v3"로 제한합니다.
4. 서버 비밀값 `YOUTUBE_API_KEY`로 등록합니다. Cloudflare 대시보드 → Workers 및 Pages → carol-live → 설정 → 변수 및 비밀 → 추가(유형: 비밀)
   (터미널에서는 `cd server && npx wrangler secret put YOUTUBE_API_KEY`)

무료 할당량은 하루 10,000 단위입니다 (팀 전체 공유, 한국 시간 오후 4~5시에 초기화). 채팅을 한 번 불러올 때 5 단위를 쓰므로,
앱은 화면이 켜져 있을 때만 6~12초 간격으로 불러옵니다 (채팅이 조용하면 더 느리게). 채팅이 활발하면 하루 약 3시간, 조용하면 약 6시간 분량입니다.

### 유튜브 계정으로 방송 (제목·설명·썸네일)

스트림 키 대신 유튜브 채널을 연결해 두면, 앱에서 방송을 시작할 때 제목·설명·공개 범위를 정하고 그 내용으로 방송이 만들어집니다.

- **웹 → 유튜브**: 채널을 연결하고(구글 로그인), 자주 쓰는 조합을 프리셋으로 만듭니다. 프리셋에는 이름·제목·설명·공개 범위·썸네일이 들어갑니다.
  제목의 `{date}`는 방송하는 날짜(`2026-11-28`)로 바뀝니다. 썸네일은 JPG·PNG 2MB까지이고, 넘으면 브라우저가 1280×720 안으로 줄여서 올립니다.
- **앱 → 설정 → 송출 → 방송 시작 방식 → 유튜브 계정**: 방송 시작을 누르면 프리셋을 고르고 내용을 고치는 화면이 먼저 나옵니다.
  거기서 방송 시작을 누르면 서버가 채널에 방송을 만들고, 그 방송의 송출 주소를 앱에 내려줘서 바로 송출합니다. 채팅도 그 방송 것을 바로 띄웁니다.
- 종료를 누르면 유튜브 방송도 같이 끝냅니다. 방송은 송출이 끊겨도 혼자 끝나지 않게 만들어서, 오락실 와이파이가 잠깐 끊겼다 다시 붙어도 같은 방송이 이어집니다.
  앱이 죽거나 인터넷이 없어서 끝내지 못한 방송은 인터넷이 돌아오면 끝내고, 그것도 놓쳤으면 다음 방송을 만들 때 서버가 먼저 끝냅니다. 급하면 유튜브 스튜디오에서 직접 끝내시면 됩니다.
- 유튜브가 송출을 받아 라이브로 바뀌기 전에 종료하면 그 방송은 채널에서 지웁니다.

구글 로그인 정보(refresh token)는 서버에만 암호화해서 저장하고 웹이나 앱으로 내려보내지 않습니다. 스트림 키는 방송을 만들 때마다 유튜브에서 읽어 앱에 전달만 하고,
서버에도 폰에도 저장하지 않습니다. 웹의 **연결 끊기**는 서버에서 지우고 구글에도 권한 취소를 요청합니다.

처음 한 번 하는 설정입니다 (채팅용 `YOUTUBE_API_KEY`를 만든 것과 같은 Google Cloud 프로젝트를 쓰면 됩니다).

1. [Google Cloud 콘솔](https://console.cloud.google.com/) → API 및 서비스 → 라이브러리에서 **YouTube Data API v3**가 사용 설정돼 있는지 확인합니다.
2. [Google 인증 플랫폼](https://console.cloud.google.com/auth/overview)(예전 이름: OAuth 동의 화면)에서 앱 이름·지원 이메일을 넣고, 대상(Audience)의 사용자 유형은 **외부**로 합니다.
3. 데이터 액세스(Data Access) → 범위 추가에서 `https://www.googleapis.com/auth/youtube.force-ssl`을 넣습니다 (방송 만들기·끝내기·썸네일에 필요한 범위입니다).
4. 클라이언트(Clients) → 클라이언트 만들기 → 유형 **웹 애플리케이션**, 승인된 리디렉션 URI에 `https://live.team-carol.com/auth/youtube/callback`을 넣습니다.
5. 나온 클라이언트 ID와 보안 비밀을 서버 비밀값 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`로 등록합니다.
   Cloudflare 대시보드 → Workers 및 Pages → carol-live → 설정 → 변수 및 비밀 → 추가(유형: 비밀)
   (터미널에서는 `cd server && npx wrangler secret put GOOGLE_CLIENT_ID`, `... GOOGLE_CLIENT_SECRET`). 보안 비밀은 채팅이나 이슈에 붙이지 않습니다.
6. 대상(Audience)의 게시 상태를 정합니다.
   - **테스트**: 테스트 사용자로 넣은 구글 계정(100명까지)만 연결할 수 있고, **연결이 7일마다 풀려서** 다시 연결해야 합니다.
   - **프로덕션**(앱 게시): 7일 제한이 없습니다. 구글 검증을 받지 않은 앱이라 연결할 때 "Google에서 확인하지 않은 앱" 경고가 나오고(고급 → 이동으로 계속),
     프로젝트 전체에서 새 사용자 100명까지만 연결할 수 있습니다. 팀원만 쓰는 용도라면 이쪽이 편합니다.
7. 유튜브 채널에 라이브 스트리밍이 켜져 있어야 합니다 (처음 켜면 최대 24시간이 걸립니다). 썸네일을 올리려면 채널이 전화번호 인증을 마쳐야 합니다.

`GOOGLE_CLIENT_SECRET`은 저장한 로그인 정보를 암호화하는 열쇠로도 씁니다. 이 값을 바꾸면 연결해 둔 채널을 모두 다시 연결해야 합니다.

할당량은 채팅과 같은 하루 10,000 단위에서 나갑니다. 방송 하나를 만들고 끝내는 데 5 단위쯤, 프리셋 썸네일을 올리면 50 단위가 더 듭니다.

### 곡 인식 (실험)

앱 설정 → 곡 인식 (실험) → **방송·녹화 중 곡명 읽기**를 켜면, 방송이나 녹화 중에 화면에 찍힌 위쪽 모니터의 곡명을 몇 초마다 읽습니다.
글자 인식은 폰 안에서만 하고(ML Kit 일본어 모델), 읽은 줄을 곡 목록과 대조해서
두 번 연속 같은 곡이 나오면 그 곡으로 봅니다. 플레이 중에 위쪽 모니터에 뜨는 판(난이도 · 곡명 · ACHIEVEMENT · 달성률)이 보일 때만, 그 판 안의 글자만 곡명 후보로 삼습니다.
곡 선택 화면이나 닉네임 아래 칭호(곡명인 경우가 많음)는 그래서 곡으로 잡히지 않습니다. 결과는 방송 화면 왼쪽 위 정보 줄에 "읽은 글자 → 맞춘 곡 · 비슷한 정도"와 함께 나오고, 방송이 끝나면 요약 화면에 인식한 곡 목록이 나옵니다.

**방송 화면에 곡명 얹기**를 같이 켜면 읽은 곡명을 방송 영상 왼쪽 아래에 띄웁니다. 영상에 그려 넣는 것이라 녹화본에도 같이 들어갑니다. 끄면 폰 화면에만 보입니다.
아직 실험 기능이라 기본은 꺼져 있고, 틀리거나 읽지 못할 수 있습니다.

곡 목록은 두 가지를 합쳐서 씁니다. 앱에 들어 있는 목록(`android/app/src/main/assets/song_titles.txt`, SEGA 공개 곡 데이터를 모은 [OTOGE DB](https://github.com/zvuc/otoge-db)의 일본판·국제판 곡명)과,
하루에 한 번 받는 `https://maimai.team-carol.com/api/aliases`의 원제목입니다. 뒤쪽을 받지 못해도 앱에 든 목록으로 동작하고, 받지 못한 이유는 정보 줄에 나옵니다.
앱에 든 목록은 `music-ex.json`과 `music-ex-intl.json`의 `title`을 합쳐 한 줄에 하나씩 적은 것이라, 새 곡이 많이 늘면 다시 만들어 넣습니다.

### 로컬 개발

```bash
cd server
printf 'DEV_LOGIN=1\nALLOWED_DISCORD_IDS=dev\nDISCORD_CLIENT_SECRET=x\n' > .dev.vars
npm run db:migrate:local && npm run dev          # http://localhost:8787
# 다른 터미널: cd web && npm run dev   (API는 8787로 프록시)
```

`DEV_LOGIN=1`이면 `/auth/dev?id=dev&name=나`로 디스코드 없이 로그인됩니다. 운영에는 절대 넣지 않습니다.

유튜브 계정 기능은 구글 프로젝트 없이 `node tools/fake-google.cjs`(가짜 구글·유튜브)로 돌려 볼 수 있습니다. `.dev.vars`에 넣을 값은 그 파일 맨 위에 있습니다.

### 테스트

```bash
cd web && SAMPLE_DIR=<mp4 폴더> npm test    # mp4 무손실 자르기 (ffmpeg/ffprobe 필요) + 곡 나누기·기록 맞추기·쇼츠 구성
cd server && npm run typecheck
```

### 폰 저장공간

앱 설정 → 업로드 → **올린 녹화는 폰에서 지우기**를 켜면, 서버가 받은 크기가 폰 파일과 똑같다고 확인된 녹화만 폰에서 지웁니다 (기본은 꺼짐).
서버는 팀 전체 100GB를 넘으면 오래된 녹화부터 지우므로, 오래 남길 녹화는 웹에서 받아 두시기 바랍니다.

## 앱 ↔ 서버 연결 (기기 페어링)

앱 설정 → 업로드에서 서버 주소(기본값 `https://live.team-carol.com`)와 기기 이름(기본값은 폰 이름)을 확인하고 **연결하기**를 누릅니다.
브라우저에서 디스코드 로그인을 한 번 하면 `carollive://paired`로 앱에 기기 토큰이 돌아옵니다.
앱이 연결을 시작할 때 만든 nonce가 같이 돌아와야만 받아들입니다. 웹의 **기기** 메뉴에서 이름을 바꾸거나 연결을 해제할 수 있습니다.
