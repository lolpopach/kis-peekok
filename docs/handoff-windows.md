# 새 노트북(Windows)으로 작업 이어가기 — 인수인계

> Claude 에게: 이 문서를 처음부터 끝까지 읽고 **1 → 5 순서로 환경을 만든 뒤**, **6. 지금 하던 일** 부터 이어가세요.
> 사용자와는 **한국어**로 말합니다. 저장소의 `CLAUDE.md` 가 기본 작업 지침이고, 이 문서는 그 위에 더하는 내용입니다.

## 0. 꼭 지킬 것 (사용자 규칙)

- **`config.h` 의 WiFi 비밀번호(`WIFI_PASS`)와 로봇 키(`ROBOT_KEY`)는 화면·채팅·커밋에 절대 출력하지 않는다.**
  `cat config.h` 금지. 필요한 줄만 `grep -vE 'WIFI_|ROBOT_KEY|OTA_PASS'` 로 걸러서 본다. 비밀값은 사용자가 직접 넣는다.
  로봇 키가 필요한 요청은 `perl -ne 'print $1 if /^#define\s+ROBOT_KEY\s+"(.*)"/' config.h` 로 변수에 담아서만 쓴다.
- 펌웨어를 고치면 **Claude 가 직접**: 호스트 시험 → 컴파일 → 업로드(USB 또는 WiFi) → 시리얼/무선 기록 확인까지 한다.
- 사용자는 "코드 고치기 전에 원인부터 이야기하자" 고 할 때가 많다. 로봇이 이상하면 **기록(로그) 근거로 원인 설명 → 동의 받고 수정**.
- 로봇 움직임(선 따라가기·분기 판단·회전·유턴)은 사용자와 오래 맞춘 것이라 **함부로 바꾸지 말고**, 바꾸면 무엇을 바꿨는지 분명히 말한다.
- 배포 = 작업 브랜치 커밋·푸시 → 같은 내용을 `main` 에 푸시 (Cloudflare 자동 배포, 사용자 승인된 절차). `main` 이 앞서 있으면 먼저 합친다.
- 커밋 메시지 끝: `Co-Authored-By: Claude <noreply@anthropic.com>` (그 세션의 안내를 따름).

## 1. 설치 (Windows)

PowerShell(관리자 아님)에서:

```powershell
winget install --id Git.Git -e            # Git Bash(bash·perl·curl 포함) — 이후 명령은 대부분 Git Bash 에서
winget install --id OpenJS.NodeJS.LTS -e   # node·npx (웹 서버 점검, wrangler)
winget install --id Python.Python.3.12 -e  # python (api-test, espota 무선 업로드, 코스 지도)
winget install --id ArduinoSA.CLI -e       # arduino-cli
```

- Claude Code: PowerShell 에서 `irm https://claude.ai/install.ps1 | iex` (또는 `npm install -g @anthropic-ai/claude-code`). 같은 Claude 계정으로 로그인.
- 설치 뒤 **터미널을 새로 열어야** PATH 가 잡힌다.
- USB 로 보드를 꽂으면 COM 포트가 생겨야 한다. 안 생기면 보드의 USB 칩 드라이버(CH340 또는 CP210x)를 설치.
- Windows 에는 `python3` 가 없을 수 있다 → Git Bash `~/.bashrc` 에 `alias python3=python` (아래 4번).

## 2. 저장소 받기

Git Bash 에서:

```bash
cd ~ && git clone https://github.com/lolpopach/kis-peekok.git && cd kis-peekok
git checkout claude/relaxed-rubin-1vbjfb     # 작업 브랜치 (main 과 같은 내용 + 그 뒤 작업)
git config core.autocrlf false                # .sh·.pl 줄 끝이 CRLF 로 바뀌면 bash 가 깨짐
```

## 3. 펌웨어 빌드 환경

```bash
arduino-cli config init
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli config add board_manager.additional_urls https://arduino.esp8266.com/stable/package_esp8266com_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32@4.0.0      # Mac 에서 쓰던 버전 (esp8266:esp8266@3.1.2 는 필요할 때만)
```

**`config.h` 만들기** (gitignore 라 저장소에 없음):

```bash
cd firmware/peekok-robot && cp config.example.h config.h
```

그다음 **사용자가 직접** `config.h` 를 열어(메모장이면 따옴표가 바뀌지 않게, 또는 VS Code) 세 줄만 채운다:
`WIFI_SSID`, `WIFI_PASS`(로봇이 붙을 2.4GHz WiFi), `ROBOT_KEY`(Cloudflare 비밀값과 같은 값 — 예전 Mac 의 config.h 에서 옮겨 적기).
나머지 값은 Mac 의 config.h 와 똑같다(확인함: 비밀값 줄 말고는 config.example.h 와 동일).
Claude 는 이 세 값을 묻거나 출력하지 않는다.

