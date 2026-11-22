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
// 적외선 라인 센서 4개 (TCRT5000 모듈 등, DO 디지털 출력) 배치:
//   앞 왼쪽·앞 오른쪽 = 차체 맨 앞, 검정 선을 사이에 두고 양옆 → 선 따라가기 (선 가운데에 두면 둘 다 바닥)
//   왼쪽·오른쪽     = 차체 양옆(선에서 몇 cm 바깥) → 평소엔 선을 안 보고, 교차로·분기·끝 표시 가로선을 만나면 켜짐
#if defined(ESP32)
// Vietduino ESP32 (표준 ESP32-WROOM-32 DevKit 핀맵) 기준.
// 0·2·12·15(부팅 핀), 6~11(내장 플래시), 1·3(시리얼)은 모터·센서에 쓰지 않습니다.
#define PIN_LEFT_EN      18   // L298N ENA (왼쪽 모터 세기, PWM) — 점퍼를 빼야 함
#define PIN_LEFT_A       16   // L298N IN1 (왼쪽 방향)
#define PIN_LEFT_B       17   // L298N IN2
#define PIN_RIGHT_EN     19   // L298N ENB (오른쪽 모터 세기, PWM) — 점퍼를 빼야 함
#define PIN_RIGHT_A      25   // L298N IN3 (오른쪽 방향)
#define PIN_RIGHT_B      26   // L298N IN4
#define PIN_FRONT_LEFT   14   // 앞 왼쪽 라인 센서 DO
#define PIN_FRONT_RIGHT  33   // 앞 오른쪽 라인 센서 DO
#define PIN_SENSOR_LEFT  35   // 차체 왼쪽(바깥·뒤) 라인 센서 DO — 32 는 앞 오른쪽(33)과 신호가 옮겨붙어 35 로 (입력 전용, 풀업 없음)
#define PIN_SENSOR_RIGHT 27   // 차체 오른쪽(바깥) 라인 센서 DO (27 은 ADC2 라 WiFi 중엔 아날로그로 못 읽음)
#define SENSOR_LEFT_ANALOG  0  // 옆 센서를 AO(아날로그)로 읽을 때만 1 — ESP32 는 ADC1 핀(32~39)만
#define SENSOR_RIGHT_ANALOG 0
#define LEFT_ANALOG_THRESHOLD  2048   // 아날로그로 읽을 때 문턱값 — 12비트(0~4095)
#define RIGHT_ANALOG_THRESHOLD 2048
#define PIN_SONAR_TRIG   -1   // 초음파 HC-SR04 TRIG (-1 = 안 씀. 14 는 앞 왼쪽 센서가 씀 — 다시 달면 예: 23)
#define PIN_SONAR_ECHO   -1   // 초음파 ECHO (예: 13) — 1kΩ + 2kΩ 분배로 3.3V 로 낮춰 연결
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
#define PIN_FRONT_LEFT   D7   // 앞 왼쪽 (디지털)
#define PIN_FRONT_RIGHT  D0   // 앞 오른쪽 (디지털, GPIO16)
#define PIN_SENSOR_LEFT  -1   // 차체 왼쪽 — ESP8266 은 핀이 모자라 없음 (오른쪽 센서로만 교차로 감지)
#define PIN_SENSOR_RIGHT A0   // 차체 오른쪽 — 아날로그 입력을 문턱값으로 읽음
#define SENSOR_LEFT_ANALOG  0
#define SENSOR_RIGHT_ANALOG 1
#define LEFT_ANALOG_THRESHOLD  512
#define RIGHT_ANALOG_THRESHOLD 512
#define PIN_SONAR_TRIG   -1   // ESP8266 은 핀이 모자라 초음파를 안 씀
#define PIN_SONAR_ECHO   -1
#define PIN_BUTTON       D3   // 보드의 FLASH 버튼 (엘리베이터에서 내린 뒤 누르면 다시 출발)
#define PIN_LED          D4   // 보드 내장 LED (LOW 일 때 켜짐)
#define LED_ON           LOW
#define LED_OFF          HIGH
#define PWM_MAX          1023
#endif

// 센서가 검정 선 위에서 HIGH 를 내면 1, LOW 를 내면 0 (시리얼 's' 명령으로 확인 — 보통 검정 위에서 모듈의 초록 LED 가 꺼짐)
#define LINE_IS_HIGH     1
// 모터가 반대로 돌면 1 로 (시리얼 'm' 명령: 왼쪽 바퀴만 → 오른쪽 바퀴만 1초씩 앞으로)
#define LEFT_INVERT      0
#define RIGHT_INVERT     1

