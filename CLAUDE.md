# kis-peekok 작업 지침

학교 안내 로봇 **피콕**의 얼굴 화면 웹앱입니다. 빌드 과정 없는 정적 사이트이고, 사이트 파일은 모두 `public/` 에 있습니다.
사용자와는 한국어로 대화합니다.

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
  휴대폰 페이지(`m.html`, `js/mobile.js`, `css/mobile.css`)는 **세로 휴대폰** 기준(390×844)으로 확인합니다.
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
