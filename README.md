# 학교 안내 로봇 피콕 (PEEKOK)

학교 안내 로봇의 **얼굴(머리 화면)** 에 띄우는 웹 페이지입니다.
평소에는 화면 전체가 공작새 로봇 **피콕**의 얼굴이고, 사용자가 얼굴을 터치하면 길 찾기 메뉴로 넘어갑니다.

- **얼굴 화면**: 화면 가장자리까지 파란 깃털 머리, 큰 눈과 흰 눈 무늬, 가운데 부리.
  화면 비율(가로·세로)에 맞춰 얼굴이 꽉 차게 자동으로 맞춰집니다.
  눈을 깜빡이고, 터치한 쪽을 쳐다보고, 말할 때 부리가 움직이고, 터치하면 웃습니다.
  기다리는 동안 가끔 자막으로 말을 겁니다("저를 터치하면 길을 안내해 드려요"). `config.js` 의 `faceCaptions` 로 끌 수 있습니다.
- **길 찾기**(핵심 기능): 2026 시설배치도(1~5층) 기준으로 현재 위치에서 목적지까지의 경로를 지도에 그리고, 단계별 안내 문장과 음성으로 알려 줍니다.
  - 자주 찾는 곳 바로가기: 화장실(가장 가까운 곳), 보건실, 교무실, 행정실, 도서실, 식당·매점, 체육관, 상담실
  - 교실 찾기: 유치원 · 1~12학년 · 통합교육
  - 검색: 화면 한글 키보드, 초성 검색(`ㅂㄱㅅ` → 보건실), `5-1`, `5학년 1반`
  - 말로 묻기: "도서실 어디예요?" (음성 인식을 지원하는 브라우저만)
  - 계단 / 엘리베이터(휠체어·유모차) 경로 선택
  - 층별 안내도: 지도에서 장소를 눌러 바로 안내 (지도는 움직이지 않게 고정)
  - **휴대폰으로 보기**: 길 안내 화면의 QR 코드를 휴대폰 카메라로 찍으면, 같은 경로의 지도와 단계별 안내가 휴대폰(`m.html`)에 나옵니다.
- 90초 동안 입력이 없으면 얼굴 화면으로 돌아갑니다.

## 배달 호출

로봇으로 등록되지 않은 기기(교실 PC, 휴대폰)가 첫 주소(`/`)에 들어오면 **배달 호출 화면**(`call.html`)이 나옵니다.
장소(층별 목록 · 검색 · 직접 입력) → 요청(전달 · 가져오기 · 길 안내 · 기타) → 확인 3단계로 호출하면, 로봇 화면에 알림음·음성과 함께 호출 카드가 뜹니다.
운영하는 분이 로봇 화면에서 **출발 → 도착 → 완료** 를 누르면 호출한 사람 화면의 상태도 바뀝니다(4초마다 확인).
로봇 화면의 "길 보기" 는 로봇 위치에서 호출 장소까지 경로를 보여 줍니다.

- **영어 버전**: 호출 화면 오른쪽 위 버튼으로 한국어/English 를 바꿉니다(`call?lang=en`, 휴대폰 언어가 한국어가 아니면 영어로 시작). 장소 이름 번역은 `js/i18n.js`.
- **로봇 기기 등록**: 로봇 태블릿에서 `https://kis-peekok.pages.dev/?robot=<로봇키>` 를 한 번 열면 그 기기에 저장됩니다.
  해제는 `?robot=off` 또는 관리자 설정의 "로봇 등록 해제". 내 컴퓨터 미리보기(localhost)는 로봇으로 봅니다.
- **서버**: Cloudflare Pages Functions(`functions/api/`) + KV(바인딩 이름 `CALLS`). 호출은 12시간 뒤 자동으로 정리됩니다.
- **비밀값(선택)**: `ROBOT_KEY` 를 넣으면 호출 목록 보기·상태 바꾸기에 로봇키가 필요합니다(권장).
  `CALL_PIN` 을 넣으면 호출할 때 학교 코드를 묻습니다.
- 로컬에서 서버까지 확인: `npx wrangler pages dev public --kv CALLS`

## 폴더 구조