// ── 주행 세기 (PWM_MAX 기준 비율 — ESP32 는 0~255 그대로 읽으면 됨) ──
#define PWM_FREQ         200    // 모터 PWM 주파수(Hz) — 낮을수록 약한 세기에서도 바퀴가 돌아 천천히 달릴 수 있음
#define MIN_PWM          (PWM_MAX * 80 / 255)    // 이보다 약하면 바퀴가 안 도는 세기 — 시리얼 'w' 로 찾아 맞추기. 0 이 아닌 값은 이 이상으로 올림
#define SPEED_PWM        (PWM_MAX * 95 / 255)    // 선 따라갈 때 기본 세기 (처음 값 — 시리얼 + / - 로 바꾸면 보드에 기억)
#define SPEED_DUTY       65     // 느리게 달리기: PULSE_MS 중 바퀴를 돌리는 비율(%) — 100 이면 끊지 않음. 시리얼 + / - 로 ±5 (보드에 기억)
#define PULSE_MS         150    // 끊어 가기 한 주기(ms)
#define TURN_PWM         (PWM_MAX * 120 / 255)   // 제자리 회전 세기
#define ROBOT_SPEED_MPS  0.30   // SPEED_PWM 으로 선을 따라갈 때 실제 속도(m/s) — 시리얼 'c' 명령으로 재서 맞추세요

// ── 선 따라가기: 앞 두 센서 사이에 선을 두고 ──
// 둘 다 바닥 → 곧장 · 한쪽 검정 → 그쪽으로 꺾기(오래 이어질수록 세게) · 둘 다 검정(앞에 가로선) → 곧장
#define STEER_MIN        (PWM_MAX * 30 / 255)    // 막 꺾기 시작할 때 좌우 바퀴 세기 차이의 절반 (흔들리면 줄이기)
#define STEER_MAX        (PWM_MAX * 170 / 255)   // 한쪽 검정이 오래 이어지면 점점 세게 — 곡선에서 선을 놓치면 늘리기
#define STEER_RAMP_MS    600    // STEER_MIN → MAX 까지 걸리는 시간 (곡선에서 선을 놓치면 줄이기, 지그재그가 크면 늘리기)
#define COUNTER_RATIO    0.0    // 흔들림 줄이기: 바로잡기가 끝나면 그 시간의 이 비율만큼 반대로 살짝(STEER_MIN) 꺾음 (0 = 안 함)
#define COUNTER_MAX_MS   150    // 반대로 꺾는 최대 시간
#define RECOVER_CONFIRM_MS 50   // 선 되찾기: 뒤 센서가 이만큼 계속 선을 봐야 함 (잡음 거르기)
#define RECOVER_PAIR_MS  500    // 선 되찾기: 같은 쪽 앞 센서가 이 시간(바퀴 돌린 시간) 안에 선을 봤어야 "놓친 것"으로 봄
#define RECOVER_MAX_MS   1500   // 선 되찾기: 앞 센서가 놓치고 뒤 센서가 본 쪽으로 꺾을 때, 이 시간(바퀴 돌린 시간) 안에 앞 센서가 선을 못 잡으면 그만둠
#define LOST_LINE_MS     3000   // 서버 주행: 다음 교차로가 예상 시간의 2배 + 이 시간이 지나도 안 나오면 멈춤

// ── 좌우 모터 힘 차이 보정 ──
// 모든 바퀴 세기에 왼쪽 x(1+trim) · 오른쪽 x(1-trim). 선을 따라가며 스스로 배워 보드에 저장하므로 보통 0 으로 두면 됨.
// 시리얼 'b' = 곧은 선 10초 따라가며 빨리 맞추기 · ']' 왼쪽을 세게 · '[' 오른쪽을 세게 · 'z' 이 값으로 되돌리기
#define MOTOR_TRIM       0.0    // 처음 값 (+ 면 왼쪽을 세게). 'f' 로 1초 직진했을 때 오른쪽으로 휘면 +, 왼쪽으로 휘면 -
#define TRIM_LEARN       0.0    // 배우는 빠르기 (한쪽으로 1초 바로잡을 때마다 이만큼). 0 이면 배우지 않음
#define TRIM_MAX         0.30   // 보정 한계 (±30%)

