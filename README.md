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

## server + web 배포

처음 한 번:

1. [디스코드 개발자 포털](https://discord.com/developers/applications)에서 앱 만들기
   → OAuth2 → Redirects에 `https://<워커 주소>/auth/callback` 추가 → Client ID / Secret 복사
2. Cloudflare 대시보드에서 R2 사용 설정 (무료 10GB, 결제 수단 등록이 필요할 수 있음)
3. 리소스 만들기
   ```bash
   cd server && npm install
   npx wrangler login
   npx wrangler r2 bucket create carol-live-recordings
   npx wrangler d1 create carol-live        # 나온 database_id를 wrangler.jsonc에 붙여넣기
   npx wrangler secret put DISCORD_CLIENT_SECRET
   ```
4. `wrangler.jsonc`의 `vars` 채우기
   - `DISCORD_CLIENT_ID`
   - `ALLOWED_DISCORD_IDS`: 로그인 허용할 팀원 디스코드 ID, 쉼표로 구분
     (디스코드 설정 → 고급 → 개발자 모드 켜고 프로필 우클릭 → ID 복사)
   - `STORAGE_CAP_BYTES`: 기본 10GB. 넘으면 팀 전체에서 가장 오래된 녹화부터 지움
5. DB 테이블 만들고 배포
   ```bash
   npm run db:migrate:remote
   (cd ../web && npm install)
   npm run deploy          # web을 빌드해서 워커의 정적 파일로 같이 올림
   ```

이후 배포는 `cd server && npm run deploy`만 하면 됨.

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

앱 설정 → 업로드에 서버 주소와 기기 이름(기본값은 폰 이름)을 넣고 **연결하기**
→ 브라우저에서 디스코드 로그인 한 번 → `carollive://paired`로 앱에 기기 토큰이 돌아옴.
앱이 연결을 시작할 때 만든 nonce가 같이 돌아와야만 받아들임. 웹의 **기기** 메뉴에서 이름 변경·연결 해제 가능.