```
public/            ← 배포되는 사이트 (빌드 과정 없음)
  index.html       로봇 얼굴 + 길 찾기 (가로 태블릿)
  m.html           휴대폰용 길 안내 (QR 코드로 열림)
  call.html        배달 호출 (로봇이 아닌 기기의 첫 화면)
  css/style.css    태블릿 화면
  css/map.css      지도 (태블릿·휴대폰 공용)
  css/mobile.css   휴대폰 화면
  js/mobile.js     휴대폰 길 안내
  js/vendor/qrcode.js  QR 코드 생성 (MIT, qrcode-generator)
  js/config.js     로봇 이름, 로봇 위치, 대기 시간 등 기본 설정
  js/data.js       시설배치도 데이터 (방 위치, 복도 그래프)
  js/router.js     경로 계산과 안내 문장
  js/search.js     검색 (초성 · 학년반 · 음성 문장)
  js/hangul.js     화면 키보드용 한글 조합
  js/face.js       공작새 얼굴
  js/map.js        층별 지도 그리기
  js/app.js        화면 흐름
  js/device.js     로봇 기기 구분 (아니면 call.html 로)
  js/calls.js      로봇 화면의 호출 알림
  js/call.js       배달 호출 화면
  js/i18n.js       배달 호출 화면 한국어/영어 문구 · 장소 이름 영어 번역
  css/call.css     배달 호출 화면
functions/api/     호출 API (Cloudflare Pages Functions)
lib/calls.js       호출 API 공용 코드
tools/validate.js  도면 데이터 점검 도구
tools/cloudflare.sh Cloudflare Pages 확인·배포 상태·프로젝트 생성 도우미
CLAUDE.md          Claude 작업 지침 (배포 절차 등)
wrangler.toml      Cloudflare Pages 설정
```

## 로컬에서 실행

```bash
cd public && python3 -m http.server 8080
```

브라우저에서 `http://localhost:8080` 을 엽니다. (`index.html` 파일을 바로 열어도 동작합니다.)

유용한 주소 옵션:

| 주소 | 설명 |
| --- | --- |
| `?start=app` | 얼굴 화면을 건너뛰고 메뉴부터 |
| `?to=f1-보건실` | 해당 장소로 바로 길 안내 |
| `?at=2,325,754` | 로봇 위치를 `층,x,y` 로 지정 (로봇이 여러 대일 때) |
| `?debug=1` | 지도 위에 복도 그래프와 출입문 위치 표시 |

## Cloudflare Pages 배포

주소: **https://kis-peekok.pages.dev**

Cloudflare Pages 프로젝트 `kis-peekok` 이 이 GitHub 저장소에 연결되어 있어서, 푸시하면 자동으로 배포됩니다.
- 운영 브랜치: `main` → `kis-peekok.pages.dev`
- 다른 브랜치: 브랜치별 미리보기 주소가 따로 만들어집니다.
- Build command: *(없음)* · Build output directory: `public`

운영 브랜치는 Cloudflare 대시보드 → Workers & Pages → kis-peekok → Settings → Builds 의 Production branch 에서 바꿀 수 있습니다.

**명령어로 직접 배포할 때** (본인 컴퓨터에서)

```bash
npx wrangler login
```

```bash
npx wrangler pages deploy
```

(`wrangler.toml` 에 프로젝트 이름 `kis-peekok` 과 출력 폴더 `public` 이 들어 있습니다.)

## 로봇 위치 바꾸기

- **화면에서**: 상단 시계를 3초 동안 길게 누르면 관리자 설정이 열립니다. 지도에서 로봇이 서 있는 복도를 누르고 저장하면 그 기기에 저장됩니다. 음성 기본값, 대기 시간, 전체 화면도 여기서 설정합니다.
- **코드에서**: `public/js/config.js` 의 `robotLocation` 을 바꿉니다.

## 도면 데이터 고치기

`public/js/data.js` 에 층마다 방(`rooms`), 복도(`corridors`), 길 찾기용 점(`nodes`)과 연결(`edges`)이 있습니다.
좌표는 시설배치도 PDF의 좌표(포인트 단위)를 그대로 썼습니다.

- 방 이름·별칭 추가: `aliases: ['양호실', ...]`
- 출입문이 다른 쪽에 있으면: `doors: [[x, y]]`
- 고친 뒤 점검:

```bash
node tools/validate.js
```

```bash
node tools/validate.js 보건실 5-1 콘서트홀
```

첫 번째 명령은 모든 장소에 경로가 있는지, 두 번째는 해당 장소의 안내 문장을 보여 줍니다.

## 참고

- 도면에 문 위치가 없어서 출입문은 가장 가까운 복도에 붙도록 계산했습니다. 실제와 다른 곳은 `doors` 로 지정해 주세요.
- 5층은 계단 연결이 도면에서 확실하지 않아, 왼쪽 계단을 4층 중앙 계단과 이었습니다.
- 음성 안내(TTS)와 음성 인식은 브라우저 기능을 사용합니다. 크롬 계열 브라우저를 권장합니다.
