# kis-peekok 작업 지침

학교 안내·배달 로봇 **피콕**의 웹 시스템입니다. 화면은 빌드 과정 없는 정적 파일(`public/`),
서버는 Cloudflare Pages Functions(`functions/api`, 공통 코드 `lib/`) + D1 데이터베이스입니다.
사용자와는 한국어로 대화합니다.

## 화면 구성 (같은 주소, 기기에 따라 다름)
- `public/robot.html` (`/robot`): 로봇 태블릿 = 로봇 얼굴 + 길 찾기 + 배달. 설정 링크 `/robot#key=<ROBOT_KEY>` 로 한 번 열면
  기기가 로봇으로 등록(localStorage `kis-robot-device`, `kis-robot-key`)되고, 그 뒤로는 `/` 도 로봇 화면으로 넘어간다.
- `public/index.html` (`/`): 그 밖의 사람 = 피콕 부르기(배달 호출, 휴대폰 우선). `/?public` 은 로봇 기기에서도 부르기 화면.
  화면 코드 `js/call.js`·`css/call.css`, 한국어/영어 문구와 장소 이름 영어 번역은 `js/i18n.js`(`?lang=en`, 휴대폰 언어가 한국어가 아니면 영어).
- `public/m.html` (`/m`): QR 로 여는 휴대폰 길 안내.

## 배달 시스템
- 흐름: 휴대폰 호출(waiting) → 로봇 자동 수락(coming, 화면을 아무도 안 쓸 때만) → 도착(loading) → 받는 곳·받는 사람·메모 → 출발(delivering)
  → 도착(at_recipient) → 받았어요(delivered) → 로봇 제자리(returning → idle). 로봇 화면 쪽은 `public/js/delivery.js`.
- 서버 API 와 로봇 몸체(라인 트레이스) 연결 규약: `docs/robot-api.md`. 노드 = `data.js` 의 nodes, 주행 계획 = `Router.robotPlan`,
  위치 추정 = `Router.locate`(노드 통과 보고 + 등속도). 로봇은 엘리베이터만 쓴다(사람이 태워 주고 FLASH 버튼/화면 "내렸어요").
- **로봇 몸체는 Vietduino ESP32**(ESP8266 도 지원, 사용자 결정). 펌웨어 `firmware/peekok-robot/` (Arduino, 추가 라이브러리 없음, `config.h` 는 gitignore).
  한 파일(`peekok-robot.ino`)이 `#if defined(ESP32)` 로 라이브러리·핀·아날로그 읽기만 나누고 주행 로직은 공유한다.
  ESP32·ESP8266 모두 글자 형식 API(`GET /api/robot/drive`, POST `?fmt=text`, `lib/shared.js` 의 `driveText`)를 쓴다 — 형식을 바꾸면 펌웨어도 같이 바꾼다.
  교차로에서는 서버가 준 action(경로 모양 기준)을 따르고, 방향(N/E/S/W)은 출발할 때 몸 돌리기에만 쓴다(대각선 구간 때문).
  펌웨어 점검: `bash firmware/peekok-robot/test/run.sh` (호스트 g++ + Arduino 흉내 헤더로 컴파일하고 서버 driveText 응답으로 논리 시험,
  항상 ESP8266 코드 경로지만 공유 로직이라 ESP32 쪽도 같이 검증됨). 실제 보드 컴파일·업로드는 보드가 꽂힌 사용자 Mac 의 Claude CLI 세션에서 `arduino-cli`
  (`arduino-cli compile --fqbn esp32:esp32:esp32 -u -p <포트> firmware/peekok-robot`, ESP8266 은 `esp8266:esp8266:nodemcuv2`)로 한다.
  클라우드 환경에서는 arduino-cli 를 받을 수 없고 보드에도 닿지 않으니 호스트 시험만 한다.
  Mac 에서 시리얼 읽기: 포트는 `ls /dev/cu.usbserial-*`(다시 꽂으면 이름이 바뀜), 업로드가 끊기면 `UploadSpeed=115200`.
  Mac 에는 `timeout` 이 없고 `arduino-cli monitor` 는 시간 제한을 걸면 아무것도 안 나오니, 포트를 직접 열어 시간 제한(perl 등)을 걸고 읽는다.
  펌웨어는 켤 때만 연결 로그를 찍으므로 esptool 로 보드를 재시작한 뒤 읽는다. config.h 의 WiFi 비밀번호·로봇 키는 출력하지 않는다.
  서버 쪽 확인: D1 `robot.body_seen_at`(몸체 마지막 인증 접속)·`seen_at`(로봇 화면) — 클라우드 세션이 Cloudflare API 로 본다.
  WiFi: ESP32 는 2.4GHz 만, iPhone 핫스팟은 '호환성 최대화' + 설정 화면을 열어 둬야 보임(172.20.10.x). 시험 중엔 iPhone 핫스팟 `zzzz` 사용.
- 길 안내 방식 두 가지(`public/js/guide.js`): 길 안내 화면에서 "데려다주세요"(로봇이 문 앞까지 앞장섬, 로봇 상태 guiding → guided → returning)
  또는 "QR로 받을게요"(휴대폰 길 안내). 데려다주기도 배달과 같은 주행 계획·위치 추정·로봇 API 를 쓴다.
- D1: `kis-peekok` (id 는 wrangler.toml), 구조 `db/schema.sql` (서버가 처음 요청 때 `CREATE TABLE IF NOT EXISTS` 로 만들기도 함).
  열을 추가할 때는 D1 API 로 `ALTER TABLE` 을 직접 실행한다.
