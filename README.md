# roena live

마이마이 플레이를 폰 하나로 유튜브 라이브하기 위한 개인용 안드로이드 송출 앱.
송출은 [RootEncoder](https://github.com/pedroSG94/RootEncoder), UI는 [Carol Design System](https://github.com/team-carol/carol-design-system) 토큰을 옮겨서 씀.

## 폴더 구조

```
roena-live/
├─ RootEncoder/        # RootEncoder 로컬 클론 (git에는 안 올림)
├─ app/                # 앱
│  └─ src/main/res/values/carol_tokens.xml   # 캐롤 색·모서리·간격 토큰. hex는 여기에만 있음
└─ settings.gradle.kts # includeBuild("RootEncoder") 로 라이브러리를 소스째 연결
```

## 빌드

```powershell
# RootEncoder가 없으면 먼저 받기
git clone --depth 1 https://github.com/pedroSG94/RootEncoder.git

.\gradlew.bat :app:assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

## 1차 기능

- 설정 화면: 서버 주소·스트림 키 저장, 1080p/720p, 60/30fps, 영상 비트레이트, 오디오 48kHz·128~192k
- 마이크: USB 수신기(DJI) 우선 지정, 폰 소리 처리 없는 "원음" 모드, 꽂고 빼면 자동 전환
- 카메라: AE 프레임 범위를 [60, 60]으로 고정해서 어두워도 프레임 유지, EV 보정 버튼, 핀치 줌, 탭 초점
- 방송 화면: 상태 배지, 실제 송출 비트레이트·FPS·배터리·온도, 끊기면 자동 재연결(5초 간격 10회)

## 폰트

Pretendard (SIL OFL 1.1) — `app/src/main/assets/licenses/pretendard-OFL.txt`
