// 피콕 로봇 몸체 설정 — 이 파일을 복사해 config.h 로 저장한 뒤 값을 채우세요.
// config.h 는 비밀값(WiFi 비밀번호, 로봇 키)이 들어가므로 저장소에 올리지 않습니다(.gitignore).
// 보드는 .ino 가 컴파일 시 자동으로 구분합니다(ESP32 매크로는 esp32 보드 패키지가 정의).
#pragma once

// ── 네트워크 ──
#define WIFI_SSID        "학교WiFi이름"
#define WIFI_PASS        "WiFi비밀번호"
#define SERVER_HOST      "kis-peekok.pages.dev"
#define ROBOT_KEY        "로봇키"          // Cloudflare 의 ROBOT_KEY 와 같은 값

// ── 핀 ──
// 모터 드라이버: L298N (ENA/ENB 를 PWM 핀에 연결 — 점퍼는 뺌) 또는 입력 4개짜리(L9110S, MX1508, 점퍼 꽂은 L298N).
//   PIN_LEFT_EN / PIN_RIGHT_EN 에 핀 번호를 쓰면 EN 핀으로 세기·IN 핀으로 방향, -1 이면 IN 핀에 PWM.
// 적외선 라인 센서 3개 (TCRT5000 모듈 등) 배치:
//   가운데 센서 = 차체 맨 앞, 선 위 → 이 센서 하나로 선의 한쪽 가장자리를 따라감(EDGE_SIDE)
//   왼쪽·오른쪽 센서 = 차체 양옆(선에서 몇 cm 바깥) → 평소엔 선을 안 보고, 교차로·분기 선을 만나면 켜짐
#if defined(ESP32)
// Vietduino ESP32 (표준 ESP32-WROOM-32 DevKit 핀맵) 기준.
// 0·2·12·15(부팅 핀), 6~11(내장 플래시), 1·3(시리얼)은 모터·센서에 쓰지 않습니다.
#define PIN_LEFT_EN      18   // L298N ENA (왼쪽 모터 세기, PWM) — 점퍼를 빼야 함
#define PIN_LEFT_A       16   // L298N IN1 (왼쪽 방향)
#define PIN_LEFT_B       17   // L298N IN2
#define PIN_RIGHT_EN     19   // L298N ENB (오른쪽 모터 세기, PWM) — 점퍼를 빼야 함
#define PIN_RIGHT_A      25   // L298N IN3 (오른쪽 방향)
#define PIN_RIGHT_B      26   // L298N IN4
#define PIN_SENSOR_LEFT  32   // 라인 센서 DO (디지털)
#define PIN_SENSOR_MID   33   // 라인 센서 DO (디지털)
#define PIN_SENSOR_RIGHT 27   // 라인 센서 DO (디지털 — 27 은 ADC2 라 WiFi 중엔 아날로그로 못 읽음)
#define SENSOR_LEFT_ANALOG  0
#define SENSOR_MID_ANALOG   0
#define SENSOR_RIGHT_ANALOG 0
#define LEFT_ANALOG_THRESHOLD  2048   // 아날로그(AO)로 바꿀 때만 씀 — 12비트(0~4095) 문턱값
#define MID_ANALOG_THRESHOLD   2048
#define RIGHT_ANALOG_THRESHOLD 2048
#define PIN_SONAR_TRIG   14   // 초음파 HC-SR04 TRIG (-1 이면 초음파 안 씀)
#define PIN_SONAR_ECHO   13   // 초음파 ECHO — 1kΩ + 2kΩ 분배로 3.3V 로 낮춰 연결
#define PIN_BUTTON       0    // 보드의 BOOT 버튼 (엘리베이터에서 내린 뒤 누르면 다시 출발)
#define PIN_LED          2    // 보드 내장 LED — 보드마다 다를 수 있어 실물로 확인하세요
#define LED_ON           HIGH // 이 보드의 내장 LED 가 반대로 켜지면 LOW 로 바꾸세요
#define LED_OFF          LOW
#define PWM_MAX          255  // ESP32 analogWrite 기본 해상도(8비트) 기준
#else
// NodeMCU 1.0 · Wemos D1 mini 기준.
#define PIN_LEFT_EN      -1   // ENA/ENB 점퍼를 꽂은 채 IN 핀에 PWM (ESP8266 은 핀이 모자라서)
#define PIN_RIGHT_EN     -1
#define PIN_LEFT_A       D1   // 왼쪽 모터 IN1
#define PIN_LEFT_B       D2   // 왼쪽 모터 IN2
#define PIN_RIGHT_A      D5   // 오른쪽 모터 IN3
#define PIN_RIGHT_B      D6   // 오른쪽 모터 IN4
#define PIN_SENSOR_LEFT  D7   // 디지털
#define PIN_SENSOR_MID   D0   // 디지털 (GPIO16)
#define PIN_SENSOR_RIGHT A0   // 아날로그 입력을 문턱값으로 읽음 (ESP8266 은 디지털 핀이 모자라서)
#define SENSOR_LEFT_ANALOG  0
#define SENSOR_MID_ANALOG   0
#define SENSOR_RIGHT_ANALOG 1
#define LEFT_ANALOG_THRESHOLD  512   // 왼쪽·가운데는 디지털이라 안 쓰지만, 공용 코드가 참조하니 남겨 둠
#define MID_ANALOG_THRESHOLD   512
#define RIGHT_ANALOG_THRESHOLD 512
#define PIN_SONAR_TRIG   -1   // ESP8266 은 핀이 모자라 초음파를 안 씀
#define PIN_SONAR_ECHO   -1
#define PIN_BUTTON       D3   // 보드의 FLASH 버튼 (엘리베이터에서 내린 뒤 누르면 다시 출발)
#define PIN_LED          D4   // 보드 내장 LED (LOW 일 때 켜짐)
#define LED_ON           LOW
#define LED_OFF          HIGH
#define PWM_MAX          1023
#endif