점검:

```bash
bash test/run.sh                                     # 호스트 시험 — "모두 통과" 여야 함 (g++ 필요: 없으면 아래 참고)
arduino-cli compile --fqbn esp32:esp32:esp32 .       # 실제 보드용 컴파일
```

- `test/run.sh` 는 g++ 가 필요하다. Windows 에 없으면 `winget install --id MSYS2.MSYS2 -e` 후 MSYS2 에서 `pacman -S mingw-w64-ucrt-x86_64-gcc`
  하고 그 `bin` 을 PATH 에 넣거나, WSL 에서 돌린다. 안 되면 사용자에게 말하고 컴파일만으로 확인.

## 4. 도구가 Windows 에서 다른 점 (Claude 가 먼저 손볼 것)

| 도구 | Mac 에서 | Windows 에서 할 일 |
|---|---|---|
| `tools/upload.sh` (`upload`) | USB `/dev/cu.usbserial-*` 있으면 USB, 없으면 WiFi(espota) | USB 포트 찾기를 `arduino-cli board list` 의 `COMx` 로 바꾸기, espota 경로 `~/Library/Arduino15/...` → `$LOCALAPPDATA/Arduino15/packages/esp32/hardware/esp32/*/tools/espota.py`, `python3` → `python`. WiFi 업로드는 `ROBOT_HOST=<IP> upload` |
| `tools/run.pl` (`run`) | USB 는 `/dev/cu.*` + `stty` | Windows 에서 USB 부분은 안 됨 → **무선 `run w …` 로 쓰기** (또는 COM 포트 지원 추가) |
| `tools/reset.sh` (`reset`) | 그대로 | 그대로 (bash·perl·curl). `.local` 이 안 찾아지면 `ROBOT_HOST=<IP>` |
| `tools/watch.pl` | Claude 의 무선 기록 보기 | 그대로 (`ROBOT_HOST`) |
| `tools/course-map/bridge.py` (`map`) | 예전 연습 코스 지도 | **12학년 코스와 상관없음 — 쓰지 않기**(켜 두면 무선 연결을 뺏음) |

- **`peekok-robot.local`(mDNS)이 Windows 에서 안 찾아질 수 있다.** 그러면 로봇 IP 를 쓴다:
  로봇을 USB 로 꽂고 켜면 시리얼에 `[무선] 준비됨 — IP …` 가 찍힌다(115200). 학교 WiFi 에서 마지막 IP 는 `10.3.1.81` 이었다(바뀔 수 있음).
  Git Bash `~/.bashrc` 에 `export ROBOT_HOST=<그 IP>` 를 넣어 두면 모든 도구가 그 주소를 쓴다.
- 노트북과 로봇이 **같은 WiFi** 여야 무선이 된다.
- Git Bash 별칭 (`~/.bashrc`, 사용자에게 확인 후 추가):

```bash
alias python3=python
alias run="perl ~/kis-peekok/firmware/peekok-robot/tools/run.pl"
alias upload="bash ~/kis-peekok/firmware/peekok-robot/tools/upload.sh"
alias reset="bash ~/kis-peekok/firmware/peekok-robot/tools/reset.sh"
```

## 5. 동작 확인 (설치가 끝나면)

1. `reset` → `[로봇] 멈춤 · [제자리] … 방향 E` 와 `[서버] 대기 상태 · 호출 모두 취소 · 로봇 위치 = 12-5반 앞` 이 나오면 무선·서버 둘 다 OK.
2. `perl firmware/peekok-robot/tools/watch.pl 5 1:p` → `모드 idle · … 방향 E …` 가 나오면 로봇 무선 기록 OK.
3. `arduino-cli compile …` 성공, `bash test/run.sh` 모두 통과.
4. 실제 웹: https://kis-peekok.pages.dev (휴대폰 부르기), 로봇 태블릿 https://kis-peekok.pages.dev/robot

## 6. 지금 하던 일 (2026-11-23 기준)

