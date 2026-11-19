// 피콕 로봇 몸체(ESP8266) 설정 — 이 파일을 복사해 config.h 로 저장한 뒤 값을 채우세요.
// config.h 는 비밀값(WiFi 비밀번호, 로봇 키)이 들어가므로 저장소에 올리지 않습니다(.gitignore).
#pragma once

// ── 네트워크 ──
#define WIFI_SSID        "학교WiFi이름"
#define WIFI_PASS        "WiFi비밀번호"
#define SERVER_HOST      "kis-peekok.pages.dev"
#define ROBOT_KEY        "로봇키"          // Cloudflare 의 ROBOT_KEY 와 같은 값

// ── 핀 (NodeMCU · Wemos D1 mini 기준) ──
// 모터 드라이버: 입력 4개짜리(L298N, L9110S, MX1508 등). L298N 은 ENA/ENB 점퍼를 꽂은 채로 씁니다.
#define PIN_LEFT_A       D1   // 왼쪽 모터 IN1
#define PIN_LEFT_B       D2   // 왼쪽 모터 IN2
#define PIN_RIGHT_A      D5   // 오른쪽 모터 IN3
#define PIN_RIGHT_B      D6   // 오른쪽 모터 IN4
// 적외선 라인 센서 3개 (TCRT5000 모듈 등). 가운데 센서가 선 위, 양쪽 센서는 선 바깥에 오게 둡니다.
#define PIN_SENSOR_LEFT  D7   // 디지털
#define PIN_SENSOR_MID   D0   // 디지털 (GPIO16)
#define PIN_SENSOR_RIGHT A0   // 아날로그 입력을 문턱값으로 읽음 (ESP8266 은 디지털 핀이 모자라서)
#define RIGHT_ANALOG_THRESHOLD 512
#define PIN_BUTTON       D3   // 보드의 FLASH 버튼 (엘리베이터에서 내린 뒤 누르면 다시 출발)
#define PIN_LED          D4   // 보드 내장 LED (LOW 일 때 켜짐)

// 센서가 검정 선 위에서 HIGH 를 내면 1, LOW 를 내면 0 (시리얼 's' 명령으로 확인)
#define LINE_IS_HIGH     1
// 모터가 반대로 돌면 1 로
#define LEFT_INVERT      0
#define RIGHT_INVERT     0

// ── 주행 ──
#define PWM_MAX          1023
#define SPEED_PWM        620    // 직선 주행 세기 (0~1023)
#define STEER_PWM        300    // 선을 벗어나 바로잡을 때 안쪽 바퀴 세기
#define TURN_PWM         560    // 제자리 회전 세기
#define ROBOT_SPEED_MPS  0.50   // SPEED_PWM 으로 달릴 때 실제 속도(m/s) — 시리얼 'c' 명령으로 재서 맞추세요
#define TURN_FORWARD_MS  260    // 교차로를 감지한 뒤 바퀴 축이 교차점에 오도록 더 가는 시간
#define CROSS_CLEAR_MS   220    // 교차로를 곧장 지나갈 때 센서가 교차로를 벗어나는 시간
#define UTURN_MIN_MS     700    // 유턴할 때 이 시간이 지난 뒤에 만나는 선을 잡음
#define TURN_TIMEOUT_MS  4000   // 회전하다 이 시간 안에 선을 못 찾으면 멈춤
#define LOST_LINE_MS     1500   // 선을 이만큼 못 보면 멈춤
#define JUNCTION_MS      25     // 교차로 신호가 이만큼 이어져야 교차로로 봄
#define JUNCTION_GATE    0.45   // 다음 노드까지 예상 시간의 이 비율이 지나기 전 교차로 신호는 무시

// 로봇이 켜질 때(제자리에서) 바라보는 도면 방향: 'N' 위 · 'E' 오른쪽 · 'S' 아래 · 'W' 왼쪽
#define HOME_HEADING     'N'

// ── 서버 확인 주기 ──
#define POLL_IDLE_MS     1500
#define POLL_WAIT_MS     2000