// ── 교차로 (좌우 센서) ──
#define JUNCTION_MS      50     // 뒤 센서가 이만큼 이어서 선을 봐야 분기로 봄 (잡음 거르기)
#define FLICKER_MS       1000   // 뒤 센서 값이 이 시간 안에 4번 넘게 바뀌면 깜빡임(떠 있는 핀·잡음)으로 보고 무시
#define BRANCH_PAIR_MS   0      // 0 = 뒤 센서만으로 분기 판단 · 값이 있으면 같은 쪽 앞 센서가 이 시간 안에 먼저 검정을 봤어야 분기
#define DECIDE_MS        300    // 분기/T자 결정: 첫 뒤 센서가 선을 본 뒤 반대쪽 뒤 센서를 기다리는 시간(바퀴 돌린 시간) — 양쪽이면 T자
#define JUNCTION_COOLDOWN_MS 800 // 회전·통과 뒤 바퀴를 이만큼 돌릴 때까지(움직인 시간) 옆 센서를 무시 (방금 지난 선을 다시 세지 않게)
#define JUNCTION_GATE    0.45   // 다음 노드까지 예상 시간의 이 비율이 지나기 전 교차로 신호는 무시 (서버 주행만)
#define TURN_FORWARD_MS  0      // 교차로 감지 뒤 바퀴 축이 교차점에 오도록 더 가는 시간 (처음 값 — 시리얼 , . 로 ±20ms, 보드에 기억)
#define CROSS_CLEAR_MS   250    // 교차로를 곧장 지날 때 핸들을 고정하고 가는 시간
#define UTURN_PWM        (PWM_MAX * 100 / 255)   // 제자리 유턴 세기 — 두 바퀴가 다 도니 낮게 (돌다 멈추면 올리기)
#define SPIN_KICK_PWM    (PWM_MAX * 150 / 255)   // 유턴 출발 세기 (1초마다 다시 밀어 줌)
#define SPIN_KICK_MS     120    // 출발 세기 유지 시간(ms)
#define SPIN_BRAKE_MS    50     // 유턴 멈출 때 반대로 살짝 돌리는 시간(ms)
#define UTURN_IGNORE_MS  1200   // 유턴 처음 이 시간(바퀴 돌린 시간)은 T자 가로선 무시 — 덜 돌고 서면 늘리고, 왔던 선을 지나치면 줄이기
#define UTURN_DIR        'L'    // 유턴 방향
#define TURN_PAUSE_MS    1000   // 분기를 알아보면 이만큼 멈춘 뒤 회전
#define ARC_PWM          (PWM_MAX * 100 / 255)   // 앞으로 가며 돌 때 바깥 바퀴 세기 (우회전이면 왼쪽 바퀴)
#define ARC_INNER_PWM    0      // 앞으로 가며 돌 때 안쪽 바퀴 세기 (0 = 멈춤, 더 크게 돌려면 음수는 쓰지 말고 0)
#define ARC_TIMEOUT_MS   5000   // 이 시간(바퀴 돌린 시간) 안에 앞 센서 둘이 새 선에 안 닿으면 회전 실패
#define RECOVER_ENABLE   0      // 선 되찾기(앞 센서가 놓치면 뒤 센서 쪽으로 꺾기) 쓰기 1 / 안 쓰기 0
#define TURN_MIN_MS      150    // 90도 회전: 이 시간 동안은 선을 무시하고 돈다 (지금 선을 벗어나기)
#define UTURN_MIN_MS     450    // 유턴: 이 시간 동안은 선을 무시하고 돈다
#define SPIN_SETTLE_MS   600    // 회전: 앞 센서가 새 선을 지난 뒤 반대쪽 앞 센서가 이 시간(돌린 시간) 안에 선에 안 닿으면 그대로 멈춤
#define TURN_TIMEOUT_MS  4000   // 회전하다 이 시간 안에 선을 못 찾으면 멈춤

// ── 장애물 (초음파, PIN_SONAR_TRIG 를 달았을 때만) ──
#define OBSTACLE_STOP_CM  20    // 앞에 이보다 가까이 뭔가 있으면 멈춤
#define OBSTACLE_CLEAR_CM 30    // 이보다 멀어지면(또는 아무것도 없으면) 다시 출발

// ── 선 따라가기 시험 (시리얼 't' 또는 대기 중 BOOT 버튼) ──
#define TRACE_MS         60000  // 최대 시험 시간
#define TRACE_LOST_MS    1500   // 한쪽 꺾기가 이만큼 이어지면 선을 놓친 것으로 보고 멈춤
#define LIFT_MS          1500    // 센서 4개가 모두 이만큼 검정이면(로봇을 들었거나 검정 바닥) 멈춤

// ── 코스 시험 (시리얼 'k', 서버 없이) ──
// 양옆 센서가 표시(교차로·분기, 또는 선 끝에 붙인 가로선)를 볼 때마다 한 글자씩: R 우회전 · L 좌회전 · S 직진 · U 유턴 · E 정지
// 선 끝은 앞 센서로는 알 수 없으니(선이 사이에 있을 때와 똑같이 둘 다 바닥) 유턴·정지할 끝에 가로선(T 모양)을 붙이세요.
// 예: "RURLE" = 오른쪽 분기 우회전 → 끝 가로선에서 유턴 → 본선 합류 우회전 → 왼쪽 분기 좌회전 → 끝 가로선에서 정지
#define TEST_ROUTE       "RURLE"
#define TEST_GIVEUP_MS   30000  // 이 시간 동안 표시를 못 만나면 시험을 멈춤 (선을 벗어나 계속 달리지 않게)

// 로봇이 켜질 때(제자리에서) 바라보는 도면 방향: 'N' 위 · 'E' 오른쪽 · 'S' 아래 · 'W' 왼쪽
#define HOME_HEADING     'N'

// ── 서버 확인 주기 ──
#define POLL_IDLE_MS     1500
#define POLL_WAIT_MS     2000
