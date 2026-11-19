# 학교 안내·배달 로봇 피콕 (PEEKOK)

학교 안내·배달 로봇 **피콕**의 웹 시스템입니다. 주소 하나(**https://kis-peekok.pages.dev**)로 두 가지 화면을 씁니다.

| 누가 | 화면 | 주소 |
| --- | --- | --- |
| 로봇 태블릿 (로봇 얼굴) | 공작새 얼굴 → 길 안내 · 배달 | `/robot` (등록된 태블릿은 `/` 로 열어도 여기로) |
| 그 밖의 휴대폰·PC | **피콕 부르기** (배달 호출) | `/` |
| QR 코드를 찍은 휴대폰 | 길 안내 보기 | `/m?to=…` |

## 로봇 얼굴 (robot.html · 가로 태블릿)

- **얼굴 화면**: 화면 전체가 공작새 얼굴. 깜빡이고, 터치한 쪽을 보고, 말할 때 부리가 움직이고, 터치하면 웃습니다.
  기다리는 동안 자막으로 말을 걸고, 배달 중에는 "보건실로 배달 가는 중이에요"처럼 하는 일을 말합니다.
- **길 찾기**: 2026 시설배치도(1~5층) 기준 경로를 고정 지도와 단계별 안내·음성으로 알려 줍니다.
  자주 찾는 곳, 교실 찾기, 화면 한글 키보드(초성 검색), 말로 묻기, 계단/엘리베이터 선택, 층별 안내도,
  **QR 코드로 휴대폰에서 보기**.
- **배달**:
  1. 휴대폰으로 부르면 (로봇이 비어 있고 아무도 화면을 안 쓸 때) 자동으로 호출을 받고 부른 곳으로 갑니다.
  2. 도착하면 "보낼 물건을 넣어 주세요" → **받는 곳 고르기**(길 찾기와 같은 메뉴) → **받는 사람·메모·보내는 사람**(화면 키보드) → 출발.
  3. 받는 곳에 도착하면 받는 사람·메모를 크게 보여 주고, "물건을 꺼냈어요"를 누르면 제자리로 돌아갑니다.
  4. 로봇 앞에서 바로 보낼 때는 홈 화면의 **배달 보내기**.
- 90초 동안 입력이 없으면 얼굴 화면으로 돌아갑니다. 관리자 설정: 상단 시계를 3초 길게 누르기.

## 피콕 부르기 (index.html · 휴대폰)

어디로 와 줄지(검색·학년반·자주 가는 곳) 고르고, 보내는 사람·보낼 물건(선택)을 적어 부릅니다.
접수 → 오는 중 → 물건 싣기 → 배달 중 → 완료를 실시간으로 보여 주고, 로봇 몸체가 위치를 보고하면 **지도에 피콕 위치가 움직입니다**.
로봇이 오기 전까지는 취소할 수 있습니다. 같은 기기는 한 번에 한 건만, 기다린 지 30분이 지나면 만료됩니다.

## 로봇 태블릿 설정 (처음 한 번)

로봇 태블릿에서 **설정 링크** `https://kis-peekok.pages.dev/robot#key=<로봇 키>` 를 한 번 엽니다.
그러면 이 기기가 로봇으로 등록되어, 그다음부터는 `/` 로 열어도 로봇 얼굴이 뜨고 배달 기능이 켜집니다.
(크롬 메뉴 → 홈 화면에 추가 하면 전체 화면 앱으로 열립니다.)
로봇 키는 Cloudflare Pages 프로젝트의 비밀값 `ROBOT_KEY` 입니다.
등록된 기기에서 부르기 화면을 보려면 `/?public` 으로 엽니다.

## 로봇 몸체(라인 트레이스 · ESP8266) 연결

- **펌웨어**: [firmware/peekok-esp8266](firmware/peekok-esp8266/README.md) — NodeMCU/Wemos D1 mini + 라인 센서 3개 + 모터 드라이버. 배선·올리기·맞추기 방법이 들어 있습니다.
- **규약**: [docs/robot-api.md](docs/robot-api.md). 길 찾기 그래프의 노드(복도 교차점)를 라인 트레이스 노드로 씁니다.
  로봇은 노드 순서·회전·거리를 받아 달리고, 노드를 지날 때마다 보고하면 화면과 휴대폰 지도에 실시간 위치가 보입니다.
- 엘리베이터에서는 로봇이 멈춰 도움을 부탁하고, 사람이 태워 내려 준 뒤 로봇의 FLASH 버튼이나 로봇 화면의 "내렸어요" 로 이어서 달립니다.
- `tools/robot-sim.js --text` 가 ESP8266 과 똑같은 방식으로 주고받는 시뮬레이터입니다.

## 폴더 구조

```
public/                  ← 배포되는 화면 (빌드 과정 없음)
  index.html             피콕 부르기 (휴대폰)          js/call.js · css/call.css
  robot.html             로봇 얼굴 + 길 찾기 + 배달    js/app.js · js/delivery.js · css/style.css
  m.html                 휴대폰 길 안내 (QR)          js/mobile.js · css/mobile.css
  css/map.css            지도 (공용)
  js/config.js           로봇 이름·위치·속도·대기 시간 등 기본 설정
  js/data.js             시설배치도 데이터 (방, 복도, 노드·연결)
  js/router.js           길 찾기, 안내 문장, 로봇 주행 계획(robotPlan)·위치 추정(locate)
  js/search.js · hangul.js · face.js · map.js · icons.js
  js/vendor/qrcode.js    QR 코드 (MIT, qrcode-generator)
functions/api/           ← 서버 (Cloudflare Pages Functions)
  status.js              GET  /api/status            로봇 상태 (누구나)
  calls/index.js         POST /api/calls             부르기
  calls/[id].js          GET  /api/calls/:id?t=      내 호출 상태
  calls/[id]/cancel.js   POST /api/calls/:id/cancel  취소
  robot/index.js         GET  /api/robot             로봇 전용 상태 (X-Robot-Key)
  robot/[action].js      POST /api/robot/:action     로봇 전용 동작
lib/                     서버 공통 코드
db/schema.sql            데이터베이스 구조 (Cloudflare D1 kis-peekok)
docs/robot-api.md        로봇 몸체 연결 안내
tools/                   validate.js(도면 점검) · api-test.py(API 점검) · robot-sim.js(주행 시뮬레이터) · cloudflare.sh
wrangler.toml            Cloudflare 설정 (출력 폴더, D1 연결)
```

## 로컬에서 실행

서버(배달 API)까지 함께 띄우기:

```bash
echo 'ROBOT_KEY=local-test-key' > .dev.vars
```

```bash
npx wrangler pages dev public --port 8788
```

- 부르기 화면: `http://localhost:8788/`
- 로봇 화면: `http://localhost:8788/robot#key=local-test-key`
- API 점검: `python3 tools/api-test.py http://localhost:8788 local-test-key`
- 주행 시뮬레이터: `node tools/robot-sim.js --base http://localhost:8788 --key local-test-key --fast 10`

길 찾기 화면만 볼 때는 `cd public && python3 -m http.server 8080` 후 `http://localhost:8080/robot.html`.

로봇 화면 주소 옵션: `?start=app`(메뉴부터) · `?to=f1-보건실`(바로 길 안내) · `?at=2,325,754`(로봇 위치) · `?debug=1`(노드·연결 표시)

## 배포 (Cloudflare Pages)

GitHub `main` 브랜치에 푸시하면 자동으로 배포됩니다 (화면 + 서버 함께).
데이터베이스(D1)와 비밀값(ROBOT_KEY)은 Cloudflare 에 이미 설정되어 있습니다.

## 로봇 위치 바꾸기

- 로봇 화면에서 시계 3초 길게 누르기 → 지도에서 로봇 제자리(복도) 누르기 → 저장. 배달을 마치면 이 자리로 돌아옵니다.
- 코드에서: `public/js/config.js` 의 `robotLocation`.

## 도면 데이터 고치기

`public/js/data.js` 에 층마다 방(`rooms`), 복도(`corridors`), 노드(`nodes`)와 연결(`edges`)이 있습니다. 좌표는 시설배치도 PDF 좌표 그대로입니다.
실제 바닥 라인에 맞춰 노드를 옮기거나 추가하면 길 찾기와 로봇 주행 계획이 함께 바뀝니다.

```bash
node tools/validate.js
```

```bash
node tools/validate.js 보건실 5-1 콘서트홀
```

## 참고

- 도면에 문 위치가 없어 출입문은 가장 가까운 복도에 붙도록 계산했습니다. 실제와 다르면 `doors` 로 지정하세요.
- 5층 왼쪽 계단은 4층 중앙 계단과 이어진 것으로 보았습니다. 로봇은 엘리베이터만 쓰므로 5층 대기실로는 배달할 수 없습니다.
- 음성 안내·인식은 브라우저 기능을 씁니다. 크롬 계열을 권장합니다.
