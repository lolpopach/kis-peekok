# 피콕 로봇 몸체 — ESP32 · ESP8266 겸용 펌웨어

ESP32(Vietduino ESP32 등) 또는 ESP8266(NodeMCU · Wemos D1 mini)이 WiFi 로 배달 서버에 붙어, 검정 라인을 따라
노드(교차로)를 지나며 목적지까지 달립니다. 주행 로직은 `peekok-robot.ino` 한 파일을 공유하고, 라이브러리·핀·
아날로그 읽기만 `#if defined(ESP32)` 로 나뉩니다 — 보드만 Arduino IDE/arduino-cli 에서 고르면 됩니다.
서버와 주고받는 규약은 [../../docs/robot-api.md](../../docs/robot-api.md) 를 보세요.

## 준비물 (기본 구성)

| 부품 | 예 | 메모 |
| --- | --- | --- |
| 보드 | **ESP32**: Vietduino ESP32 등 ESP32-WROOM-32 DevKit 호환 보드 · **ESP8266**: NodeMCU 1.0 (ESP-12E), Wemos D1 mini | |
| 모터 드라이버 | L298N · L9110S · MX1508 (입력 4개) | L298N 은 ENA/ENB 점퍼를 꽂은 채로 |
| 모터 | DC 기어드 모터 2개 (좌·우 바퀴) | 앞이나 뒤에 보조 바퀴 |
| 라인 센서 | 적외선 반사 센서 3개 (TCRT5000 모듈 등, DO 디지털 출력) | 가운데 1개는 차체 맨 앞 선 위, 양쪽은 차체 양옆(선에서 몇 cm 바깥) — 아래 "센서 배치" |
| 초음파 센서 | HC-SR04 (선택) | 앞 장애물에서 멈춤. ECHO 는 1kΩ + 2kΩ 로 나눠 3.3V 로 |
| 전원 | 모터용 배터리 + 보드용 5V | 모터 드라이버와 보드의 GND 를 꼭 연결 |

## 배선 (`config.h` 에서 바꿀 수 있음)

### ESP32 (Vietduino ESP32 등 — 기본값)

| 보드 핀(GPIO) | 연결 |
| --- | --- |
| 18 | L298N **ENA** (왼쪽 모터 세기, PWM) — ENA 점퍼를 **빼고** 연결 |
| 16 | L298N IN1 (왼쪽 모터 방향) |
| 17 | L298N IN2 (왼쪽 모터 방향) |
| 19 | L298N **ENB** (오른쪽 모터 세기, PWM) — ENB 점퍼를 **빼고** 연결 |
| 25 | L298N IN3 (오른쪽 모터 방향) |
| 26 | L298N IN4 (오른쪽 모터 방향) |
| 32 | 라인 센서 왼쪽 DO (디지털) |
| 33 | 라인 센서 가운데 DO (디지털) |
| 27 | 라인 센서 오른쪽 DO (디지털) |
| 14 | 초음파 HC-SR04 TRIG |
| 13 | 초음파 HC-SR04 ECHO — **1kΩ + 2kΩ 분배**로 5V → 3.3V 로 낮춰서 |
| 0 | 보드의 **BOOT** 버튼 (엘리베이터에서 내린 뒤 누르기) — 따로 버튼을 달려면 GPIO0 ↔ GND |
| 2 | 보드 내장 LED (상태 표시 — 보드마다 켜지는 극성이 달라 `LED_ON`/`LED_OFF` 로 맞춤) |

전원: 모터 전원(예: 8V)은 L298N 의 12V 단자로, **GND 는 L298N · ESP32 · 전원을 모두 한데** 묶습니다(USB 로 ESP32 에 전원을 줘도).
L298N 의 5V 단자는 ESP32 에 연결하지 않습니다. 점퍼를 꽂은 채 IN 네 핀에만 PWM 을 주는 드라이버(L9110S·MX1508)는
`config.h` 에서 `PIN_LEFT_EN`/`PIN_RIGHT_EN` 을 `-1` 로 두고 IN 핀 번호만 맞추면 됩니다.

라인 센서는 DO(디지털)로 읽습니다. 아날로그(AO)로 바꾸려면 ADC1 핀(32~39)만 쓰세요 — ESP32 는 WiFi 가 켜져 있는 동안
ADC2 핀(27 등)을 아날로그로 못 읽습니다. 센서·초음파 VCC 는 5V 또는 3.3V(모듈 사양), GND 는 모두 한데 묶습니다.
GPIO 0·2·12·15(부팅 때 상태가 정해져야 하는 핀), 6~11(내장 플래시 전용), 1·3(시리얼)은 모터·센서에 쓰지 않습니다.