- 비밀값 `ROBOT_KEY`: Pages 프로젝트 비밀값(운영·미리보기). 값을 저장소·채팅에 남기지 않는다. 로컬은 `.dev.vars`(gitignore).
- 점검: `npx wrangler pages dev public --port 8788` 로 서버까지 띄운 뒤 `python3 tools/api-test.py http://127.0.0.1:8788 local-test-key`,
  `node tools/robot-sim.js --base http://127.0.0.1:8788 --key local-test-key --fast 20` (주행 시뮬레이터 = 로봇 몸체 참고 구현).
  배포된 곳에 api-test 를 돌리면 운영 DB 에 시험 기록이 남으니, 돌린 뒤 시험 기록을 지운다.

## 화면 원칙
- 이 웹 화면이 **로봇의 얼굴 그 자체**입니다(로봇 머리에 화면을 다는 구조). 대기 화면은 화면 전체가 공작새 얼굴이어야 하고,
  공작새 그림을 화면에 띄우는 방식이 아닙니다. 대기 화면에 이름표·시계·버튼 같은 얼굴이 아닌 요소를 넣지 않습니다.
- 터치하면 길 찾기 메뉴로 넘어가고, 일정 시간 입력이 없으면 얼굴 화면으로 돌아옵니다. 핵심 기능은 길 찾기입니다.
- **가로 태블릿 화면에 최적화**해야 합니다(로봇 얼굴 = 가로로 단 태블릿). 세로 화면은 쓰지 않으니 신경 쓰지 않습니다.
  터치 전용이라 마우스·키보드를 가정하지 않습니다. 변경할 때마다 가로 태블릿 크기로 확인합니다:
  1024×768 · 1180×820 · 1280×800 · 1366×1024.
  터치 대상은 최소 48px, 화면 꺼짐 방지(Wake Lock), 전체 화면 실행(manifest), 당겨서 새로고침·확대 방지를 유지합니다.
- **지도는 고정**입니다(사용자 요청). 끌기·두 손가락 확대·확대 버튼을 넣지 않습니다. 태블릿 길 안내 지도는 층 전체를 보여 주고,
  지도에서는 누르기(방 선택)만 받습니다.
- **QR 코드로 휴대폰에서 보기**: 길 안내 화면의 "휴대폰으로 보기" → QR 코드 → `m.html?to=<방id>&at=<층>,<x>,<y>[&mode=elevator][&k=restroom|elevator]`.
  휴대폰 페이지(`m.html`, `index.html` 부르기)는 **세로 휴대폰** 기준(390×844)으로 확인합니다.
  QR 주소의 기준은 `js/config.js` 의 `publicUrl`. QR 라이브러리는 `js/vendor/qrcode.js`(MIT, qrcode-generator 1.4.4).
  지도 공통 스타일은 `css/map.css` (태블릿·휴대폰이 같이 씀).

## 배포 — Cloudflare Pages (사용자가 정한 고정 절차, 매번 이대로)
- 주소: https://kis-peekok.pages.dev
- Pages 프로젝트 `kis-peekok` ← GitHub `lolpopach/kis-peekok` 연결, 운영 브랜치 `main`, 출력 폴더 `public`, 빌드 명령 없음.
- **배포 = 작업 브랜치에 커밋·푸시 → 같은 내용을 `main` 에 합쳐 푸시.** Cloudflare 가 자동으로 배포합니다.
  사용자가 이 절차를 승인했으니, 배포를 요청받으면 `main` 푸시를 다시 묻지 않습니다.
- 배포 확인: `tools/cloudflare.sh wait kis-peekok <커밋>` (프로젝트 목록 `projects`, 최근 배포 `status`)

### Cloudflare 토큰 — 사용자에게 다시 묻지 않기
- API 토큰은 작업 환경(`mac`)에 네트워크 비밀값으로 저장되어 있고, 프록시가 `api.cloudflare.com` 요청에 자동으로 넣습니다.
  토큰을 묻거나 `request_credential` 을 부르지 않습니다. `tools/cloudflare.sh check` 가 `FAIL` 일 때만 새 토큰을 요청합니다.
- 토큰 확인은 `GET /accounts` 로 합니다. `/user/tokens/verify` 는 계정 소유 토큰이라 정상이어도 "Invalid API Token" 이 나오니 무시합니다.
- 토큰 권한: Account → Cloudflare Pages: Edit, Account Settings: Read.

### 이 환경에서 안 되는 것 (시도하지 말 것)
- `wrangler pages deploy` (직접 업로드): 프록시가 업로드용 임시 키(JWT)를 저장된 토큰으로 덮어써서 `8000013 Authorization failed` 로 실패합니다.
- `wrangler pages project create`: 최신 wrangler 가 Workers 로 위임하다 실패합니다.
- 새 Pages 프로젝트가 필요하면 `tools/cloudflare.sh create <이름> <owner/repo>` 로 GitHub 연결 프로젝트를 만듭니다.
- 직접 업로드 방식으로 만든 프로젝트는 GitHub 연결로 바꿀 수 없습니다(지우고 같은 이름으로 다시 만들어야 함 — 지우기 전에 사용자 확인).

## 점검
- 도면·경로 데이터: `node tools/validate.js` (특정 장소 안내 문장: `node tools/validate.js 보건실 5-1`)
- 로컬 미리보기: `cd public && python3 -m http.server 8080`