// 센서가 검정 선 위에서 HIGH 를 내면 1, LOW 를 내면 0 (시리얼 's' 명령으로 확인 — 모듈의 초록 LED 가 꺼지는 쪽이 보통 검정)
#define LINE_IS_HIGH     1
// 모터가 반대로 돌면 1 로 (시리얼 'm' 명령: 왼쪽 바퀴만 → 오른쪽 바퀴만 1초씩 앞으로)
#define LEFT_INVERT      0
#define RIGHT_INVERT     1

// ── 주행 세기 (PWM_MAX 기준 비율 — ESP32 는 0~255 그대로 읽으면 됨) ──
#define MIN_PWM          (PWM_MAX * 105 / 255)   // 이보다 약하면 바퀴가 안 도는 세기(L298N·7.5V 기준) — 0 이 아닌 값은 이 이상으로 올림
#define SPEED_PWM        (PWM_MAX * 135 / 255)   // 선 따라갈 때 기본 세기
#define TURN_PWM         (PWM_MAX * 155 / 255)   // 제자리 회전 세기
#define ROBOT_SPEED_MPS  0.30   // SPEED_PWM 으로 선을 따라갈 때 실제 속도(m/s) — 시리얼 'c' 명령으로 재서 맞추세요

// ── 선 따라가기: 가운데 센서로 선의 한쪽 가장자리를 따라감 ──
// 'L' = 선의 왼쪽 가장자리: 센서가 검정이면 왼쪽으로, 바닥이면 오른쪽으로 살짝 꺾으며 가장자리를 탄다.
// 가장자리 쪽의 분기에만 살짝 끌리므로, 분기가 주로 오른쪽에 있으면 'L', 왼쪽에 있으면 'R' 이 유리.
#define EDGE_SIDE        'L'
#define EDGE_STEER_MIN   (PWM_MAX * 40 / 255)    // 막 꺾기 시작할 때 좌우 바퀴 세기 차이의 절반
#define EDGE_STEER_MAX   (PWM_MAX * 240 / 255)   // 같은 색이 오래 이어지면 점점 세게 — 이만큼이면 제자리 회전
#define EDGE_RAMP_MS     350    // EDGE_STEER_MIN → MAX 까지 걸리는 시간 (곡선에서 선을 놓치면 줄이기, 지그재그가 크면 늘리기)
#define LOST_LINE_MS     2500   // 가운데 센서가 이만큼 바닥만 보면 선을 잃은 것으로 보고 멈춤

// ── 교차로 (좌우 센서) ──
#define JUNCTION_MS      20     // 좌우 센서가 이만큼 이어서 선을 봐야 교차로로 봄 (잡음 거르기)
#define JUNCTION_COOLDOWN_MS 450 // 회전·통과 직후 이 시간 동안은 좌우 센서를 무시 (방금 지난 선을 다시 세지 않게)
#define JUNCTION_GATE    0.45   // 다음 노드까지 예상 시간의 이 비율이 지나기 전 교차로 신호는 무시 (서버 주행만)
#define TURN_FORWARD_MS  120    // 교차로 감지 뒤 바퀴 축이 교차점에 오도록 더 가는 시간 (회전 뒤 선 오른쪽/왼쪽으로 치우치면 조정)
#define CROSS_CLEAR_MS   250    // 교차로를 곧장 지날 때 핸들을 고정하고 가는 시간
#define TURN_MIN_MS      150    // 90도 회전: 이 시간 동안은 선을 무시하고 돈다 (지금 선을 벗어나기)
#define UTURN_MIN_MS     450    // 유턴: 이 시간 동안은 선을 무시하고 돈다
#define TURN_TIMEOUT_MS  4000   // 회전하다 이 시간 안에 선을 못 찾으면 멈춤
#define LINE_END_MS      450    // 코스 시험('k'): 가운데 센서가 이만큼 바닥만 보면 선 끝

// ── 장애물 (초음파) ──
#define OBSTACLE_STOP_CM  20    // 앞에 이보다 가까이 뭔가 있으면 멈춤
#define OBSTACLE_CLEAR_CM 30    // 이보다 멀어지면(또는 아무것도 없으면) 다시 출발

// ── 코스 시험 (시리얼 'k', 서버 없이) ──
// 교차로(좌우 센서) 또는 선 끝(가운데 센서)을 만날 때마다 한 글자씩: R 우회전 · L 좌회전 · S 직진 · U 유턴 · E 정지(끝)
// 예: "RURLE" = 오른쪽 분기 우회전 → 끝에서 유턴 → 본선 합류 우회전 → 왼쪽 분기 좌회전 → 끝에서 정지
#define TEST_ROUTE       "RURLE"

// 로봇이 켜질 때(제자리에서) 바라보는 도면 방향: 'N' 위 · 'E' 오른쪽 · 'S' 아래 · 'W' 왼쪽
#define HOME_HEADING     'N'

// ── 서버 확인 주기 ──
#define POLL_IDLE_MS     1500
#define POLL_WAIT_MS     2000