### ESP8266 (NodeMCU · Wemos D1 mini)

| 보드 핀 | 연결 |
| --- | --- |
| D1 | 모터 드라이버 IN1 (왼쪽 모터) |
| D2 | 모터 드라이버 IN2 (왼쪽 모터) |
| D5 | 모터 드라이버 IN3 (오른쪽 모터) |
| D6 | 모터 드라이버 IN4 (오른쪽 모터) |
| D7 | 라인 센서 왼쪽 OUT (디지털) |
| D0 | 라인 센서 가운데 OUT (디지털) |
| A0 | 라인 센서 오른쪽 OUT (아날로그로 읽어 문턱값 비교 — ESP8266 은 디지털 핀이 모자람) |
| D3 | 보드의 FLASH 버튼 (엘리베이터에서 내린 뒤 누르기) — 따로 버튼을 달려면 D3 ↔ GND |
| D4 | 보드 내장 LED (LOW 일 때 켜짐) |

D3·D4·D8 은 켤 때 상태가 정해져 있어야 하는 핀이라 센서·모터에 쓰지 않았습니다.

## 센서 배치와 선 따라가는 방식

```
           앞
          [C]        ← 가운데 센서: 차체 맨 앞, 선 위
          ███
 [L]      ███      [R]  ← 좌우 센서: 차체 양옆, 선에서 몇 cm 바깥
(바퀴)    ███    (바퀴)
```

- **선 따라가기 = 가운데 센서 하나로 선의 한쪽 가장자리 타기**(`EDGE_SIDE`, 기본 `'L'` 왼쪽 가장자리).
  센서가 검정이면 선 안쪽으로 들어온 것이니 가장자리 바깥(왼쪽)으로, 바닥이면 선 쪽(오른쪽)으로 꺾습니다.
  같은 색이 오래 이어질수록(`EDGE_RAMP_MS`) 세게 꺾어 곡선도 따라갑니다. 센서가 하나여도 어느 쪽으로 꺾을지 항상 압니다
  (센서 하나로 "선 가운데"를 따라가면 선을 놓쳤을 때 어느 쪽으로 벗어났는지 몰라 한쪽으로만 돌며 원을 그리게 됩니다).
- **교차로·분기 = 좌우 센서**. 평소엔 선을 안 보다가 옆으로 뻗은 선을 만나면 켜집니다(`JUNCTION_MS` 이상).
  회전은 `TURN_FORWARD_MS` 만큼 더 가서 바퀴 축을 교차점에 맞춘 뒤 제자리에서 돌다가, 가운데 센서가 새 선을 잡으면 멈춥니다.
  회전 직후 `JUNCTION_COOLDOWN_MS` 동안은 좌우 센서를 무시합니다.
- 가장자리 쪽 분기에는 살짝 끌릴 수 있어서, 분기가 주로 오른쪽이면 `'L'`, 왼쪽이면 `'R'` 이 유리합니다.
- **장애물**: 달리는 중 초음파로 `OBSTACLE_STOP_CM` 보다 가까우면 멈추고, `OBSTACLE_CLEAR_CM` 보다 멀어지면 다시 갑니다
  (멈춘 시간만큼 구간 시계도 늦춤).
- 바퀴가 `MIN_PWM` 보다 약한 세기에서는 안 돌기 때문에, 0 이 아닌 약한 세기는 `MIN_PWM` 으로 올려서 냅니다.

## 올리기

### Arduino IDE

1. 파일 → 환경설정 → 추가 보드 관리자 URL 에 보드별로 추가:
   - ESP32: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - ESP8266: `https://arduino.esp8266.com/stable/package_esp8266com_index.json`
2. 보드 매니저에서 설치 후 보드 선택:
   - ESP32: **esp32** 설치 → 보드 **ESP32 Dev Module**
   - ESP8266: **esp8266** 설치 → 보드 **NodeMCU 1.0 (ESP-12E Module)** 또는 **LOLIN(WEMOS) D1 R2 & mini**