### 지금 시스템
- **시범 코스 = 4층 12학년**: 로봇은 12-1~12-5 만 간다. 제자리 = 12-5 가지 선 끝(동쪽 = 세로 선 쪽을 보고 둠).
  선 모양은 `public/js/data.js` 의 `robotCourse`(4층 도면 좌표), 계획은 `Router.robotPlan`(이 선 위에서만), 바닥 테이프 `docs/prototype-course.md`.
  실제 바닥은 사용자 그림대로 12-5·위 꺾이는 곳·12-1 이 ㄱ 으로 꺾임. 바닥과 도면은 **좌우 같은 방향**(확인됨).
- 펌웨어(로봇에 올라간 것 = 커밋 `9b57971` 기준): 서버 주행은 갈림길을 볼 때마다 다음 노드 동작, 끝 가로선(T)에서 도착(`END_BY_MARK 1`),
  출발 직후 `startIgnore` 1.5초 갈림길 무시, 갈림길 지나는 중 곧장(`crossHold` 0.8초), **길 외우기 기능은 뺌**(회전은 늘 계획대로),
  오류(회전 실패·60초 동안 갈림길 없음)면 같은 계획으로 다시 출발 안 함. 시리얼 `H` = 제자리 방향(E)으로, `P` = 설정 목록, `P이름=값` = 바꾸고 보드에 저장.
- 서버: 새 목적지마다 `issuedAt` 을 넣어 계획 번호(rev)가 늘 새로 바뀜. `reset`(터미널) = 로봇 멈춤·방향 E + 서버 대기·**모든 호출 취소**·위치 12-5.
- 로봇 화면: 부른 곳에 도착하면 "물건을 놓으셨으면 탭해 주세요" → 탭하면 받는 곳으로 출발. 대기가 되면 처음(얼굴) 화면으로.

### 풀던 문제: **배달 출발 때 제자리 유턴을 못 함**
- 상황: 휴대폰 호출 12-4 → 12-2. 로봇이 12-4(부른 곳)에 도착(서쪽을 봄) → 12-2 로 가려면 출발점에서 동쪽으로 **제자리 유턴**해야 하는데 못 함.
  서버 progress 가 비어 있음 = START 도 못 지남(출발 유턴에서 실패 → 오류로 멈춤). 그때 기록은 꺼져 있었음.
- 지금 로봇 유턴 설정(보드 저장값): `uPwm=70`, `kickPwm=130`, `kickMs=100`, `brakeMs=50`, `uIgnore=0`, `minPwm=80`, `arcPwm=130`, `speed=105`, `duty=65`.
- 의심 두 가지(아직 확인 안 함):
  1. **유턴 세기 70 이 최소 세기(80)보다 낮음** — 배터리를 올려 무거워진 뒤로는 힘이 모자라 거의 안 돌 수 있음(1초마다 0.1초만 130 으로 밈).
  2. **`uIgnore=0`** — 도착하면 로봇이 끝 가로선(T) 위에 있음. 돌기 시작하자마자 앞 센서가 가로선 끝을 지나며 "선 찾음"으로 보고 90° 쯤에서 멈출 수 있음.
- 다음 단계(사용자와 하던 것): 로봇을 반 끝(가로선 앞)에 두고 기록을 켠 채 유턴만 시험
  `perl firmware/peekok-robot/tools/watch.pl 30 1:x 2:v 3:GuE` (제자리 유턴 → 앞 갈림길까지 가서 멈춤) → `[유턴]` 줄과 센서·바퀴 값으로 1·2 중 무엇인지 확인 → 사용자에게 설명 후 `PuPwm=…` / `PuIgnore=…` 로 맞춤(코드 수정 없이).
- 그 뒤 할 일: **모터 힘 보정** — 오른쪽 모터가 살짝 약함(직진 중 앞 오른쪽 센서만 자주 닿아 계속 바로잡음). `[` `]` 또는 `b` 로 `motorTrim` 맞추고 보드에 저장.

### 기록 보는 법 (Claude)
- `watch.pl` 로 무선 기록을 받으며 `[출발] [노드] [판단] [회전] [유턴] [되돌기] [도착] [오류]` 줄을 본다. `v` 를 보내면 0.1초마다 `[주행] 센서 뒤L 앞L 앞R 뒤R · 바퀴 왼 오`.
- 서버 상태: `curl -s -H "X-Robot-Key: $K" https://kis-peekok.pages.dev/api/robot` (K 는 config.h 에서 읽기, 출력 금지) — mode·target.plan·progress·position·call·queue.
- 지난 기록은 로봇에 남지 않는다 → 시험 **전에** 기록을 켜 둔다.

### 지금 서버 상태
- 마지막에 12-4 → 12-2 배달(`delivering`)이 멈춘 채 남아 있을 수 있음 → 로봇을 12-5 에 두고 **`reset`** 부터.
