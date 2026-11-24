# 피콕 로봇 몸체 — Makeblock mBot2 (CyberPi)

ESP32 펌웨어(`../peekok-robot`)와 **똑같은 서버 약속**(글자 형식 API, [docs/robot-api.md](../../docs/robot-api.md))으로 말하는
mBot2 용 프로그램입니다. 웹·서버·로봇 얼굴 화면은 바꿀 것이 없고, 몸체만 갈아 끼우면 됩니다.
ESP32 펌웨어는 그대로 남아 있으니 언제든 되돌릴 수 있습니다(한 번에 하나만 켜기 — 둘 다 같은 로봇 키를 씀).

| 파일 | 하는 일 |
| --- | --- |
| `peekok_mbot2.py` | 펌웨어 한 파일 (CyberPi MicroPython). 맨 위 `설정` 에 속도·몸 크기 |
| `config.example.py` | WiFi·로봇 키 적는 틀 → `config.py` 로 복사 (저장소에 안 올라감) |
| `tools/build.py` | `config.py` 를 펌웨어에 넣어 올릴 파일 `dist/upload.py` 를 만듦 |
| `test/run.sh` | 컴퓨터 시험: 진짜 펌웨어를 가짜 mBot2·가짜 바닥(시범 코스) 위에서 |

## 기기를 받은 날 — 순서대로

준비물: mBot2 (기본 구성: CyberPi + 쿼드 RGB 센서, 초음파는 안 씀), USB-C 선, 노트북(Windows, mLink 설치됨), 2.4GHz WiFi.

1. **설정 채우기** (처음 한 번)
   ```bash
   cd firmware/peekok-mbot2
   cp config.example.py config.py      # 메모장·VS Code 로 열어 WiFi 이름·비밀번호·로봇 키 세 줄 채우기
   python tools/build.py                # → dist/upload.py 가 생김 (비밀값은 화면에 안 나옴)
   ```
2. **올리기**: mLink 를 켜고 mBlock 웹(ide.mblock.cc)에서 장치 **CyberPi** 추가 → USB 로 **연결** →
   **Python** 편집 모드 → `dist/upload.py` 내용을 통째로 붙여 넣기 → **업로드**(Upload).
   업로드가 끝나면 CyberPi 화면에 `PEEKOK mBot2` 가 뜹니다.
3. **WiFi·서버 확인**: 화면 `WiFi ok` · `srv idle` 이 뜨면 연결된 것. 로봇 얼굴 화면 관리자 메뉴에 **로봇 몸체(mBot2) 연결됨**.
   안 붙으면 화면이 `WiFi ...` 로 남습니다 → 2.4GHz 인지, iPhone 핫스팟이면 '호환성 최대화'를 켜고 설정 화면을 열어 두기.
4. **점검 (B 버튼)**: 바닥에 내려놓고 B. 바퀴가 제자리에서 살짝 돌았다가, 앞으로 3cm 갔다 돌아옵니다.
   자이로로 바퀴 방향을 스스로 맞춰 CyberPi 에 저장합니다(`peekok_cal.txt`). **뒤로 먼저 갔으면** `config.py` 에 `LEFT_SIGN = -1` 을 넣고 다시 올리기.
5. **선 따라가기 시험 (A 버튼)**: 선 위에 놓고 A → 2초 뒤 출발, 다시 A·B 로 멈춤. 끝나면 가운데 비율이 기록에 남습니다.
6. **코스 시험 (조이스틱 누르기)**: 제자리(12-5 끝 가로선 앞, 동쪽을 보게)에 놓고 누르면 서버 없이 `TEST_ROUTE` 대로 갈림길마다 돕니다.
7. **진짜 주행**: 휴대폰으로 피콕을 부르거나 로봇 화면에서 "데려다주세요". ESP32 때와 똑같이 움직입니다.

기기 앞 동작은 모두 **기록(로그)** 으로 서버에 올라갑니다(멈춰 있을 때 몇 초마다). 그래서 Claude 가 클라우드에서
D1 `robot_log` 표를 읽어 원인을 볼 수 있습니다 — 로그를 복사해 올 필요가 없습니다.

## CyberPi 버튼

| 언제 | 버튼 | 하는 일 |
| --- | --- | --- |
| 대기 | A | 선 따라가기 시험 (2초 뒤) |
| 대기 | B | 점검: 센서·자이로·바퀴 방향 |
| 대기 | 조이스틱 누르기 | 코스 시험 `TEST_ROUTE` (서버 없이) |
| 달리는 중 | B | 멈춤 (그 계획으로 다시 출발하지 않음) |
| 엘리베이터 앞 | A | 내렸어요 → 다시 출발 (로봇 화면의 "내렸어요" 와 같음) |