3. 이 폴더의 `config.example.h` 를 복사해 **`config.h`** 로 저장하고 WiFi 이름·비밀번호, 로봇 키(Cloudflare `ROBOT_KEY` 와 같은 값)를
   채웁니다. 핀도 필요하면 여기서 바꿉니다. `config.h` 는 저장소에 올라가지 않습니다(gitignore).
4. `peekok-robot.ino` 를 열고 업로드. 시리얼 모니터 115200.

추가 라이브러리는 필요 없습니다 (보드 패키지에 들어 있는 WiFi · HTTPClient · (BearSSL/mbedTLS) 만 사용).

### arduino-cli

```bash
# 보드 패키지(처음 한 번)
arduino-cli config add board_manager.additional_urls \
  https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32        # ESP32
arduino-cli core install esp8266:esp8266    # ESP8266 도 쓸 경우

# 연결된 포트 확인 (클론 보드는 Board Name 이 Unknown 으로 나와도 포트는 잡힘)
arduino-cli board list

# 컴파일 + 업로드
arduino-cli compile --fqbn esp32:esp32:esp32 -u -p /dev/cu.usbserial-10 firmware/peekok-robot
#   USB-시리얼 칩에 따라 921600 기본 보드레이트가 불안정하면 속도를 낮춥니다:
arduino-cli compile --fqbn esp32:esp32:esp32:UploadSpeed=115200 -u -p /dev/cu.usbserial-10 firmware/peekok-robot

# ESP8266 쪽
arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2 -u -p /dev/cu.usbserial-10 firmware/peekok-robot
```

### WiFi 가 안 붙을 때

시리얼 모니터에 `WiFi "이름" 연결 중.....` 이 20초 넘게 이어지면, 펌웨어가 이유와 **지금 보이는 WiFi 목록**을 출력합니다
(`▶` 같은 이름 · `?` 대소문자·띄어쓰기·따옴표만 다른 비슷한 이름, 각 WiFi 의 보안 방식).

- ESP32·ESP8266 은 **2.4GHz** WiFi 만 잡습니다. 5GHz 전용 WiFi 는 목록에 나오지 않습니다.
- **iPhone 핫스팟**: 설정 → 개인용 핫스팟 → **호환성 최대화** 켜기(2.4GHz), 연결될 때까지 그 설정 화면을 열어 두기.
  iPhone 이름의 `’`(둥근 따옴표)는 키보드의 `'` 와 다른 글자라, 이름을 영어·숫자로 바꾸거나 목록 글자를 그대로 복사합니다.
- 이름이 `▶` 로 맞는데도 안 되면 비밀번호(`WIFI_PASS`)를 확인합니다.
- 보안 방식이 **아이디+비밀번호(엔터프라이즈)** 면 펌웨어에 로그인 기능을 추가해야 합니다. 웹 로그인 페이지가 뜨는 WiFi 는
  쓸 수 없으니 학교에 기기 등록(업로드할 때 나오는 `MAC:` 주소)이나 기기용 WiFi 를 부탁합니다.

## 맞추기 (시리얼 모니터에 한 글자 입력)

| 입력 | 하는 일 |
| --- | --- |
| `s` | 센서 값 5초 동안 보기 — 검정 선 위에서 1 이 나오면 맞음, 0 이면 `LINE_IS_HIGH` 를 반대로 |
| `u` | 초음파 거리 4초 동안 보기 |
| `m` | 왼쪽 바퀴만 1초 → 오른쪽 바퀴만 1초 앞으로 — 뒤로 도는 바퀴는 `LEFT_INVERT` / `RIGHT_INVERT` 를 바꾸기 |
| `f` | 1초 앞으로 |
| `l` / `r` | 0.5초 제자리 왼쪽 / 오른쪽 회전 |
| `c` | 5초 동안 선 따라가기(교차로 무시) → 간 거리(m) ÷ 5 를 `ROBOT_SPEED_MPS` 에 넣기 (위치 표시와 마지막 구간 멈춤에 쓰임) |
| `k` | **코스 시험**(서버 없이): 선을 따라가다 교차로나 선 끝을 만날 때마다 `TEST_ROUTE` 의 다음 글자를 함 — `R` 우회전 · `L` 좌회전 · `S` 직진 · `U` 유턴(선 끝) · `E` 정지. 기본 `"RURLE"` |
| `v` | 주행 기록 켜기/끄기 — 달리는 동안 0.1초마다 센서(L C R)·바퀴 세기·초음파 거리 출력 (잘 안 될 때 이 기록을 보고 맞춤) |
| `p` | 받은 주행 계획 보기 |
| `x` | 멈춤 (코스 시험도 멈춤) |

맞추는 순서: `s`(센서) → `m`(바퀴 방향) → `c`(선 따라가기·속도) → `k`(코스). 잘 안 되면:
- 직선에서 지그재그가 크다 → `EDGE_STEER_MIN` 줄이기 / `EDGE_RAMP_MS` 늘리기. 곡선에서 선을 놓친다 → 반대로.
- 바퀴가 안 돌고 웅웅거린다 → `MIN_PWM`·`SPEED_PWM` 올리기 (배터리가 약해져도 그럼).
- 회전 뒤 새 선의 한쪽으로 치우친다 → `TURN_FORWARD_MS` 조정. 교차로를 곧장 못 지나간다 → `CROSS_CLEAR_MS`.
- 분기가 없는데 돈다(좌우 센서가 본선을 봄) → 좌우 센서를 선에서 더 멀리, 또는 `JUNCTION_MS` 늘리기.
보드 내장 LED 가 반대로 켜지면(의도와 반대로 켜지거나 꺼짐) `config.h` 의 `LED_ON`/`LED_OFF` 를 서로 바꾸세요.

## 달리는 방식

1. 1.5초마다 `GET /api/robot/drive` 로 모드와 계획을 확인합니다.
2. 모드가 `to_caller` · `delivering` · `guiding`(데려다주기) · `returning` 이면 출발:
   - 처음에는 켤 때 방향(`HOME_HEADING`)과 계획의 첫 방향을 비교해 그대로 가거나 유턴합니다.
   - 라인을 따라가다 교차로(좌우 센서가 선을 봄)를 만나면 멈추고 `progress` 로 보고한 뒤,
     서버가 정해 준 동작(좌회전·우회전·직진·유턴)을 합니다. 다음 노드까지 예상 시간의 45% 가 지나기 전 교차로 신호는 무시합니다.
   - **엘리베이터 노드**에서는 멈춰 기다립니다. 로봇 화면에 "엘리베이터에 태워 주세요" 가 뜨면 사람이 로봇을 태워
     해당 층에서 내려 출구 방향으로 선 위에 놓고, **FLASH/BOOT 버튼** 또는 **로봇 화면의 "N층에서 내렸어요"** 를 누르면 이어서 달립니다.
   - 마지막 노드를 지나면 `END`(방 문 앞)까지는 거리 ÷ 속도 시간만큼 가서 멈추고 `arrived` 를 보냅니다.
3. 달리는 중 보고 응답에서 계획이 바뀌면(취소·새 목적지) 멈추고 새 계획으로 다시 출발합니다.

LED: 천천히 깜빡 = 대기 · 켜짐 = 주행 · 0.5초 깜빡 = 엘리베이터 대기 · 빠르게 깜빡 = 오류(선을 잃음 등, 새 계획이 오면 다시 시도) · 아주 빠르게 깜빡 = 코스 시험 중

## 보안 메모

HTTPS 인증서 검사를 하지 않는 간단한 방식(`setInsecure`)으로 접속합니다. 학교 WiFi 안에서 쓰기에는 충분하지만,
더 안전하게 하려면(ESP8266 은 BearSSL, ESP32 는 WiFiClientSecure) 신뢰할 인증서(예: Google Trust Services / Let's Encrypt 루트)를
넣고 NTP 로 시간을 맞춘 뒤 인증서 검사를 켜세요.
로봇 키가 새면 Cloudflare 에서 `ROBOT_KEY` 를 바꾸고 `config.h` 와 태블릿 설정 링크를 새 값으로 바꾸면 됩니다.

## 시험

실제 로봇 없이 같은 방식으로 서버와 주고받는 시뮬레이터:

```bash
node tools/robot-sim.js --base https://kis-peekok.pages.dev --key <로봇 키> --text --fast 5
```

펌웨어 논리(응답 해석·회전·보고·엘리베이터 재출발)는 호스트 g++ 로 검증합니다(항상 ESP8266 코드 경로로 시험 —
공유 로직이라 ESP32 쪽도 같이 검증되는 셈입니다):

```bash
bash firmware/peekok-robot/test/run.sh
```

실제 보드 컴파일/업로드는 위 "올리기" 의 arduino-cli 명령으로 확인합니다.