## 어떻게 달리나 (ESP32 와 같은 점·다른 점)

- **같음**: 서버 계획(노드·동작) 따르기, 갈림길마다 다음 노드의 동작(경로 모양 기준), 출발 때만 방향(N/E/S/W)으로 몸 돌리기,
  끝 가로선(T)에서 도착, 엘리베이터 기다리기, rev 가 바뀌면 멈추고 새 계획, 켜기 전 계획은 다시 달리지 않기, 끝내거나 실패한 계획 다시 안 달리기.
- **선 따라가기**: 쿼드 RGB 의 네 센서(L2 L1 R1 R2, 앞 한 줄)로 선 위치를 재서 바퀴 속도(rpm)를 바로잡습니다. 인코더 모터라
  좌우 힘 보정(motorTrim)·끊어 가기·최소 세기가 필요 없고, 남은 치우침은 조금씩 쌓아 바로잡습니다(`FOLLOW_KI`).
- **갈림길**: 테이프 한 줄로는 덮을 수 없는 넓은 검정(L2 와 R1 이 함께 검정 등)을 보면 `DECIDE_CM` 더 가며 지켜보고,
  넓은 검정을 충분히 봤거나 그 뒤 선이 끝나면(꺾이는 곳·T) 갈림길. 한 번 튀는 센서 값은 최근 3번 중 2번으로 거릅니다.
- **회전**: 처음 넓은 검정을 본 곳에서 `SENSOR_AHEAD_CM + 테이프 반 폭` 만큼 가 바퀴 축을 갈림길에 맞추고, 자이로로 `TURN_MIN_DEG` 넘게
  돈 뒤 안쪽 센서가 새 선을 잡으면 멈춤. 자이로가 없으면 바퀴 회전으로 각도를 셉니다.
- **거리**: 바퀴 rpm × 시간으로 cm 를 셉니다(갈림길 지켜보기·선 놓침 판단). 지도 위치는 ESP32 처럼 구간 시간으로 맞춘 속도를 보고합니다.
- **CyberPi 가 느리면**: 한 바퀴(센서 읽기)가 `LOOP_TARGET_MS` 보다 느리면 그만큼 천천히 달립니다(최대 절반).

## 서버에 붙는 방식

- `urequests` 로 HTTPS. 없으면 소켓(+ussl)으로 직접. 요청마다 `X-Robot-Key`, `X-Robot-Body: mbot2`.
- 대기 중 1.5초마다 `GET /api/robot/drive`. 보낼 기록이 있으면 대신 `POST /api/robot/log?fmt=text`(응답이 같은 글자 형식).
- 노드 보고 `progress?fmt=text`, 도착 `arrived?fmt=text` — 응답만 보고 계획이 바뀌었는지 압니다.

## 컴퓨터 시험

```bash
bash firmware/peekok-mbot2/test/run.sh                                     # 서버 없이
bash firmware/peekok-mbot2/test/run.sh http://127.0.0.1:8788 local-test-key  # 로컬 서버까지 (wrangler pages dev)
```

가짜 바닥은 `data.js` 의 `robotCourse`(도면 1단위 = 2cm, 테이프 1.9cm, 방 앞 T 20cm)입니다. 왼쪽 바퀴 3% 세게, 처음 놓는 자리를 조금 비뚤게 하고,
몸·바닥이 설정과 다를 때(바퀴 힘 ±8%, 자이로 없음, 테이프 1.5~2.5cm, 센서 간격·앞 거리, 바퀴 지름, 센서 잡음, 느린 반복)도 제자리 → 12-3 → 제자리를 왕복하는지 봅니다.
서버 시험은 로봇 화면이 하는 요청(받기·출발·받았어요·돌아갈 계획)까지 대신 하며 데려다주기·배달·달리는 중 새 계획·원격 기록을 확인합니다.

## 기기에서만 확인할 수 있는 것

컴퓨터 시험은 Makeblock 문서에 적힌 함수 이름(`mbot2.drive_speed`, `mbuild.quad_rgb_sensor.is_line`, `cyberpi.get_rotation`,
`cyberpi.controller.is_press`, `cyberpi.wifi.connect`, `urequests`)을 흉내 냅니다. 실제 이름이 다르면 켤 때 기록 첫 줄의 `API {...}` 에
`False` 로 나오니, 그 기록을 보고 고치면 됩니다. 쿼드 RGB 의 실제 센서 간격·앞 거리는 시험 범위(±1~3cm, 5.5~9cm) 안이면 그대로 됩니다.
