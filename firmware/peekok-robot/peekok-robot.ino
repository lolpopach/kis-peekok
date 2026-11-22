/* 피콕 로봇 몸체 — ESP8266 · ESP32(Vietduino 등) 겸용 라인 트레이스 펌웨어
 *
 * 하는 일
 *   1) WiFi 로 https://<SERVER_HOST>/api/robot/drive 를 읽어 지금 모드와 주행 계획(노드 목록)을 받는다.
 *   2) 모드가 to_caller · delivering · guiding · returning 이면 계획대로 검정 라인을 따라 달린다.
 *        - 교차로(노드)를 만나면 멈추고 /api/robot/progress 로 "이 노드를 지나 다음 노드로" 보고
 *        - 계획의 방향(N·E·S·W)과 지금 방향을 비교해 직진·좌회전·우회전·유턴
 *        - 엘리베이터 노드: 멈춰서 기다림 → FLASH/BOOT 버튼 또는 로봇 화면의 "내렸어요" 버튼으로 다시 출발
 *        - 마지막 노드 다음(END, 방 문 앞)은 거리 ÷ 속도 시간만큼 가서 멈추고 /api/robot/arrived
 *   3) 그 밖의 모드(idle · loading · at_recipient)에서는 멈춰 기다린다.
 *
 * 서버 응답 형식(글자, 줄마다):
 *   ok / mode <모드> / rev <계획번호> / passed <지난노드> / nodes <개수>
 *   <key> <action> <heading|-> <next_m> <toFloor>   ← 노드 수만큼
 *   end
 *
 * 준비: 보드 종류는 아래 중 하나로 Arduino IDE/arduino-cli 에서 고른다 — 주행 로직은 같은 파일을 공유하고
 *       (#if defined(ESP32)) 로 라이브러리·핀·아날로그 읽기만 나뉜다.
 *         - ESP32 (Vietduino ESP32 등 ESP32-WROOM-32 DevKit 호환 보드): 보드 매니저 "esp32" 설치 →
 *           보드 "ESP32 Dev Module" (arduino-cli FQBN: esp32:esp32:esp32)
 *         - ESP8266 (NodeMCU 1.0 · Wemos D1 mini): 보드 매니저 "esp8266" 설치 →
 *           보드 "NodeMCU 1.0" 또는 "LOLIN(WEMOS) D1 mini"
 *       config.example.h 를 config.h 로 복사해 WiFi·로봇 키·핀을 채운다.
 *
 * 센서 배치와 선 따라가기 (라인 센서 4개)
 *   앞 왼쪽·앞 오른쪽 센서(차체 맨 앞)는 검정 선을 사이에 두고 양옆, 왼쪽·오른쪽 센서는 차체 양옆(선에서 몇 cm 바깥).
 *   - 선 따라가기: 앞 두 센서가 모두 바닥이면 곧장, 한쪽이 검정이면 그쪽으로 꺾는다(오래 이어질수록 세게 — 곡선 대응).
 *     둘 다 검정이면 앞에 가로선(교차로)이 있는 것이니 꺾지 않고 곧장.
 *   - 교차로·분기·선 끝 표시: 평소엔 선을 안 보는 양옆 센서가 선을 보면 교차로. 회전은 제자리에서 돌다
 *     앞 센서가 새 선을 잡으면 멈춘다. 선 끝은 앞 센서로는 알 수 없어서, 유턴·정지할 곳에는 가로선을 붙여 둔다.
 *   - 좌우 모터 힘 차이: 모든 바퀴 세기에 보정값(motorTrim)을 곱한다. 선을 따라가면서 한쪽으로만 자꾸 바로잡으면
 *     (예: 앞 왼쪽 센서가 더 자주 켜짐 = 로봇이 오른쪽으로 쏠림 = 왼쪽 모터가 셈) 보정값을 조금씩 옮겨 스스로 맞추고,
 *     멈출 때 보드 저장공간에 기억한다. 곡선(오래 이어지는 꺾기)은 배우지 않는다.
 *   - 초음파(HC-SR04)를 달면(PIN_SONAR_TRIG) 달리는 중 앞에 장애물이 가까우면 멈췄다가 치워지면 다시 간다.
 * 시리얼(115200): s 센서 · u 초음파 · m 바퀴 하나씩 · f 앞으로 · l/r 제자리 회전 · c 속도 재기(5초 선 따라가기)
 *                 t 선 따라가기 시험(점수 · 대기 중 BOOT 버튼도) · k 코스 시험(서버 없이 TEST_ROUTE) · b 모터 힘 맞추기(10초) · [ ] 보정 손으로 · z 보정 처음으로
 *                 + / - 속도(끊어 가기 %, 보드에 기억) · ( ) 세기 · w 바퀴가 도는 최소 세기 찾기 · h 멈춤 시험(분기를 알아보면 멈춤) · j 분기 시험(옆에 선이 보이면 그쪽으로) · , . 회전 전 전진 시간
 *                 v 주행 기록 켜기/끄기 · p 계획 보기 · x 멈춤
 */
#if defined(ESP32)
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#else
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
#endif
#if defined(ESP32)
#include <Preferences.h>
#include <ArduinoOTA.h>        // 무선 업로드
#include <ESPmDNS.h>   // 배운 모터 보정값을 전원이 꺼져도 기억
#elif defined(ESP8266)
#include <EEPROM.h>
#endif

#if __has_include("config.h")
#include "config.h"
#else
#include "config.example.h"
#warning "config.h 가 없어 config.example.h 로 컴파일합니다. 복사해서 값을 채우세요."
#endif
// 예전 config.h 에는 EN 핀 설정이 없음 → ENA/ENB 점퍼를 꽂은 방식으로
#ifndef PIN_LEFT_EN
#define PIN_LEFT_EN  -1
#endif
#ifndef PIN_RIGHT_EN
#define PIN_RIGHT_EN -1
#endif
// 예전 config.h 에 없는 설정의 기본값
#ifndef PIN_SONAR_TRIG
#define PIN_SONAR_TRIG -1
#define PIN_SONAR_ECHO -1
#endif
#ifndef MIN_PWM
#define MIN_PWM 0
#endif
#ifndef PIN_FRONT_LEFT
#error "config.h 가 예전 센서 배치(가운데 센서) 기준이에요. 새 config.example.h 를 복사해 WiFi·로봇 키만 옮겨 넣으세요."
#endif
#ifndef STEER_MIN
#define STEER_MIN (PWM_MAX * 45 / 255)
#endif
#ifndef STEER_MAX
#define STEER_MAX (PWM_MAX * 230 / 255)
#endif
#ifndef STEER_RAMP_MS
#define STEER_RAMP_MS 300
#endif
#ifndef JUNCTION_COOLDOWN_MS
#define JUNCTION_COOLDOWN_MS 450
#endif
#ifndef TURN_MIN_MS
#define TURN_MIN_MS 150
#endif
#ifndef MOTOR_TRIM
#define MOTOR_TRIM 0.0
#endif
#ifndef TRIM_LEARN
#define TRIM_LEARN 0.03
#endif
#ifndef TRIM_MAX
#define TRIM_MAX 0.30
#endif
#ifndef SPEED_DUTY
#define SPEED_DUTY 100
#endif
#ifndef PULSE_MS
#define PULSE_MS 150
#endif
#ifndef COUNTER_RATIO
#define COUNTER_RATIO 0.5
#endif
#ifndef COUNTER_MAX_MS
#define COUNTER_MAX_MS 150
#endif
#ifndef BRANCH_PAIR_MS
#define BRANCH_PAIR_MS 1500
#endif
#ifndef RECOVER_CONFIRM_MS
#define RECOVER_CONFIRM_MS 50
#endif
#ifndef RECOVER_PAIR_MS
#define RECOVER_PAIR_MS 500
#endif
#ifndef RECOVER_MAX_MS
#define RECOVER_MAX_MS 1500
#endif
#ifndef FLICKER_MS
#define FLICKER_MS 1000
#endif
#ifndef BACK_PWM
#define BACK_PWM (PWM_MAX * 100 / 255)
#endif
#ifndef BACK_EXTRA_MS
#define BACK_EXTRA_MS 150
#endif
#ifndef BACK_TIMEOUT_MS
#define BACK_TIMEOUT_MS 6000
#endif
#ifndef UTURN_IGNORE_MS
#define UTURN_IGNORE_MS 900
#endif
#ifndef UTURN_BACK_MS
#define UTURN_BACK_MS 300
#endif
#ifndef DECIDE_MS
#define DECIDE_MS 200
#endif
#ifndef CROSS_LOOKBACK_MS
#define CROSS_LOOKBACK_MS 800
#endif
#ifndef SPIN_DUTY
#define SPIN_DUTY 100
#endif
#ifndef SPIN_KICK_PWM
#define SPIN_KICK_PWM (PWM_MAX * 170 / 255)
#endif
#ifndef SPIN_KICK_MS
#define SPIN_KICK_MS 150
#endif
#ifndef SPIN_BRAKE_MS
#define SPIN_BRAKE_MS 50
#endif
#ifndef TURN_MODE
#define TURN_MODE 0
#endif
#ifndef UTURN_PWM
#define UTURN_PWM (PWM_MAX * 150 / 255)
#endif
#ifndef UTURN_DIR
#define UTURN_DIR 'L'
#endif
#ifndef ARC_SETTLE_MS
#define ARC_SETTLE_MS 300
#endif
#ifndef TURN_PAUSE_MS
#define TURN_PAUSE_MS 1000
#endif
#ifndef ARC_PWM
#define ARC_PWM (PWM_MAX * 120 / 255)
#endif
#ifndef ARC_INNER_PWM
#define ARC_INNER_PWM 0
#endif
#ifndef ARC_TIMEOUT_MS
#define ARC_TIMEOUT_MS 5000
#endif
#ifndef RECOVER_ENABLE
#define RECOVER_ENABLE 0
#endif
#ifndef SPIN_SETTLE_MS
#define SPIN_SETTLE_MS 600
#endif
#ifndef PWM_FREQ
#define PWM_FREQ 1000
#endif
#ifndef LIFT_MS
#define LIFT_MS 500
#endif
#ifndef TRACE_MS
#define TRACE_MS 60000
#endif
#ifndef TRACE_LOST_MS
#define TRACE_LOST_MS 1500
#endif
#ifndef TEST_GIVEUP_MS
#define TEST_GIVEUP_MS 30000
#endif
#ifndef OBSTACLE_STOP_CM
#define OBSTACLE_STOP_CM 20
#define OBSTACLE_CLEAR_CM 30
#endif
#ifndef TEST_ROUTE
#define TEST_ROUTE "RURLE"
#endif


// 뒤 센서 깜빡임 거르기 상태 (steadyRead)
struct Flicker { bool last; unsigned long t[4]; int i; bool noisy; };
Flicker flkL = {false, {0, 0, 0, 0}, 0, false}, flkR = {false, {0, 0, 0, 0}, 0, false};

// 멈춤 요청: 회전·유턴·뒤로 가기처럼 오래 걸리는 동작 중에도 x(또는 무선 연결 끊김)를 받으면 바로 멈춤
volatile bool abortMotion = false;
bool telnetWasConnected = false;

// ───────── 무선 시리얼 · 무선 업로드 ─────────
// 시리얼 출력은 USB 와 WiFi(TCP 2323, run 이 peekok-robot.local 로 연결) 양쪽으로, 입력은 둘 중 들어온 쪽에서.
// 무선 업로드(ArduinoOTA): 호스트 이름 peekok-robot, 비밀번호 OTA_PASS(없으면 ROBOT_KEY).
#ifndef OTA_PASS
#define OTA_PASS ROBOT_KEY
#endif
#if defined(ESP32)
WiFiServer telnetServer(2323);
WiFiClient telnet;
bool wirelessStarted = false;
class DualOut : public Print {
 public:
  size_t write(uint8_t c) override { Serial.write(c); if (telnet && telnet.connected()) telnet.write(c); return 1; }
  size_t write(const uint8_t* b, size_t n) override { Serial.write(b, n); if (telnet && telnet.connected()) telnet.write(b, n); return n; }
};
DualOut Out;
struct Abort {
  // 오래 걸리는 동작의 반복 조건에서 부름: x 를 받거나 무선 연결이 끊기면 true
  static bool poll() {
    if (abortMotion) return true;
    if (telnetWasConnected && !(telnet && telnet.connected())) { abortMotion = true; Serial.println("[무선] 연결 끊김 → 멈춤"); return true; }
    while (telnet && telnet.connected() && telnet.available()) { int c = telnet.read(); if (c == 'x' || c == 'X') { abortMotion = true; break; } }
    while (Serial.available()) { int c = Serial.read(); if (c == 'x' || c == 'X') { abortMotion = true; break; } }
    if (abortMotion) Serial.println("[멈춤] x 받음 — 하던 동작 멈춤");
    return abortMotion;
  }
};
// 입력: 함수 대신 구조체 안에 둠 (Arduino 가 만드는 자동 선언이 Node 등 정의보다 앞서지 않게)
struct In {
  static int available() { if (telnet && telnet.connected() && telnet.available()) return telnet.available(); return Serial.available(); }
  static int read() { if (telnet && telnet.connected() && telnet.available()) return telnet.read(); return Serial.read(); }
};
#else
#define Out Serial
struct Abort { static bool poll() { return abortMotion; } };
struct In {
  static int available() { return Serial.available(); }
  static int read() { return Serial.read(); }
};
#endif

// ───────── 시리얼로 바꾸는 설정 (P이름=값, 보드에 기억) ─────────
// config.h 값은 처음 값. 아래 이름들은 변수로 바꿔 업로드 없이 시리얼에서 맞춘다.
int P_STEER_MIN = STEER_MIN;
int P_STEER_MAX = STEER_MAX;
int P_STEER_RAMP_MS = STEER_RAMP_MS;
int P_MIN_PWM = MIN_PWM;
int P_TURN_PWM = TURN_PWM;
int P_ARC_PWM = ARC_PWM;
int P_ARC_INNER_PWM = ARC_INNER_PWM;
int P_ARC_SETTLE_MS = ARC_SETTLE_MS;
int P_ARC_TIMEOUT_MS = ARC_TIMEOUT_MS;
int P_TURN_PAUSE_MS = TURN_PAUSE_MS;
int P_JUNCTION_MS = JUNCTION_MS;
int P_BRANCH_PAIR_MS = BRANCH_PAIR_MS;
int P_JUNCTION_COOLDOWN_MS = JUNCTION_COOLDOWN_MS;
int P_BACK_PWM = BACK_PWM;
int P_BACK_EXTRA_MS = BACK_EXTRA_MS;
int P_LIFT_MS = LIFT_MS;
int P_FLICKER_MS = FLICKER_MS;
int P_TEST_GIVEUP_MS = TEST_GIVEUP_MS;
int P_PULSE_MS = PULSE_MS;
int P_UTURN_PWM = UTURN_PWM;
int P_TURN_MODE = TURN_MODE;
int P_SPIN_DUTY = SPIN_DUTY;
int P_DECIDE_MS = DECIDE_MS;
int P_CROSS_LOOKBACK_MS = CROSS_LOOKBACK_MS;
int P_SPIN_KICK_PWM = SPIN_KICK_PWM;
int P_SPIN_KICK_MS = SPIN_KICK_MS;
int P_SPIN_BRAKE_MS = SPIN_BRAKE_MS;
#undef STEER_MIN
#define STEER_MIN P_STEER_MIN
#undef STEER_MAX
#define STEER_MAX P_STEER_MAX
#undef STEER_RAMP_MS
#define STEER_RAMP_MS P_STEER_RAMP_MS
#undef MIN_PWM
#define MIN_PWM P_MIN_PWM
#undef TURN_PWM
#define TURN_PWM P_TURN_PWM
#undef ARC_PWM
#define ARC_PWM P_ARC_PWM
#undef ARC_INNER_PWM
#define ARC_INNER_PWM P_ARC_INNER_PWM
#undef ARC_SETTLE_MS
#define ARC_SETTLE_MS P_ARC_SETTLE_MS
#undef ARC_TIMEOUT_MS
#define ARC_TIMEOUT_MS P_ARC_TIMEOUT_MS
#undef TURN_PAUSE_MS
#define TURN_PAUSE_MS P_TURN_PAUSE_MS
#undef JUNCTION_MS
#define JUNCTION_MS P_JUNCTION_MS
#undef BRANCH_PAIR_MS
#define BRANCH_PAIR_MS P_BRANCH_PAIR_MS
#undef JUNCTION_COOLDOWN_MS
#define JUNCTION_COOLDOWN_MS P_JUNCTION_COOLDOWN_MS
#undef BACK_PWM
#define BACK_PWM P_BACK_PWM
#undef BACK_EXTRA_MS
#define BACK_EXTRA_MS P_BACK_EXTRA_MS
#undef LIFT_MS
#define LIFT_MS P_LIFT_MS
#undef FLICKER_MS
#define FLICKER_MS P_FLICKER_MS
#undef TEST_GIVEUP_MS
#define TEST_GIVEUP_MS P_TEST_GIVEUP_MS
#undef PULSE_MS
#define PULSE_MS P_PULSE_MS
#undef UTURN_PWM
#define UTURN_PWM P_UTURN_PWM
#undef TURN_MODE
#define TURN_MODE P_TURN_MODE
#undef SPIN_DUTY
#define SPIN_DUTY P_SPIN_DUTY
#undef DECIDE_MS
#define DECIDE_MS P_DECIDE_MS
#undef CROSS_LOOKBACK_MS
#define CROSS_LOOKBACK_MS P_CROSS_LOOKBACK_MS
#undef SPIN_KICK_PWM
#define SPIN_KICK_PWM P_SPIN_KICK_PWM
#undef SPIN_KICK_MS
#define SPIN_KICK_MS P_SPIN_KICK_MS
#undef SPIN_BRAKE_MS
#define SPIN_BRAKE_MS P_SPIN_BRAKE_MS

void paramCommand(const char* line);

// ───────── 주행 계획 ─────────
const int MAX_NODES = 64;
struct Node {
  char key[12];      // '1:b2', 'START', 'END'
  char action;       // s 출발 · S 직진 · L 좌 · R 우 · U 유턴 · E 엘리베이터 · X 엘리베이터에서 내림 · T 정지
  char heading;      // 이 노드를 떠날 때 방향 N E S W (없으면 '-')
  float nextM;       // 다음 노드까지 거리(m)
  uint8_t toFloor;   // 엘리베이터로 갈 층
};
Node plan[MAX_NODES];
int planLen = 0;
String planRev = "0";
String doneRev = "";          // 이미 끝까지 달린 계획
String serverMode = "idle";
String serverPassed = "-";

// ───────── 주행 상태 ─────────
enum State { ST_IDLE, ST_FOLLOW, ST_ELEVATOR, ST_ERROR, ST_TEST, ST_TRACE };
State state = ST_IDLE;
int legFrom = 0;              // 지금 달리는 구간: plan[legFrom] → plan[legFrom + 1]
char heading = HOME_HEADING;  // 지금 바라보는 도면 방향
unsigned long legStart = 0;   // 구간 시작 시각
unsigned long legExpected = 0;// 구간 예상 시간(ms)
unsigned long junctionSince = 0;
unsigned long junctionIgnoreMove = 0;   // 회전·통과 직후 좌우 센서 무시 (움직인 시간 moveMs 기준)
unsigned long lineSeenAt = 0; // 앞 센서가 마지막으로 검정을 본 시각
int followSide = 0;           // 앞 센서: 0 둘 다 바닥 · -1 왼쪽만 검정 · 1 오른쪽만 검정 · 2 둘 다 검정
unsigned long followSince = 0;// 그 상태가 시작된 시각
unsigned long testLastEvent = 0;
unsigned long lastPoll = 0;
bool verbose = false;         // 'v': 주행 중 센서·바퀴 기록
unsigned long lastLog = 0;
int lastLeftPwm = 0, lastRightPwm = 0;   // 보정 전 세기 (기록용)
// 좌우 모터 힘 보정: + 면 왼쪽 바퀴를 (1+trim) 배·오른쪽을 (1-trim) 배 → 오른쪽으로 쏠리면 줄이고, 왼쪽으로 쏠리면 늘림
float motorTrim = MOTOR_TRIM;
float savedTrim = MOTOR_TRIM;
float trimBoost = 1.0;        // 'b' 보정 주행 중에는 더 빨리 배움
int speedPwm = SPEED_PWM;     // 선 따라갈 때 기본 세기 — 시리얼 + / - 로 바꾸고 보드에 기억
unsigned long allBlackSince = 0;
int recoverDir = 0;           // 선 되찾기 중이면 꺾는 쪽 (-1 왼쪽 · 1 오른쪽)
unsigned long rearLSince = 0, rearRSince = 0;   // 뒤 센서가 선을 보기 시작한 때 (선 되찾기 잡음 거르기)
unsigned long recoverStartMove = 0;
int counterSide = 0;          // 바로잡기가 끝난 직후 반대로 살짝 꺾는 쪽 (흔들림 줄이기)
unsigned long counterUntil = 0;
int speedDuty = SPEED_DUTY;   // 느리게 달리기: 한 주기(PULSE_MS) 중 바퀴를 돌리는 비율(%) — 시리얼 + / - 로 바꾸고 보드에 기억
unsigned long moveMs = 0;     // 바퀴를 실제로 돌린 시간 합 (회전 전 전진·쿨다운을 속도와 상관없이 같은 거리로)
unsigned long moveLastAt = 0;
int turnForwardMs = TURN_FORWARD_MS;
int uturnIgnoreMs = UTURN_IGNORE_MS;   // 유턴: 처음 이만큼 선을 무시하고 돎 — 시리얼 < > 로 ±100ms, 보드에 기억
int uturnBackMs = UTURN_BACK_MS;       // 유턴 전에 뒤로 가는 시간 — 시리얼 [ ] 아님, { } 로 ±50ms   // 교차로 감지 뒤 더 가는 시간 — 시리얼 , . 로 바꾸고 보드에 기억
bool junctionL = false, junctionR = false;   // 이번 교차로에서 선을 본 옆 센서
unsigned long decideStart = 0;   // 분기/T자 결정 대기 시작 (moveMs+1, 0 = 대기 아님)
unsigned long frontBothMove = 0; // 앞 센서 둘이 동시에 검정이었던 때 (moveMs+1)
bool junctionArmed = true;       // 회전 뒤에는 옆 센서가 방금 지난 선(제자리 회전이라 옆 센서 밑에 남음)을 벗어나 바닥을 본 뒤에야 다시 교차로를 셈
unsigned long sideClearSince = 0;
unsigned long frontLSeenMove = 0, frontRSeenMove = 0;   // 앞 왼쪽·오른쪽이 마지막으로 검정을 본 때(움직인 시간) — 분기는 앞 → 뒤 순서로 지나감
unsigned long lastFollowAt = 0;
// 장애물
bool blocked = false;
unsigned long blockedSince = 0;
int nearCount = 0, farCount = 0;
unsigned long lastSonar = 0;
int lastCm = -1;
// 코스 시험
int routeIdx = 0;
char routeBuf[32] = TEST_ROUTE;
bool autoAfterU = false;      // 자동 모드: 방금 유턴했으면 다음 T자는 본선
char autoLastTurn = 'R';      // 자동 모드: 마지막으로 들어간 분기 쪽   // 코스 시험 순서 — 시리얼 K<글자들> 로 바꾸고 보드에 기억

// ───────── 네트워크 ─────────
#if defined(ESP32)
WiFiClientSecure tls;
#else
BearSSL::WiFiClientSecure tls;
BearSSL::Session tlsSession;
#endif
HTTPClient http;

// ───────── 하드웨어 ─────────
bool readLine(int pin) { return (digitalRead(pin) == HIGH) == (LINE_IS_HIGH == 1); }
bool readAnalogLine(int pin, int thresh) { return (analogRead(pin) > thresh) == (LINE_IS_HIGH == 1); }
// 핀 번호가 -1 이면 그 센서는 없음(항상 바닥)
bool sLeft() { return PIN_SENSOR_LEFT < 0 ? false : SENSOR_LEFT_ANALOG ? readAnalogLine(PIN_SENSOR_LEFT, LEFT_ANALOG_THRESHOLD) : readLine(PIN_SENSOR_LEFT); }    // 차체 왼쪽(교차로)
bool sRight() { return PIN_SENSOR_RIGHT < 0 ? false : SENSOR_RIGHT_ANALOG ? readAnalogLine(PIN_SENSOR_RIGHT, RIGHT_ANALOG_THRESHOLD) : readLine(PIN_SENSOR_RIGHT); } // 차체 오른쪽(교차로)
bool sFrontL() { return readLine(PIN_FRONT_LEFT); }    // 앞 왼쪽(선 따라가기)
bool sFrontR() { return readLine(PIN_FRONT_RIGHT); }   // 앞 오른쪽(선 따라가기)

// 모터 한 쪽: v 는 -PWM_MAX(뒤로) ~ PWM_MAX(앞으로)
// pinEn >= 0 : L298N ENA/ENB 를 PWM 핀에 연결(점퍼 뺌) → IN 두 핀은 방향만, 세기는 EN 핀으로
// pinEn <  0 : ENA/ENB 점퍼를 꽂은 채 → IN 두 핀에 PWM (L9110S·MX1508 처럼 입력 4개짜리 드라이버도 이 방식)
// 바퀴가 실제로 돌기 시작하는 세기(MIN_PWM)보다 약한 값: 아주 작으면 0, 아니면 MIN_PWM 으로 올림
int deadzone(int v) {
  int a = v < 0 ? -v : v;
  if (a == 0 || a >= MIN_PWM) return v;
  if (a < MIN_PWM / 3) return 0;
  return v < 0 ? -MIN_PWM : MIN_PWM;
}
void motor(int pinA, int pinB, int pinEn, int v, bool invert) {
  v = deadzone(constrain(v, -PWM_MAX, PWM_MAX));
  if (invert) v = -v;
  if (pinEn >= 0) {
    digitalWrite(pinA, v > 0 ? HIGH : LOW);
    digitalWrite(pinB, v < 0 ? HIGH : LOW);
    analogWrite(pinEn, v >= 0 ? v : -v);
  } else if (v >= 0) { analogWrite(pinA, v); analogWrite(pinB, 0); }
  else { analogWrite(pinA, 0); analogWrite(pinB, -v); }
}
int scalePwm(int v, float k) { float x = v * k; return (int)(x >= 0 ? x + 0.5f : x - 0.5f); }
void drive(int left, int right) {
  lastLeftPwm = left; lastRightPwm = right;
  motor(PIN_LEFT_A, PIN_LEFT_B, PIN_LEFT_EN, scalePwm(left, 1.0f + motorTrim), LEFT_INVERT);
  motor(PIN_RIGHT_A, PIN_RIGHT_B, PIN_RIGHT_EN, scalePwm(right, 1.0f - motorTrim), RIGHT_INVERT);
}

// ───────── 느리게 달리기 (끊어 가기) ─────────
// 바퀴가 도는 최소 세기보다 약하게는 못 달리므로, 세기는 그대로 두고 PULSE_MS 주기 중 speedDuty% 동안만 돌리고 나머지는 멈춘다.
// 멈춘 동안에도 센서는 계속 읽으니, 실제 속도가 느려진 만큼 센서가 선을 볼 시간이 늘어난다.
bool pulseOn() {
  if (speedDuty >= 100) return true;
  return millis() % PULSE_MS < (unsigned long)PULSE_MS * speedDuty / 100;
}
void moveTick(bool moving) {
  unsigned long now = millis();
  unsigned long dt = moveLastAt ? now - moveLastAt : 0;
  if (dt > 50) dt = 50;            // 오래 쉬었으면(통신 등) 조금만 셈
  if (moving) moveMs += dt;
  moveLastAt = now;
}
// 주행용: 끊어 가기를 적용해 바퀴를 돌림 (기록에는 정한 세기를 남김)
void driveP(int left, int right) {
  bool on = pulseOn();
  moveTick(on && (left || right));
  if (on) drive(left, right);
  else { drive(0, 0); lastLeftPwm = left; lastRightPwm = right; }
}

// ───────── 좌우 모터 힘 보정값 저장 ─────────
void setTrim(float t) { motorTrim = t > TRIM_MAX ? TRIM_MAX : t < -TRIM_MAX ? -TRIM_MAX : t; }
void trimLoad() {
#if defined(ESP32)
  Preferences p;
  if (p.begin("peekok", true)) {
    if (p.isKey("trim")) setTrim(p.getFloat("trim", MOTOR_TRIM));
    if (p.isKey("speed")) speedPwm = constrain((int)p.getInt("speed", SPEED_PWM), 0, PWM_MAX);
    if (p.isKey("tfwd")) turnForwardMs = constrain((int)p.getInt("tfwd", TURN_FORWARD_MS), 0, 1500);
    if (p.isKey("uign")) uturnIgnoreMs = constrain((int)p.getInt("uign", UTURN_IGNORE_MS), 0, 5000);
    if (p.isKey("uback")) uturnBackMs = constrain((int)p.getInt("uback", UTURN_BACK_MS), 0, 3000);
    if (p.isKey("duty")) speedDuty = constrain((int)p.getInt("duty", SPEED_DUTY), 10, 100);
    if (p.isKey("route")) { String r = p.getString("route", TEST_ROUTE); if (r.length() && r.length() < sizeof(routeBuf)) strcpy(routeBuf, r.c_str()); }
    p.end();
  }
#elif defined(ESP8266)
  EEPROM.begin(16);
  if (EEPROM.read(0) == 0xA5) { float t; EEPROM.get(1, t); if (t == t) setTrim(t); }
  if (EEPROM.read(5) == 0xA6) { int v; EEPROM.get(6, v); speedPwm = constrain(v, 0, PWM_MAX); }
#endif
  savedTrim = motorTrim;
}
// 바뀐 만큼이 작으면 저장하지 않음 (저장공간 수명). force 면 무조건.
void trimSave(bool force) {
  float d = motorTrim - savedTrim;
  if (!force && d < 0.01f && d > -0.01f) return;
#if defined(ESP32)
  Preferences p;
  if (p.begin("peekok", false)) { p.putFloat("trim", motorTrim); p.end(); }
#elif defined(ESP8266)
  EEPROM.write(0, 0xA5); EEPROM.put(1, motorTrim); EEPROM.commit();
#endif
  savedTrim = motorTrim;
  Out.printf("[모터 보정] %+.3f 저장 (왼쪽 x%.2f · 오른쪽 x%.2f)\n", motorTrim, 1 + motorTrim, 1 - motorTrim);
}
void routeSave() {
#if defined(ESP32)
  Preferences p;
  if (p.begin("peekok", false)) { p.putString("route", routeBuf); p.end(); }
#endif
}
void speedSave() {
#if defined(ESP32)
  Preferences p;
  if (p.begin("peekok", false)) { p.putInt("speed", speedPwm); p.putInt("tfwd", turnForwardMs); p.putInt("duty", speedDuty); p.putInt("uign", uturnIgnoreMs); p.putInt("uback", uturnBackMs); p.end(); }
#elif defined(ESP8266)
  EEPROM.write(5, 0xA6); EEPROM.put(6, speedPwm); EEPROM.commit();
#endif
  Out.printf("[속도] 끊어 가기 %d%% (세기 %d) · 회전 전 전진 %dms · 유턴 무시 %dms · 유턴 전 후진 %dms 저장\n", speedDuty, speedPwm, turnForwardMs, uturnIgnoreMs, uturnBackMs);
}
void stopMotors() { drive(0, 0); }
void led(bool on) { digitalWrite(PIN_LED, on ? LED_ON : LED_OFF); }
bool buttonPressed() { return digitalRead(PIN_BUTTON) == LOW; }

// ───────── 초음파 (장애물) ─────────
// 앞 거리(cm). 초음파를 안 쓰거나 메아리가 없으면(멀거나 아무것도 없음) -1
int sonarCm() {
  if (PIN_SONAR_TRIG < 0) return -1;
  digitalWrite(PIN_SONAR_TRIG, LOW); delayMicroseconds(2);
  digitalWrite(PIN_SONAR_TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(PIN_SONAR_TRIG, LOW);
  // OBSTACLE_CLEAR_CM 보다 조금 먼 곳까지만 기다림 (주행을 오래 막지 않게, 약 4ms)
  unsigned long us = pulseIn(PIN_SONAR_ECHO, HIGH, (OBSTACLE_CLEAR_CM + 20) * 58UL + 1000);
  return us ? (int)(us / 58) : -1;
}
// 거리 하나로 판단: 가까움 2번 연속 → 막힘, 멂·없음 4번 연속 → 풀림
bool obstacleUpdate(int cm) {
  bool nearNow = cm >= 0 && cm < OBSTACLE_STOP_CM;
  bool farNow = cm < 0 || cm > OBSTACLE_CLEAR_CM;
  nearCount = nearNow ? nearCount + 1 : 0;
  farCount = farNow ? farCount + 1 : 0;
  if (!blocked && nearCount >= 2) blocked = true;
  else if (blocked && farCount >= 4) blocked = false;
  return blocked;
}
// 달리는 중에 부름: 막혀 있으면 멈추고 true. 멈춘 시간만큼 구간 시계를 늦춘다(시간으로 재는 마지막 구간·교차로 문).
bool obstacleHold() {
  if (PIN_SONAR_TRIG < 0) return false;
  unsigned long now = millis();
  if (now - lastSonar >= 60) {          // HC-SR04 는 60ms 에 한 번
    lastSonar = now;
    lastCm = sonarCm();
    bool was = blocked;
    obstacleUpdate(lastCm);
    if (blocked && !was) { blockedSince = now; Out.printf("[장애물] 앞 %dcm — 멈춤\n", lastCm); }
    if (!blocked && was) {
      unsigned long d = now - blockedSince;
      legStart += d; lineSeenAt += d; followSince = now; testLastEvent += d; junctionSince = 0;
      Out.printf("[장애물] 치워짐 — %lu.%lu초 만에 다시 출발\n", d / 1000, (d % 1000) / 100);
    }
  }
  if (blocked) stopMotors();
  return blocked;
}

// ───────── 선 따라가기 · 교차로 감지 ─────────
// 앞 두 센서 사이에 선을 두고 달린다. 한 번 부를 때마다 바퀴 세기를 정함.
int rearLostDir();
void lineFollow(int base, bool sideRecover = false) {
  unsigned long now = millis();
  unsigned long dt = (lastFollowAt && now - lastFollowAt < 100) ? now - lastFollowAt : 0;   // 오래 쉬었으면 배우지 않음
  lastFollowAt = now;
  bool fl = sFrontL(), fr = sFrontR();
  int side = (fl && fr) ? 2 : fl ? -1 : fr ? 1 : 0;
  if (side != followSide) {
    // 한쪽 바로잡기가 끝나 선이 가운데로 돌아옴 → 몸은 아직 비스듬하니, 바로잡은 시간에 비례해 반대로 살짝 꺾어 똑바로 세움
    if ((followSide == -1 || followSide == 1) && side == 0) {
      unsigned long hold = (unsigned long)((now - followSince) * COUNTER_RATIO);
      counterSide = -followSide;
      counterUntil = now + (hold > COUNTER_MAX_MS ? COUNTER_MAX_MS : hold);
    } else {
      counterUntil = 0;
    }
    followSide = side; followSince = now;
  }
  if (fl || fr) lineSeenAt = now;
  if (fl) frontLSeenMove = moveMs + 1;
  if (fr) frontRSeenMove = moveMs + 1;
  // 뒤 센서가 선을 계속 본 시간 (잡음 거르기)
  bool rl = sLeft(), rr = sRight();
  if (rl) { if (!rearLSince) rearLSince = now; } else rearLSince = 0;
  if (rr) { if (!rearRSince) rearRSince = now; } else rearRSince = 0;
  // 선 되찾기 (sideRecover: 선 시험·속도 재기·모터 맞추기에서만): 앞 두 센서가 다 놓쳤는데 뒤 센서 한쪽이 선을 보면
  // 그쪽으로 크게 꺾기 시작하고, 뒤 센서가 선을 벗어나도 계속 꺾다가 앞 센서가 선을 다시 잡는 순간 평소 따라가기로 돌아감.
  // 뒤 센서는 방향만 알려 줄 뿐, 선을 따라가는 건 언제나 앞 센서.
  if (sideRecover && RECOVER_ENABLE) {
    if (recoverDir) {
      if (fl || fr) { Out.println("[선 되찾기] 앞 센서가 선을 다시 잡음"); recoverDir = 0; }
      else if (moveMs - recoverStartMove > RECOVER_MAX_MS) { Out.println("[선 되찾기] 못 찾음 — 그만둠"); recoverDir = 0; }
      else { driveP(base + recoverDir * STEER_MAX, base - recoverDir * STEER_MAX); return; }
    } else if (!fl && !fr && rearLostDir() != 0) {
      recoverDir = rearLostDir();
      recoverStartMove = moveMs;
      Out.printf("[선 되찾기] 앞 센서가 놓침 — 뒤 %s 센서 쪽으로\n", recoverDir < 0 ? "왼쪽" : "오른쪽");
      driveP(base + recoverDir * STEER_MAX, base - recoverDir * STEER_MAX);
      return;
    }
  }
  if (side == 0 && (long)(now - counterUntil) < 0) { driveP(base + counterSide * STEER_MIN, base - counterSide * STEER_MIN); return; }
  if (side == 0 || side == 2) { driveP(base, base); return; }   // 선이 사이에 있음 · 앞에 가로선 → 곧장
  // 한쪽이 검정 = 선이 그쪽으로 치우침 → 그쪽으로 꺾기. 오래 이어질수록 세게(STEER_RAMP_MS 에 STEER_MAX = 제자리 회전에 가깝게)
  unsigned long t = now - followSince;
  // 모터 힘 배우기: 짧은 바로잡기만 (오래 이어지면 곡선·회전이라 제외).
  // 앞 왼쪽이 켜짐(side -1) = 로봇이 오른쪽으로 쏠림 = 왼쪽이 셈 → trim 을 줄임. 오른쪽은 반대.
  if (t < STEER_RAMP_MS && dt) setTrim(motorTrim + side * (float)TRIM_LEARN * trimBoost * dt / 1000.0f);
  if (t > STEER_RAMP_MS) t = STEER_RAMP_MS;
  int steer = STEER_MIN + (int)((long)(STEER_MAX - STEER_MIN) * (long)t / STEER_RAMP_MS);
  int l = base + side * steer, r = base - side * steer;   // side -1: 왼쪽 바퀴를 느리게 = 왼쪽으로
  // 제자리 회전은 모터가 잘 못 하니 안쪽 바퀴는 뒤로 돌리지 않음 (멈춤까지만) → 언제나 앞으로 가면서 꺾음
  if (l < 0) l = 0;
  if (r < 0) r = 0;
  driveP(l, r);
}
// 센서 4개가 모두 LIFT_MS 넘게 검정 = 로봇이 들렸거나(바닥이 멀어 빛이 안 돌아옴) 넓은 검정 바닥 → 멈춰야 함
bool liftedNow() {
  if (!(sFrontL() && sFrontR() && (PIN_SENSOR_LEFT < 0 || sLeft()) && sRight())) { allBlackSince = 0; return false; }
  if (!allBlackSince) allBlackSince = millis();
  return millis() - allBlackSince >= (junctionArmed ? LIFT_MS : LIFT_MS * 3UL);   // 회전 직후엔 교차점 위라 더 기다림
}
// 선을 진짜 놓쳤는지: 같은 쪽 앞 센서가 방금(RECOVER_PAIR_MS 안) 선을 보고 바로잡던 중이었고,
// 그 쪽 뒤 센서가 RECOVER_CONFIRM_MS 넘게 계속 선을 봄 → 선이 앞 센서 바깥으로 빠져나간 것. 그 쪽(-1/1), 아니면 0
int rearLostDir() {
  unsigned long now = millis();
  bool l = rearLSince && now - rearLSince >= RECOVER_CONFIRM_MS && frontLSeenMove && moveMs + 1 - frontLSeenMove <= RECOVER_PAIR_MS;
  bool r = rearRSince && now - rearRSince >= RECOVER_CONFIRM_MS && frontRSeenMove && moveMs + 1 - frontRSeenMove <= RECOVER_PAIR_MS;
  if (l == r) return 0;
  return l ? -1 : 1;
}
// 새로 선을 잡은 뒤(회전·출발) 따라가기 상태를 처음부터
void followReset() { followSide = -9; followSince = millis(); lineSeenAt = millis(); lastFollowAt = 0; allBlackSince = 0; counterUntil = 0; recoverDir = 0; rearLSince = rearRSince = 0; frontLSeenMove = frontRSeenMove = 0; }
// 좌우 센서가 JUNCTION_MS 이상 선을 보면 교차로 (allowed 가 false 거나 회전 직후면 무시)
// 깜빡임 거르기: 값이 FLICKER_MS 안에 4번 넘게 바뀌면(떠 있는 핀·잡음) 그 센서는 바닥으로 봄.
// 진짜 선은 한 번 지나가며 많아야 두 번 바뀜.
bool steadyRead(Flicker& f, bool v, const char* name) {
  unsigned long now = millis();
  if (v != f.last) { f.last = v; f.t[f.i] = now ? now : 1; f.i = (f.i + 1) % 4; }
  unsigned long oldest = f.t[f.i];   // 4번 전에 바뀐 때
  bool noisy = oldest && now - oldest < FLICKER_MS;
  if (noisy != f.noisy) { f.noisy = noisy; Out.printf("[깜빡임] %s 센서 %s\n", name, noisy ? "값이 너무 자주 바뀜 → 무시" : "안정됨 → 다시 씀"); }
  return noisy ? false : v;
}
bool rearL() { return steadyRead(flkL, sLeft(), "뒤 왼쪽"); }
bool rearR() { return steadyRead(flkR, sRight(), "뒤 오른쪽"); }
bool junctionSeen(bool allowed) {
  unsigned long now = millis();
  if (sFrontL()) frontLSeenMove = moveMs + 1;
  if (sFrontR()) frontRSeenMove = moveMs + 1;
  bool rl = rearL(), rr = rearR();
  // 진짜 분기는 앞 센서가 먼저 지나가고 뒤 센서가 닿음 → 뒤 센서만 깜빡이는 잡음은 무시
  // BRANCH_PAIR_MS 가 0 이면 뒤 센서만으로 분기 판단 (앞 센서는 직진에만)
  bool l = rl && (BRANCH_PAIR_MS == 0 || (frontLSeenMove && moveMs + 1 - frontLSeenMove <= (unsigned long)BRANCH_PAIR_MS));
  bool r = rr && (BRANCH_PAIR_MS == 0 || (frontRSeenMove && moveMs + 1 - frontRSeenMove <= (unsigned long)BRANCH_PAIR_MS));
  if (!junctionArmed) {               // 옆 센서 둘 다 바닥을 (움직이며) 0.1초 보면 다시 셀 준비
    if (!l && !r) { if (!sideClearSince) sideClearSince = moveMs + 1; if (moveMs + 1 - sideClearSince >= 100) junctionArmed = true; }
    else sideClearSince = 0;
    junctionSince = 0;
    return false;
  }
  // 앞 센서 두 개가 동시에 검정 = 가로로 지나가는 선(T자 가로선·본선)을 넘음 → 기억해 두었다가 T자 판단에 씀
  if (sFrontL() && sFrontR()) frontBothMove = moveMs + 1;
  if (!allowed || (long)(moveMs - junctionIgnoreMove) < 0) { junctionSince = 0; decideStart = 0; return false; }
  // ① 후보: 뒤 센서 한쪽이 JUNCTION_MS 넘게 계속 선을 봄
  if (!decideStart) {
    if (!(l || r)) { junctionSince = 0; return false; }
    if (!junctionSince) junctionSince = now;
    if (now - junctionSince < (unsigned long)JUNCTION_MS) return false;
    decideStart = moveMs + 1;
    junctionL = l; junctionR = r;
  }
  // ② 결정 대기: DECIDE_MS(바퀴 돌린 시간) 동안 반대쪽도 보는지 지켜봄
  junctionL = junctionL || l; junctionR = junctionR || r;
  if (moveMs + 1 - decideStart < (unsigned long)DECIDE_MS) return false;
  // ③ 결정: 양쪽 다 봤거나, 직전에 앞 센서 둘이 동시에 검정(가로선) → T자. 아니면 본 쪽 분기
  bool frontCross = CROSS_LOOKBACK_MS > 0 && frontBothMove && moveMs + 1 - frontBothMove <= (unsigned long)(DECIDE_MS + CROSS_LOOKBACK_MS);   // 0 = 끔 (뒤 센서 양쪽만으로 T자)
  if (frontCross && !(junctionL && junctionR)) { junctionL = junctionR = true; Out.println("[판단] 앞 센서 둘이 가로선을 지남 → T자"); }
  else Out.printf("[판단] %s\n", junctionL && junctionR ? "뒤 센서 양쪽 → T자" : junctionL ? "뒤 왼쪽만 → 왼쪽 분기" : "뒤 오른쪽만 → 오른쪽 분기");
  decideStart = 0; junctionSince = 0;
  return true;
}
void logDrive(const char* tag) {
  if (!verbose || millis() - lastLog < 100) return;
  lastLog = millis();
  Out.printf("[%s] 센서 뒤L%d 앞L%d 앞R%d 뒤R%d · 바퀴 %d %d · 보정 %+.3f · 앞 %dcm\n", tag, (int)sLeft(), (int)sFrontL(), (int)sFrontR(), (int)sRight(), lastLeftPwm, lastRightPwm, motorTrim, lastCm);
}

// ───────── 방향 계산 ─────────
int headingIndex(char h) { return h == 'N' ? 0 : h == 'E' ? 1 : h == 'S' ? 2 : h == 'W' ? 3 : -1; }
// 지금 방향 from 에서 to 로 가려면: 'S' 직진 · 'R' 우회전 · 'U' 유턴 · 'L' 좌회전
char turnFor(char from, char to) {
  int a = headingIndex(from), b = headingIndex(to);
  if (a < 0 || b < 0) return 'S';
  int d = (b - a + 4) % 4;
  return d == 0 ? 'S' : d == 1 ? 'R' : d == 2 ? 'U' : 'L';
}
char actionCode(const String& a) {
  if (a == "start") return 's';
  if (a == "straight") return 'S';
  if (a == "left") return 'L';
  if (a == "right") return 'R';
  if (a == "uturn") return 'U';
  if (a == "elevator") return 'E';
  if (a == "exit") return 'X';
  return 'T';
}

// ───────── 서버 통신 ─────────
// 응답이 200 이면 true, 본문은 out 에
bool request(bool post, const String& path, const String& body, String& out) {
  if (WiFi.status() != WL_CONNECTED) return false;
  http.setReuse(true);
  http.setTimeout(8000);
  if (!http.begin(tls, SERVER_HOST, 443, path, true)) return false;
  http.addHeader("X-Robot-Key", ROBOT_KEY);
  http.addHeader("User-Agent", "peekok-robot/1.0");
  int code;
  if (post) {
    http.addHeader("Content-Type", "application/json");
    code = http.POST(body);
  } else {
    code = http.GET();
  }
  if (code == 200) out = http.getString();
  else Out.printf("[http] %s %s → %d\n", post ? "POST" : "GET", path.c_str(), code);
  http.end();
  return code == 200;
}

// 글자 응답 해석: 모드·계획번호·지난 노드를 갱신하고, 계획이 바뀌었으면 노드 목록을 새로 읽는다
bool parseDrive(const String& s) {
  if (!s.startsWith("ok")) return false;
  String rev = planRev;
  int pos = 0, idx = -1, count = 0;
  bool readNodes = false;
  while (pos < (int)s.length()) {
    int nl = s.indexOf('\n', pos);
    if (nl < 0) nl = s.length();
    String line = s.substring(pos, nl);
    line.trim();
    pos = nl + 1;
    if (line.startsWith("mode ")) serverMode = line.substring(5);
    else if (line.startsWith("rev ")) rev = line.substring(4);
    else if (line.startsWith("passed ")) serverPassed = line.substring(7);
    else if (line.startsWith("nodes ")) {
      count = line.substring(6).toInt();
      readNodes = (rev != planRev);
      if (readNodes) { planLen = 0; idx = 0; }
    } else if (line == "end") break;
    else if (readNodes && idx >= 0 && idx < MAX_NODES && line.length()) {
      // <key> <action> <heading> <next_m> <toFloor>
      String tok[5];
      int t = 0, p = 0;
      while (t < 5 && p <= (int)line.length()) {
        int sp = line.indexOf(' ', p);
        if (sp < 0) sp = line.length();
        tok[t++] = line.substring(p, sp);
        p = sp + 1;
      }
      Node& n = plan[idx++];
      tok[0].toCharArray(n.key, sizeof(n.key));
      n.action = actionCode(tok[1]);
      n.heading = tok[2].length() ? tok[2][0] : '-';
      n.nextM = tok[3].toFloat();
      n.toFloor = (uint8_t)tok[4].toInt();
      planLen = idx;
    }
  }
  if (readNodes) {
    planRev = rev;
    Out.printf("[plan] rev %s · 노드 %d개 (예상 %d)\n", planRev.c_str(), planLen, count);
  }
  return true;
}

bool pollDrive() {
  String out;
  if (!request(false, "/api/robot/drive", "", out)) return false;
  return parseDrive(out);
}
bool report(const char* action, const String& json) {
  String out;
  bool ok = request(true, String("/api/robot/") + action + "?fmt=text", json, out);
  if (ok) parseDrive(out);
  return ok;
}
bool reportPassed(int i) {
  String next = (i + 1 < planLen) ? String(plan[i + 1].key) : String("");
  String json = String("{\"passed\":\"") + plan[i].key + "\",\"next\":\"" + next + "\",\"speed\":" + String(ROBOT_SPEED_MPS, 2) + "}";
  Out.printf("[노드] %s 지남 → %s\n", plan[i].key, next.c_str());
  return report("progress", json);
}

// ───────── 회전 (막는 동작: 끝날 때까지 기다림) ─────────
// dir: -1 왼쪽, +1 오른쪽. minMs 가 지나기 전에는 선을 무시(유턴용).
// 제자리에서 돌다가 도는 쪽 앞 센서(오른쪽으로 돌면 앞 오른쪽)가 새 선을 잡으면 멈춘다.
// 처음 minMs 동안은 선을 무시(지금 서 있는 선을 벗어나기), 그 뒤에는 바닥 → 검정으로 바뀌는 순간에 멈춤.
// 제자리 회전 한 번: dir +1 오른쪽 = 왼쪽 바퀴 앞으로 · 오른쪽 바퀴 뒤로, -1 왼쪽은 반대
void spinDrive(int dir) { driveP(dir * TURN_PWM, dir * -TURN_PWM); }
// minMs·TURN_TIMEOUT_MS 는 바퀴를 실제로 돌린 시간 기준 (끊어 가기로 느려도 같은 각도)
// 새 선을 앞 두 센서 사이에 넣고 멈춘다:
//   ① 도는 쪽 앞 센서(우회전이면 앞 오른쪽)가 새 선에 닿음 → ② 그 센서가 선을 지나감(선이 두 센서 사이로)
//   → ③ 반대쪽 앞 센서(앞 왼쪽)가 선에 닿으면 멈춤. 그 뒤 선 따라가기가 가운데로 맞춘다.
//   ③ 이 SPIN_SETTLE_MS 안에 안 오면 ② 상태(선이 사이에 있음)로 멈춤.
bool spinToLine(int dir, unsigned long minMs) {
  unsigned long m0 = moveMs, t0 = millis();
  moveLastAt = 0;
  bool sawFloor = false;
  int phase = 0;                 // 0 새 선 찾기 · 1 앞 센서가 선 위 · 2 선이 두 센서 사이
  unsigned long passedAt = 0;
  while (!Abort::poll() && moveMs - m0 < TURN_TIMEOUT_MS && millis() - t0 < TURN_TIMEOUT_MS * 12UL) {
    spinDrive(dir);
    bool lead = dir > 0 ? sFrontR() : sFrontL();
    bool trail = dir > 0 ? sFrontL() : sFrontR();
    if (moveMs - m0 >= minMs) {
      if (phase == 0) {
        if (!lead) sawFloor = true;
        else if (sawFloor) phase = 1;
      } else if (phase == 1) {
        if (!lead) { phase = 2; passedAt = moveMs; }
      } else {
        if (trail || moveMs - passedAt >= SPIN_SETTLE_MS) { stopMotors(); delay(80); return true; }
      }
    }
    yield();
  }
  stopMotors();
  return phase >= 1;             // 선에 닿기라도 했으면 성공으로 봄
}
// 앞으로 가면서 도는 회전 (제자리 회전은 모터가 잘 못 함): 우회전이면 왼쪽 바퀴만 앞으로, 오른쪽 바퀴는 ARC_INNER_PWM.
// 도는 쪽 앞 센서(우회전이면 앞 오른쪽)가 새 선에 닿고 → 이어서 반대쪽 앞 센서(앞 왼쪽)가 닿으면 직진 구간으로 보고 멈춤.
// ignoreMs: 처음 이 시간(바퀴 돌린 시간) 동안은 선을 무시하고 돈다 (유턴: T자 가로선을 지나치기)
bool arcToLine(int dir, unsigned long ignoreMs = 0) {
  unsigned long m0 = moveMs, t0 = millis();
  moveLastAt = 0;
  bool leadSeen = false;
  unsigned long passedAt = 0;
  while (!Abort::poll() && moveMs - m0 < ARC_TIMEOUT_MS + ignoreMs && millis() - t0 < (ARC_TIMEOUT_MS + ignoreMs) * 12UL) {
    driveP(dir > 0 ? ARC_PWM : ARC_INNER_PWM, dir > 0 ? ARC_INNER_PWM : ARC_PWM);
    logDrive(dir > 0 ? "우회전" : "좌회전");
    bool lead = dir > 0 ? sFrontR() : sFrontL();
    bool trail = dir > 0 ? sFrontL() : sFrontR();
    if (moveMs - m0 < ignoreMs) { yield(); continue; }
    if (!leadSeen) { if (lead) { leadSeen = true; Out.printf("[회전] 앞 %s 센서가 새 선에 닿음\n", dir > 0 ? "오른쪽" : "왼쪽"); } }
    else if (trail && passedAt) { stopMotors(); Out.printf("[회전] 앞 %s 센서도 닿음 → 직진 구간\n", dir > 0 ? "왼쪽" : "오른쪽"); delay(80); return true; }
    // 도는 쪽 앞 센서가 아직 새 선 위일 때 반대쪽이 보는 검정은 다른 선(본선) → 무시
    else if (!lead) {            // 도는 쪽 앞 센서가 선을 지나감 = 선이 두 센서 사이 → ARC_SETTLE_MS 안에 반대쪽이 안 닿으면 그대로 멈춤
      if (!passedAt) passedAt = moveMs + 1;
      if (moveMs + 1 - passedAt >= ARC_SETTLE_MS) { stopMotors(); Out.println("[회전] 선이 앞 센서 사이에 들어옴 → 직진 구간"); delay(80); return true; }
    }
    yield();
  }
  stopMotors();
  return leadSeen;               // 새 선에 닿기라도 했으면 이어서 따라가 봄
}
// 제자리 회전(분기·유턴 공용): 두 바퀴를 반대로, 끊지 않고 부드럽게.
//   처음 SPIN_KICK_MS 만 SPIN_KICK_PWM 으로 세게(멈춰 있는 바퀴 출발) → 그다음 UTURN_PWM 으로 약하게 계속 →
//   멈출 때 SPIN_BRAKE_MS 동안 반대로 살짝 돌려 관성으로 더 도는 것을 막음.
// 처음 ignoreMs 동안은 선을 무시(T자 가로선) → 도는 쪽 앞 센서가 선에 닿고 지나가면, 반대쪽 앞 센서가 닿거나 ARC_SETTLE_MS 뒤 멈춤
void spinBrake(int dir) {
  if (SPIN_BRAKE_MS <= 0) { stopMotors(); return; }
  drive(-dir * UTURN_PWM, dir * UTURN_PWM);
  delay(SPIN_BRAKE_MS);
  stopMotors();
}
bool spinUturn(int dir, unsigned long ignoreMs) {
  int savedDuty = speedDuty;
  speedDuty = SPIN_DUTY;         // 기본 100 = 끊지 않음 (끊으면 다시 출발할 때마다 헛돎)
  unsigned long m0 = moveMs, t0 = millis();
  moveLastAt = 0;
  bool leadSeen = false;
  unsigned long passedAt = 0;
  bool ok = false;
  while (!Abort::poll() && moveMs - m0 < ARC_TIMEOUT_MS + ignoreMs && millis() - t0 < (ARC_TIMEOUT_MS + ignoreMs) * 3UL) {
    // 처음과 그 뒤 1초마다 SPIN_KICK_MS 만 세게 밀어 줌 → 힘이 빠져 멈추지 않고 선을 찾을 때까지 계속 돎
    int pwm = ((millis() - t0) % 1000UL < (unsigned long)SPIN_KICK_MS) ? SPIN_KICK_PWM : UTURN_PWM;
    driveP(dir * pwm, -dir * pwm);
    logDrive("제자리");
    bool lead = dir > 0 ? sFrontR() : sFrontL();
    bool trail = dir > 0 ? sFrontL() : sFrontR();
    if (moveMs - m0 < ignoreMs) { yield(); continue; }
    // 우회전: 앞 오른쪽이 새 선에 닿고 → 지나간 뒤 → 앞 왼쪽이 닿아야만 멈춤 (중간에 멈추지 않음)
    if (!leadSeen) { if (lead) { leadSeen = true; Out.printf("[제자리] 앞 %s 센서가 선에 닿음\n", dir > 0 ? "오른쪽" : "왼쪽"); } }
    else if (!lead && !passedAt) passedAt = moveMs + 1;
    else if (trail && passedAt) { ok = true; Out.printf("[제자리] 앞 %s 센서도 닿음 → 멈춤\n", dir > 0 ? "왼쪽" : "오른쪽"); break; }
    yield();
  }
  if (ok) spinBrake(dir); else { stopMotors(); Out.println("[제자리] 반대쪽 앞 센서가 끝내 선에 안 닿음 → 멈춤"); }
  speedDuty = savedDuty;
  delay(100);
  return ok;                     // 앞 두 센서가 차례로 닿았을 때만 성공 (아니면 엉뚱한 길로 직진하지 않게 멈춤)
}
// 핸들을 고정하고 곧장 ms 동안 (교차로 통과·바퀴 축 맞추기)
// ms 는 바퀴를 실제로 돌린 시간 기준 (끊어 가기로 느려도 같은 거리)
void forwardFor(unsigned long ms) {
  unsigned long m0 = moveMs, t0 = millis();
  moveLastAt = 0;
  while (!Abort::poll() && moveMs - m0 < ms && millis() - t0 < ms * 12UL + 1000) { driveP(speedPwm, speedPwm); yield(); }
  stopMotors();
}
// 회전 동작 t('S' 직진 · 'L' 좌 · 'R' 우 · 'U' 유턴)을 하고 지금 방향을 want 로 바꾼다
bool doTurn(char t, char want, bool atJunction) {
  bool ok = true;
  if (t == 'S') { if (atJunction) forwardFor(CROSS_CLEAR_MS); }
  else if (t == 'L' || t == 'R') {
    stopMotors();
    if (atJunction) { Out.printf("[회전] %s 분기 — %d초 멈춘 뒤 돌아요\n", t == 'L' ? "왼쪽" : "오른쪽", TURN_PAUSE_MS / 1000); delay(TURN_PAUSE_MS); }
    if (turnForwardMs > 0) forwardFor(turnForwardMs);
    ok = TURN_MODE == 1 ? spinUturn(t == 'L' ? -1 : 1, 0) : arcToLine(t == 'L' ? -1 : 1);   // 1 제자리 회전 · 0 앞으로 가며 돌기
  }
  else if (t == 'U') { ok = spinToLine(1, UTURN_MIN_MS); }
  if (ok && want != '-') heading = want;
  junctionIgnoreMove = moveMs + JUNCTION_COOLDOWN_MS;   // 방금 지난 교차로 선을 다시 세지 않게 (움직인 시간 기준)
  junctionArmed = false; sideClearSince = 0;            // 옆 센서가 그 선을 벗어나 바닥을 본 뒤에야 다음 교차로
  decideStart = 0; frontBothMove = 0;
  junctionSince = 0;
  followReset();
  Out.printf("[회전] %c → 방향 %c %s\n", t, want, ok ? "" : "(선을 못 찾음)");
  return ok;
}
// 출발점(복도 중간)에서: 지금 방향과 계획 방향을 비교해 그대로 가거나 유턴
bool faceHeading(char want) { return doTurn(turnFor(heading, want), want, false); }
// 교차로에서: 서버가 경로 모양으로 계산한 동작을 따른다 (대각선 구간도 정확)
bool turnAtNode(const Node& n) {
  char t = (n.action == 'L' || n.action == 'R' || n.action == 'U' || n.action == 'S') ? n.action : turnFor(heading, n.heading);
  return doTurn(t, n.heading, true);
}

// ───────── 계획 실행 ─────────
void startLeg(int from) {
  legFrom = from;
  legStart = millis();
  lineSeenAt = millis();
  junctionSince = 0;
  float m = plan[from].nextM;
  legExpected = (unsigned long)(m / ROBOT_SPEED_MPS * 1000.0);
  Out.printf("[구간] %s → %s  %.2fm, 약 %lums\n", plan[from].key, plan[from + 1].key, m, legExpected);
}

void beginPlan() {
  if (planLen < 2) return;
  Out.printf("[출발] 모드 %s\n", serverMode.c_str());
  state = ST_FOLLOW;
  if (!faceHeading(plan[0].heading)) { state = ST_ERROR; return; }
  reportPassed(0);
  startLeg(0);
}

void arriveEnd() {
  stopMotors();
  trimSave(false);
  Out.println("[도착] 목적지");
  for (int i = 0; i < 3 && !report("arrived", "{}"); i++) delay(1000);
  doneRev = planRev;
  state = ST_IDLE;
}

// 노드 j 에 닿았을 때
void atNode(int j) {
  stopMotors();
  reportPassed(j);
  if (state != ST_FOLLOW) return;            // 보고 응답에서 계획이 바뀌었으면 loop 가 처리
  Node& n = plan[j];
  if (n.action == 'E') {                      // 엘리베이터: 사람의 도움을 기다린다
    state = ST_ELEVATOR;
    legFrom = j;
    Out.printf("[엘리베이터] %d층으로 태워 주세요. 내린 뒤 FLASH 버튼\n", n.toFloor);
    return;
  }
  if (!turnAtNode(n)) { state = ST_ERROR; return; }
  startLeg(j);
}

void followStep() {
  if (obstacleHold()) return;                     // 앞이 막히면 멈춰 기다림 (구간 시계도 멈춤)
  unsigned long now = millis();
  bool finalLeg = (legFrom + 1 == planLen - 1);   // 다음이 END 면 시간으로 멈춘다
  if (finalLeg && now - legStart >= legExpected) { arriveEnd(); return; }

  // 교차로: 평소엔 선을 안 보는 좌우 센서가 선을 봄 (다음 노드까지 예상 시간의 JUNCTION_GATE 가 지난 뒤부터)
  bool gateOpen = !finalLeg && now - legStart > (unsigned long)(legExpected * JUNCTION_GATE);
  if (junctionSeen(gateOpen)) { atNode(legFrom + 1); return; }
  if (liftedNow()) { stopMotors(); state = ST_ERROR; Out.println("[오류] 센서가 모두 검정 — 로봇이 들렸어요?"); return; }

  lineFollow(speedPwm);
  logDrive("주행");
  // 다음 교차로가 예상 시간의 2배 + LOST_LINE_MS 가 지나도 안 나오면 선을 벗어난 것으로 보고 멈춤
  if (!finalLeg && now - legStart > legExpected * 2 + LOST_LINE_MS) {
    stopMotors(); state = ST_ERROR; Out.println("[오류] 다음 교차로가 너무 안 나와요 (선을 벗어났을 수 있음)");
  }
}

// ───────── 코스 시험 (서버 없이, 시리얼 'k') ─────────
// 표시(양옆 센서가 보는 교차로·분기·선 끝 가로선)를 만날 때마다 TEST_ROUTE 의 다음 글자를 한다.
const char* testRoute = routeBuf;
// 끝(T자)에서 뒤로 가서 본선 찾기: 뒤 센서가 T자 가로선을 벗어난 뒤, 두 뒤 센서가 모두 본선을 보면
// BACK_EXTRA_MS 만큼 더 물러나 바퀴 축을 본선 위에 맞추고 멈춤
// 뒤로 가며 앞 센서로 선 맞추기: 앞 왼쪽이 검정이면 차체 앞을 왼쪽으로(앞으로 갈 때와 같은 쪽으로 돌림).
// 뒤로 가면서도 회전 방향이 같도록 바퀴 차이를 준다. 바퀴는 앞으로는 돌지 않음(0 까지만).
int revSide = 0; unsigned long revSince = 0;
void reverseFollow(int base) {
  unsigned long now = millis();
  bool fl = sFrontL(), fr = sFrontR();
  int side = (fl && fr) ? 0 : fl ? -1 : fr ? 1 : 0;
  if (side != revSide) { revSide = side; revSince = now; }
  if (!side) { driveP(-base, -base); return; }
  unsigned long t = now - revSince;
  if (t > STEER_RAMP_MS) t = STEER_RAMP_MS;
  int steer = STEER_MIN + (int)((long)(STEER_MAX - STEER_MIN) * (long)t / STEER_RAMP_MS);
  int l = -base + side * steer, r = -base - side * steer;   // 회전 방향 = 왼쪽 - 오른쪽 = 2·side·steer (앞으로 갈 때와 같음)
  if (l > 0) l = 0;
  if (r > 0) r = 0;
  driveP(l, r);
}
bool backToLine() {
  unsigned long m0 = moveMs, t0 = millis();
  moveLastAt = 0;
  int savedDuty = speedDuty;
  speedDuty = 100;               // 뒤로 갈 때는 끊지 않고 계속 (끊으면 뒤로 잘 안 감)
  struct Restore { int& d; int v; ~Restore() { d = v; } } restore{speedDuty, savedDuty};
  revSide = 0; revSince = millis();
  bool cleared = false, seenL = PIN_SENSOR_LEFT < 0, seenR = PIN_SENSOR_RIGHT < 0;
  while (!Abort::poll() && moveMs - m0 < BACK_TIMEOUT_MS && millis() - t0 < BACK_TIMEOUT_MS * 12UL) {
    reverseFollow(BACK_PWM);
    bool l = sLeft(), r = sRight();
    logDrive("뒤로");
    if (!cleared) { if (!l && !r) cleared = true; }
    else {
      if (l) seenL = true;
      if (r) seenR = true;
      if (seenL && seenR) {
        Out.println("[코스] 뒤로 가다 뒤 센서가 본선에 닿음");
        unsigned long m1 = moveMs;
        while (!Abort::poll() && moveMs - m1 < BACK_EXTRA_MS) { reverseFollow(BACK_PWM); yield(); }
        stopMotors();
        delay(200);
        return true;
      }
    }
    yield();
  }
  stopMotors();
  return false;
}
void testStart() {
  routeIdx = 0;
  autoAfterU = false;
  blocked = false; nearCount = farCount = 0;
  junctionIgnoreMove = moveMs;          // 출발 때는 시간으로 막지 않음 (출발점 가까운 분기도 셈)
  junctionArmed = false; sideClearSince = 0;   // 옆 센서가 바닥을 0.1초 보면 바로 셈
  junctionSince = 0;
  testLastEvent = millis();
  followReset();
  state = ST_TEST;
  Out.printf("[코스 시험] \"%s\" 시작 — x 로 멈춤\n", testRoute);
}
void testFinish(const char* why) {
  stopMotors();
  trimSave(false);
  state = ST_IDLE;
  doneRev = planRev;   // 시험 중에 온 계획을 끝난 뒤 갑자기 달리지 않게
  Out.printf("[코스 시험] 끝: %s\n", why);
}
// 표시를 만났을 때 다음 글자를 한다
void testEvent() {
  char a = testRoute[routeIdx];
  stopMotors();
  testLastEvent = millis();
  if (!a) { testFinish("코스 글자를 다 썼어요"); return; }
  routeIdx++;
  if (a == 'A') {   // 자동: 길을 외우지 않고 보이는 대로 — 한쪽 분기 → 그쪽으로 · T자 → 유턴 · 유턴 다음 T자 = 본선 → 들어갔던 쪽으로
    routeIdx = 0;                 // 'A' 를 계속 되풀이
    bool both = junctionL && junctionR;
    if (both && !autoAfterU) { a = 'U'; autoAfterU = true; Out.println("[자동] 양쪽에 선(T자) → 끝으로 보고 유턴"); }
    else if (both) { a = autoLastTurn; autoAfterU = false; Out.printf("[자동] 유턴 뒤 T자 = 직진 도로 → %s (들어갔던 쪽)\n", a == 'L' ? "좌회전" : "우회전"); }
    else { a = junctionL ? 'L' : 'R'; autoLastTurn = a; autoAfterU = false; Out.printf("[자동] %s 분기 → %s\n", a == 'L' ? "왼쪽" : "오른쪽", a == 'L' ? "좌회전" : "우회전"); }
  }
  if (a == '!') {   // 멈춤 시험: 분기를 알아보면 돌지 않고 바로 멈추고 어느 쪽인지 알림
    Out.printf("[멈춤 시험] 분기 발견 → 멈춤: %s에 선 (뒤왼쪽 %d · 뒤오른쪽 %d · 앞왼쪽 %d · 앞오른쪽 %d)\n",
                  junctionL && junctionR ? "양쪽" : junctionL ? "왼쪽" : "오른쪽", (int)sLeft(), (int)sRight(), (int)sFrontL(), (int)sFrontR());
    testFinish("분기에서 멈춤");
    return;
  }
  if (a == '?') {   // 분기 시험: 선을 본 옆 센서 쪽으로 (양쪽 다면 T자·끝 표시 → 멈춤)
    a = (junctionL && junctionR) ? 'E' : junctionL ? 'L' : 'R';
    Out.printf("[분기 시험] %d번째: %s에 선 → %s\n", routeIdx, junctionL && junctionR ? "양쪽" : junctionL ? "왼쪽" : "오른쪽",
                  a == 'E' ? "멈춤" : a == 'L' ? "좌회전" : "우회전");
  } else Out.printf("[코스 시험] %d번째 표시 → %c\n", routeIdx, a);
  if (a == 'E') { testFinish("정지 (완료)"); return; }
  if (a == 'U' || a == 'u') {   // 끝(T자): 1초 멈춤 → 조금 뒤로 → 앞으로 가며 크게 돌아(유턴) 왔던 선에 올라탐 → 앞으로 본선까지
    Out.printf("[코스] 끝 — %d초 멈춘 뒤 유턴\n", TURN_PAUSE_MS / 1000);
    delay(TURN_PAUSE_MS);
    if (uturnBackMs > 0) {
      int savedDuty = speedDuty; speedDuty = 100;
      unsigned long m1 = moveMs, t1 = millis(); moveLastAt = 0;
      while (!Abort::poll() && moveMs - m1 < (unsigned long)uturnBackMs && millis() - t1 < (unsigned long)uturnBackMs * 12UL + 1000) { driveP(-BACK_PWM, -BACK_PWM); yield(); }
      stopMotors(); speedDuty = savedDuty; delay(150);
    }
    int dir = UTURN_DIR == 'R' ? 1 : -1;
    bool ok = spinUturn(dir, uturnIgnoreMs);
    Out.printf("[코스] 유턴 %s\n", ok ? "완료 → 앞으로 본선까지" : "— 선을 못 찾음");
    if (!ok) { testFinish("유턴하다 선을 못 찾았어요"); return; }
    junctionArmed = false; sideClearSince = 0; junctionSince = 0;
    junctionIgnoreMove = moveMs + JUNCTION_COOLDOWN_MS;
    followReset();
    if (!testRoute[routeIdx]) testFinish("코스 글자를 다 썼어요");
    return;
  }
  if (a == 'b' || a == 'B') {   // 끝(T자): 1초 멈춤 → 뒤로 가서 본선 찾기 → 다음 글자(L/R/S)로 본선에서 회전
    Out.printf("[코스] 끝 — %d초 멈춘 뒤 뒤로 가요\n", TURN_PAUSE_MS / 1000);
    delay(TURN_PAUSE_MS);
    if (!backToLine()) { testFinish("뒤로 가다 본선을 못 찾았어요"); return; }
    char t = testRoute[routeIdx];
    if (t == 'L' || t == 'R') {
      routeIdx++;
      Out.printf("[코스] 본선에서 %s\n", t == 'L' ? "좌회전" : "우회전");
      if (!doTurn(t, '-', false)) { testFinish("본선으로 돌다 선을 못 찾았어요"); return; }
    } else {
      if (t == 'S') routeIdx++;
      junctionArmed = false; sideClearSince = 0; junctionSince = 0;
      followReset();
    }
    if (!testRoute[routeIdx]) testFinish("코스 글자를 다 썼어요");
    return;
  }
  if (!doTurn(a, '-', true)) { testFinish("회전하다 선을 못 찾았어요"); return; }
  if (!testRoute[routeIdx]) testFinish("코스 글자를 다 썼어요");
}
void testStep() {
  if (obstacleHold()) return;
  if (junctionSeen(true)) { testEvent(); return; }
  if (liftedNow()) { testFinish("센서가 모두 검정 — 로봇이 들렸어요?"); return; }
  lineFollow(speedPwm);
  logDrive("시험");
  if (millis() - testLastEvent > TEST_GIVEUP_MS) testFinish("표시를 너무 오래 못 만났어요");
}

void elevatorStep() {
  int j = legFrom;                            // 엘리베이터 노드
  if (j + 1 >= planLen) { state = ST_ERROR; return; }
  Node& exitNode = plan[j + 1];
  bool go = buttonPressed();
  if (!go && millis() - lastPoll > POLL_WAIT_MS) {
    lastPoll = millis();
    String revBefore = planRev;
    pollDrive();
    if (planRev != revBefore) {               // 기다리는 동안 취소·새 목적지 → 처음부터 다시 판단
      Out.println("[엘리베이터] 계획이 바뀌었어요");
      state = ST_IDLE;
      return;
    }
    go = (serverPassed == exitNode.key);      // 로봇 화면에서 "내렸어요"를 누름
  }
  if (!go) return;
  Out.printf("[엘리베이터] %s 에서 다시 출발\n", exitNode.key);
  while (buttonPressed()) yield();
  heading = exitNode.heading;                 // 내려 준 사람이 출구 방향으로 놓아 준다고 본다
  if (serverPassed != exitNode.key) reportPassed(j + 1);
  state = ST_FOLLOW;
  startLeg(j + 1);
}

// ───────── 선 따라가기 시험 (시리얼 't' 또는 대기 중 BOOT 버튼) ─────────
// 교차로·서버 없이 선만 따라가며, 앞 센서 상태별 시간을 재서 얼마나 똑바로 따라가는지 알려 준다.
// 아무 모양으로 그린 선(곡선 포함) 위에서 시험. TRACE_MS 가 지나거나, 한쪽 꺾기가 TRACE_LOST_MS 넘게 이어지면(선을 놓침) 멈춤.
unsigned long traceStartAt = 0, traceLastAt = 0, traceLastPrint = 0;
unsigned long traceMs[4];          // 0 가운데(둘 다 바닥) · 1 왼쪽으로 바로잡기 · 2 오른쪽으로 · 3 가로선(둘 다 검정)
unsigned long traceLongest = 0;    // 가장 길게 이어진 한쪽 꺾기(ms)
int traceSwitches = 0;             // 왼쪽↔오른쪽 바로잡기가 바뀐 횟수 (지그재그)
int traceLastSide = 0;
int traceSlot(int side) { return side == -1 ? 1 : side == 1 ? 2 : side == 2 ? 3 : 0; }
void traceStart() {
  for (int i = 0; i < 4; i++) traceMs[i] = 0;
  traceLongest = 0; traceSwitches = 0; traceLastSide = 0;
  blocked = false; nearCount = farCount = 0;
  followReset();
  traceStartAt = traceLastAt = traceLastPrint = millis();
  state = ST_TRACE;
  Out.printf("[선 시험] 시작 — 최대 %lu초, x 또는 BOOT 버튼으로 멈춤\n", (unsigned long)(TRACE_MS / 1000));
}
int tracePct(int i) {
  unsigned long all = traceMs[0] + traceMs[1] + traceMs[2] + traceMs[3];
  return all ? (int)(traceMs[i] * 100 / all) : 0;
}
void tracePrint(const char* tag) {
  unsigned long sec = (millis() - traceStartAt) / 1000;
  Out.printf("[%s] %lu초 · 가운데 %d%% · 왼쪽으로 바로잡기 %d%% · 오른쪽으로 %d%% · 가로선 %d%% · 가장 긴 꺾기 %lu.%02lu초 · 지그재그 %d번 · 보정 %+.3f\n",
    tag, sec, tracePct(0), tracePct(1), tracePct(2), tracePct(3), traceLongest / 1000, (traceLongest % 1000) / 10, traceSwitches, motorTrim);
}
void traceFinish(const char* why) {
  stopMotors();
  state = ST_IDLE;
  doneRev = planRev;
  Out.printf("[선 시험] 끝: %s\n", why);
  tracePrint("결과");
  int mid = tracePct(0), l = tracePct(1), r = tracePct(2);
  float secs = (millis() - traceStartAt) / 1000.0f;
  float zig = secs > 0 ? traceSwitches / secs : 0;
  bool good = true;
  if (traceLongest >= TRACE_LOST_MS) { good = false; Out.println("  ✗ 선을 놓쳤어요 → 곡선에서 늦게 꺾음: STEER_RAMP_MS 줄이기 또는 속도 낮추기(시리얼 -) (또는 LINE_IS_HIGH·센서 높이 확인)"); }
  if (mid < 60) { good = false; Out.printf("  △ 가운데 %d%% (60%% 이상이 좋음) → 바로잡기가 잦음: 선이 앞 두 센서 사이 가운데 오게 센서 간격 확인\n", mid); }
  if (zig > 2.5f) { good = false; Out.printf("  △ 지그재그 초당 %.1f번 → STEER_MIN 줄이기 (지금 %d)\n", zig, (int)STEER_MIN); }
  if (l + r >= 10 && (l > 2 * r || r > 2 * l)) { good = false; Out.printf("  △ %s으로만 자주 바로잡음 → 모터 힘 차이: 곧은 선에서 b 를 두세 번\n", l > r ? "왼쪽" : "오른쪽"); }
  if (good) Out.println("  ✓ 선을 잘 따라가요");
  trimSave(false);
}
void traceStep() {
  if (obstacleHold()) { traceLastAt = millis(); return; }
  unsigned long now = millis();
  if (liftedNow()) { traceFinish("센서가 모두 검정 — 로봇이 들렸거나 선 밖 검정 바닥"); return; }
  lineFollow(speedPwm, true);
  logDrive("선 시험");
  unsigned long dt = now - traceLastAt;
  traceLastAt = now;
  traceMs[traceSlot(followSide)] += dt;
  if (followSide == -1 || followSide == 1) {
    if (traceLastSide && traceLastSide != followSide) traceSwitches++;
    traceLastSide = followSide;
    unsigned long run = now - followSince;
    if (run > traceLongest) traceLongest = run;
    if (run >= TRACE_LOST_MS) { traceFinish("한쪽으로 너무 오래 꺾음 (선을 놓친 듯)"); return; }
  }
  if (now - traceLastPrint >= 1000) { traceLastPrint = now; tracePrint("선 시험"); }
  if (now - traceStartAt >= TRACE_MS) traceFinish("시간 끝");
}
// BOOT 버튼을 한 번 누르면 true (뗄 때까지 기다림)
bool buttonClicked() {
  if (!buttonPressed()) return false;
  delay(30);
  if (!buttonPressed()) return false;
  while (buttonPressed()) yield();
  return true;
}

// ───────── 시리얼 점검 명령 ─────────
void serialCommands() {
  if (!In::available()) return;
  char ch = In::read();
  if (ch == 's') {
    Out.println("센서 5초 — 1 = 검정 선을 봄. 선 가운데에 똑바로 두면 앞L 0 · 앞R 0 · 뒤 0 이 맞음 (선 위 센서가 0 이면 LINE_IS_HIGH 를 바꾸기)");
    for (int i = 0; i < 50; i++) {
      Out.printf("뒤왼쪽 %d  앞왼쪽 %d  앞오른쪽 %d  뒤오른쪽 %d", (int)sLeft(), (int)sFrontL(), (int)sFrontR(), (int)sRight());
      if (SENSOR_LEFT_ANALOG || SENSOR_RIGHT_ANALOG)
        Out.printf("   (뒤 아날로그 원값 %d %d)", SENSOR_LEFT_ANALOG ? analogRead(PIN_SENSOR_LEFT) : -1, SENSOR_RIGHT_ANALOG ? analogRead(PIN_SENSOR_RIGHT) : -1);
      Out.println();
      delay(100);
    }
  } else if (ch == 'u') {
    if (PIN_SONAR_TRIG < 0) { Out.println("초음파를 안 씀 (config.h 의 PIN_SONAR_TRIG)"); return; }
    for (int i = 0; i < 20; i++) {
      int cm = sonarCm();
      if (cm < 0) Out.printf("앞 %dcm 안에 없음\n", OBSTACLE_CLEAR_CM + 20); else Out.printf("앞 %dcm%s\n", cm, cm < OBSTACLE_STOP_CM ? "  ← 멈춤 거리" : "");
      delay(200);
    }
  } else if (ch == 'm') {
    Out.println("[바퀴] 왼쪽 바퀴만 1초 앞으로");
    drive(speedPwm, 0); delay(1000); stopMotors(); delay(500);
    Out.println("[바퀴] 오른쪽 바퀴만 1초 앞으로");
    drive(0, speedPwm); delay(1000); stopMotors();
    Out.println("[바퀴] 뒤로 돈 바퀴가 있으면 config.h 의 LEFT_INVERT / RIGHT_INVERT 를 바꾸세요");
  } else if (ch == 'f') { Out.println("[바퀴] 1초 앞으로"); forwardFor(1000); }
  else if (ch == 'l') { Out.println("[바퀴] 0.5초 왼쪽 제자리 회전"); drive(-TURN_PWM, TURN_PWM); delay(500); stopMotors(); }
  else if (ch == 'r') { Out.println("[바퀴] 0.5초 오른쪽 제자리 회전"); drive(TURN_PWM, -TURN_PWM); delay(500); stopMotors(); }
  else if (ch == 'c') {
    Out.println("5초 동안 선을 따라갑니다(교차로 무시). 간 거리(m) ÷ 5 = ROBOT_SPEED_MPS");
    followReset();
    unsigned long t0 = millis();
    while (millis() - t0 < 5000) { lineFollow(speedPwm, true); logDrive("속도"); yield(); }
    stopMotors();
    trimSave(false);
  } else if (ch == 'b') {
    Out.printf("[모터 보정] 10초 동안 곧은 선을 따라가며 좌우 힘을 맞춥니다 (지금 %+.3f)\n", motorTrim);
    followReset();
    trimBoost = 5.0;
    unsigned long t0 = millis();
    while (millis() - t0 < 10000) { lineFollow(speedPwm, true); logDrive("보정"); yield(); }
    trimBoost = 1.0;
    stopMotors();
    Out.printf("[모터 보정] 결과 %+.3f — 한 번 더 하면 더 정확해요\n", motorTrim);
    trimSave(true);
  } else if (ch == '[' || ch == ']') {
    setTrim(motorTrim + (ch == ']' ? 0.02f : -0.02f));   // ] 왼쪽을 세게 · [ 오른쪽을 세게
    trimSave(true);
  } else if (ch == '+' || ch == '-' || ch == '=') {
    speedDuty = constrain(speedDuty + (ch == '-' ? -5 : 5), 10, 100);   // = 은 + 와 같음 (Shift 없이)
    speedSave();
  } else if (ch == '(' || ch == ')') {
    speedPwm = constrain(speedPwm + (ch == '(' ? -5 : 5), (int)MIN_PWM, (int)PWM_MAX);   // 끊어 가기 중 돌릴 때의 세기
    speedSave();
  } else if (ch == 'w') {
    Out.println("[최소 세기] 두 바퀴를 아주 약하게부터 0.5초마다 5씩 올려요. 바퀴가 처음 도는 숫자를 기억하세요 (x 로 멈춤)");
    for (int v = 40; v <= 200; v += 5) {
      Out.printf("  세기 %d\n", v);
      motor(PIN_LEFT_A, PIN_LEFT_B, PIN_LEFT_EN, v, LEFT_INVERT);       // 보정·최소 세기 올림 없이 그대로
      motor(PIN_RIGHT_A, PIN_RIGHT_B, PIN_RIGHT_EN, v, RIGHT_INVERT);
      unsigned long t0 = millis();
      bool stop = false;
      while (millis() - t0 < 500) { if (In::available() && In::read() == 'x') stop = true; yield(); }
      if (stop) break;
    }
    stopMotors();
    Out.println("[최소 세기] 끝 — 처음 돈 숫자보다 조금 높게 config.h 의 MIN_PWM 에");
  } else if (ch == 'z') {
    setTrim(MOTOR_TRIM);
    Out.println("[모터 보정] config.h 의 MOTOR_TRIM 으로 되돌림");
    trimSave(true);
  } else if (ch == 't') {
    if (state == ST_FOLLOW || state == ST_ELEVATOR) { Out.println("서버 주행 중이라 시험할 수 없어요 (x 로 멈춘 뒤)"); return; }
    traceStart();
  } else if (ch == 'a') {
    if (state == ST_FOLLOW || state == ST_ELEVATOR) { Out.println("서버 주행 중이라 시험할 수 없어요 (x 로 멈춘 뒤)"); return; }
    testRoute = "A";
    testStart();
    Out.println("[자동] 선을 따라가다 한쪽 분기 → 그쪽으로 · T자 → 유턴 · 유턴 다음 T자 = 직진 도로 (x 로 멈춤)");
  } else if (ch == 'h') {
    if (state == ST_FOLLOW || state == ST_ELEVATOR) { Out.println("서버 주행 중이라 시험할 수 없어요 (x 로 멈춘 뒤)"); return; }
    testRoute = "!";   // 분기를 알아보면 멈춤
    testStart();
    Out.println("[멈춤 시험] 선을 따라가다 뒤 센서(차체 양옆)가 분기를 알아보면 바로 멈춰요");
  } else if (ch == 'j') {
    if (state == ST_FOLLOW || state == ST_ELEVATOR) { Out.println("서버 주행 중이라 시험할 수 없어요 (x 로 멈춘 뒤)"); return; }
    testRoute = "??????????";   // 분기를 만날 때마다 선이 있는 쪽으로 (최대 10번)
    testStart();
    Out.printf("[분기 시험] 선을 따라가다 뒤 센서가 옆에 선을 보면 그쪽으로 돌아요 (양쪽이면 멈춤) · 회전 전 전진 %dms\n", turnForwardMs);
  } else if (ch == '<' || ch == '>') {
    uturnIgnoreMs = constrain(uturnIgnoreMs + (ch == '>' ? 100 : -100), 0, 5000);
    speedSave();
  } else if (ch == '{' || ch == '}') {
    uturnBackMs = constrain(uturnBackMs + (ch == '}' ? 50 : -50), 0, 3000);
    speedSave();
  } else if (ch == ',' || ch == '.') {
    turnForwardMs = constrain(turnForwardMs + (ch == '.' ? 20 : -20), 0, 1500);
    speedSave();
  } else if (ch == 'P') {         // P = 설정 목록 · P이름=값 = 바꾸고 기억 · P reset
    char buf[48]; int n = 0; unsigned long t0 = millis();
    while (millis() - t0 < 500) {
      if (In::available()) {
        char c = In::read(); t0 = millis();
        if (c == '\n' || c == '\r') break;
        if (c != ' ' && n < (int)sizeof(buf) - 1) buf[n++] = c;
      }
      yield();
    }
    buf[n] = 0;
    paramCommand(buf);
  } else if (ch == 'K') {         // K<순서 글자들> + 엔터(또는 0.5초 쉼): 코스 순서 바꾸기·저장
    char buf[sizeof(routeBuf)]; int n = 0; unsigned long t0 = millis();
    while (millis() - t0 < 500) {
      if (In::available()) {
        char c = In::read(); t0 = millis();
        if (c == '\n' || c == '\r') break;
        if (n < (int)sizeof(buf) - 1 && strchr("LRSUuEbB", c)) buf[n++] = c;
      }
      yield();
    }
    buf[n] = 0;
    if (n) { strcpy(routeBuf, buf); routeSave(); }
    Out.printf("[코스] 순서 \"%s\" (R 우회전 · L 좌회전 · S 직진 · U 끝에서 유턴 · b 끝에서 뒤로 가서 본선 찾기 · E 정지)\n", routeBuf);
  } else if (ch == 'k') {
    testRoute = routeBuf;
    if (state == ST_FOLLOW || state == ST_ELEVATOR) { Out.println("서버 주행 중이라 시험할 수 없어요 (x 로 멈춘 뒤)"); return; }
    testStart();
  } else if (ch == 'v') {
    verbose = !verbose;
    Out.printf("주행 기록 %s (0.1초마다 센서·바퀴·초음파)\n", verbose ? "켬" : "끔");
  } else if (ch == 'p') {
    Out.printf("모드 %s · rev %s · 방향 %c · 모터 보정 %+.3f · 세기 %d (최소 %d, PWM %dHz) · 끊어 가기 %d%% · 회전 전 전진 %dms\n", serverMode.c_str(), planRev.c_str(), heading, motorTrim, speedPwm, (int)MIN_PWM, (int)PWM_FREQ, speedDuty, turnForwardMs);
    for (int i = 0; i < planLen; i++) Out.printf("  %-8s %c %c %.2fm %d\n", plan[i].key, plan[i].action, plan[i].heading, plan[i].nextM, plan[i].toFloor);
  } else if (ch == 'x') {
    stopMotors();
    trimSave(false);
    if (state == ST_TEST) testFinish("x 로 멈춤");
    else if (state == ST_TRACE) traceFinish("x 로 멈춤");
    else { if (state == ST_FOLLOW || state == ST_ELEVATOR) doneRev = planRev; state = ST_IDLE; }
    Out.println("[멈춤]");
  }
}

// ───────── 시작 ─────────
// ───────── WiFi 진단 (20초 안에 못 붙으면 이유와 보이는 WiFi 목록을 알려 줌) ─────────
// 이름 비교용: 영문 소문자로 바꾸고 띄어쓰기·작은따옴표(' ‘ ’)는 뺀다 (iPhone 이름의 ’ 때문)
void ssidKey(const char* in, char* out, size_t n) {
  size_t j = 0;
  for (size_t i = 0; in[i] && j + 1 < n; i++) {
    unsigned char c = (unsigned char)in[i];
    if (c == 0xE2 && (unsigned char)in[i + 1] == 0x80 && ((unsigned char)in[i + 2] == 0x98 || (unsigned char)in[i + 2] == 0x99)) { i += 2; continue; }
    if (c == ' ' || c == '\'') continue;
    out[j++] = (c >= 'A' && c <= 'Z') ? (char)(c + 32) : (char)c;
  }
  out[j] = 0;
}
#if defined(ESP32)
volatile int wifiReason = 0;           // ESP32 가 알려 주는 마지막 연결 끊김 이유 번호
volatile uint32_t wifiReasonCount = 0; // 끊긴 횟수
volatile bool wifiQuiet = false;       // 진단하려고 우리가 끊는 동안은 기록하지 않음
#endif
const char* reasonHelp(int r) {
  switch (r) {
    case 15: case 202: case 204: return "→ 비밀번호가 틀렸을 가능성이 커요";
    case 201: return "→ 이 이름의 WiFi 가 안 보여요";
    case 200: return "→ 신호가 끊겼어요 (멀거나 핫스팟이 꺼짐)";
    case 203: return "→ WiFi 가 접속을 거절했어요 (연결 기기 수 제한·기기 차단)";
    case 210: case 211: return "→ 보안 방식이 안 맞아요 (WPA3 전용이면 WPA2 로 바꿔 보세요)";
    case 2: return "→ WiFi 가 응답하지 않아요 (멀거나 보안 방식 문제)";
    case 8: case 36: return "→ 연결을 스스로 끊었어요 (다시 연결 시도)";
    default: return "";
  }
}
const char* encName(int t) {
#if defined(ESP32)
  if (t == WIFI_AUTH_OPEN) return "비밀번호 없음";
  if (t == WIFI_AUTH_WEP) return "WEP(오래된 방식)";
  if (t == WIFI_AUTH_WPA2_ENTERPRISE) return "아이디+비밀번호(엔터프라이즈) - 펌웨어 기능 추가 필요";
  if (t == WIFI_AUTH_WPA3_PSK) return "비밀번호(WPA3 전용)";
  if (t == WIFI_AUTH_WPA2_WPA3_PSK) return "비밀번호(WPA2/WPA3)";
  if (t == WIFI_AUTH_WPA_PSK) return "비밀번호(WPA, 옛 방식)";
#else
  if (t == ENC_TYPE_NONE) return "비밀번호 없음";
  if (t == ENC_TYPE_WEP) return "WEP(오래된 방식)";
#endif
  return "비밀번호(WPA/WPA2)";
}
// scan: 보이는 WiFi 목록까지 (그 사이에는 이유만 출력하고 연결 시도는 건드리지 않음)
void wifiHelp(bool scan) {
  int st = WiFi.status();
  Out.printf("\n[WiFi] \"%s\" 에 20초 동안 못 붙었어요 (상태 %d%s)\n", WIFI_SSID, st,
    st == WL_NO_SSID_AVAIL ? ": 이 이름의 WiFi 가 안 보임" : st == WL_CONNECT_FAILED ? ": 비밀번호가 틀렸거나 지원하지 않는 방식" :
#if !defined(ESP32)
    st == WL_WRONG_PASSWORD ? ": 비밀번호가 틀림" :
#endif
    "");
#if defined(ESP32)
  if (wifiReason) Out.printf("[WiFi] 지금까지 %lu번 끊김, 마지막 이유 %d (%s) %s\n", (unsigned long)wifiReasonCount, wifiReason,
                                WiFi.disconnectReasonName((wifi_err_reason_t)wifiReason), reasonHelp(wifiReason));
  else Out.println("[WiFi] 끊긴 기록 없음 → 연결 시도 자체가 안 되고 있어요");
#endif
  Out.printf("[WiFi] config.h 의 비밀번호 길이: %d바이트 (WPA2 는 8~63자, 실제 비밀번호 글자 수와 같은지 확인)\n", (int)strlen(WIFI_PASS));
  if (strcmp(WIFI_SSID, "학교WiFi이름") == 0) Out.println("[WiFi] config.h 의 WIFI_SSID·WIFI_PASS 를 아직 안 고쳤어요 (config.h 가 없으면 config.example.h 로 올라감)");
  if (!scan) { Out.print("[WiFi] 계속 연결 중"); return; }
#if defined(ESP32)
  wifiQuiet = true;
#endif
  WiFi.setAutoReconnect(false);   // 연결 시도 중에는 검색이 안 되니 잠시 멈춤
  WiFi.disconnect();
  delay(1000);
  int n = WiFi.scanNetworks();
  if (n < 0) { delay(1500); n = WiFi.scanNetworks(); }
  char want[48], key[48];
  ssidKey(WIFI_SSID, want, sizeof want);
  bool exact = false, similar = false;
  Out.printf("[WiFi] 지금 보이는 WiFi %d개 (2.4GHz 만 보여요)  ▶ 같은 이름 · ? 비슷한 이름\n", n < 0 ? 0 : n);
  for (int i = 0; i < n; i++) {
    String name = WiFi.SSID(i);
    ssidKey(name.c_str(), key, sizeof key);
    bool same = strcmp(name.c_str(), WIFI_SSID) == 0;
    bool like = !same && strcmp(key, want) == 0;
    exact = exact || same;
    similar = similar || like;
    Out.printf("  %s \"%s\"  신호 %d  %s\n", same ? "▶" : like ? "?" : " ", name.c_str(), (int)WiFi.RSSI(i), encName(WiFi.encryptionType(i)));
  }
  if (exact) Out.println("[WiFi] 이름은 맞아요 → WIFI_PASS(비밀번호)를 확인하세요. '아이디+비밀번호' 방식이면 펌웨어에 기능을 추가해야 해요.");
  else if (similar) Out.println("[WiFi] ? 이름과 똑같이(대소문자·띄어쓰기·’ 따옴표까지) config.h 의 WIFI_SSID 를 고치세요. 목록 글자를 그대로 복사하면 정확해요.");
  else Out.println("[WiFi] 같은 이름이 안 보여요 → 5GHz 전용인지 확인하세요. iPhone 핫스팟은 '호환성 최대화'를 켜고 핫스팟 설정 화면을 열어 두세요.");
  WiFi.scanDelete();
  WiFi.setAutoReconnect(true);
#if defined(ESP32)
  wifiQuiet = false;
#endif
  WiFi.reconnect();   // 설정은 그대로 두고 다시 연결 (begin 을 다시 부르면 연결 중일 때 "cannot set config" 오류)
  Out.print("[WiFi] 다시 연결 중");
}

bool serverReady = false;      // WiFi 가 붙고 서버에서 처음 상태를 읽었음
bool wifiAnnounced = false;
unsigned long wifiStart = 0, wifiDotAt = 0;
int wifiFails = 0;
int shownReason = -1;
void wifiTick();

struct Param { const char* key; int* v; int lo, hi; const char* help; };
Param params[] = {
  {"speed", &speedPwm, 0, 255, "직진 세기"},
  {"duty", &speedDuty, 10, 100, "바퀴 돌리는 비율(%)"},
  {"pulseMs", &P_PULSE_MS, 20, 1000, "끊어 가기 한 주기(ms) — 짧을수록 부드러움"},
  {"tfwd", &turnForwardMs, 0, 1500, "회전 전 전진(ms)"},
  {"uign", &uturnIgnoreMs, 0, 5000, "유턴: 처음 선 무시(ms)"},
  {"uback", &uturnBackMs, 0, 3000, "유턴 전 뒤로(ms)"},
  {"uPwm", &P_UTURN_PWM, 0, 255, "제자리 회전 세기 (출발 뒤, 두 바퀴 반대로 계속)"},
  {"turnMode", &P_TURN_MODE, 0, 1, "분기 회전: 0 앞으로 가며 돌기 · 1 제자리 회전"},
  {"spinDuty", &P_SPIN_DUTY, 10, 100, "제자리 회전 끊어 가기 비율(%) — 100 = 끊지 않음(권장)"},
  {"kickPwm", &P_SPIN_KICK_PWM, 0, 255, "제자리 회전 출발 세기 (멈춘 바퀴 출발)"},
  {"kickMs", &P_SPIN_KICK_MS, 0, 1000, "제자리 회전 출발 세기 유지 시간(ms)"},
  {"brakeMs", &P_SPIN_BRAKE_MS, 0, 300, "제자리 회전 멈출 때 반대로 돌리는 시간(ms)"},
  {"steerMin", &P_STEER_MIN, 0, 255, "꺾기 시작 세기"},
  {"steerMax", &P_STEER_MAX, 0, 400, "꺾기 최대 세기"},
  {"steerRamp", &P_STEER_RAMP_MS, 50, 3000, "꺾기 세지는 시간(ms)"},
  {"minPwm", &P_MIN_PWM, 0, 255, "바퀴가 도는 최소 세기"},
  {"turnPwm", &P_TURN_PWM, 0, 255, "제자리 회전 세기"},
  {"arcPwm", &P_ARC_PWM, 0, 255, "앞으로 가며 돌기 바깥 바퀴 세기"},
  {"arcInner", &P_ARC_INNER_PWM, 0, 255, "앞으로 가며 돌기 안쪽 바퀴 세기"},
  {"arcSettle", &P_ARC_SETTLE_MS, 0, 3000, "회전: 선 지난 뒤 멈추기까지(ms)"},
  {"arcTimeout", &P_ARC_TIMEOUT_MS, 500, 20000, "회전 최대 시간(ms)"},
  {"turnPause", &P_TURN_PAUSE_MS, 0, 5000, "분기·끝에서 멈추는 시간(ms)"},
  {"juncMs", &P_JUNCTION_MS, 0, 1000, "분기 확정 시간(ms)"},
  {"pairMs", &P_BRANCH_PAIR_MS, 0, 5000, "분기: 앞→뒤 센서 사이 최대(ms), 0 = 뒤 센서만"},
  {"decideMs", &P_DECIDE_MS, 0, 2000, "분기/T자 결정: 첫 뒤 센서 뒤 반대쪽을 기다리는 시간(ms)"},
  {"crossMs", &P_CROSS_LOOKBACK_MS, 0, 5000, "T자 판단: 앞 센서 둘이 동시에 검정이었던 걸 돌아보는 시간(ms)"},
  {"juncCool", &P_JUNCTION_COOLDOWN_MS, 0, 5000, "회전 뒤 분기 무시(ms)"},
  {"backPwm", &P_BACK_PWM, 0, 255, "뒤로 가기 세기"},
  {"backExtra", &P_BACK_EXTRA_MS, 0, 3000, "본선에 닿은 뒤 더 물러나기(ms)"},
  {"liftMs", &P_LIFT_MS, 100, 10000, "모두 검정이면 멈추기(ms)"},
  {"flickerMs", &P_FLICKER_MS, 0, 5000, "깜빡임 판단 시간(ms)"},
  {"giveupMs", &P_TEST_GIVEUP_MS, 1000, 120000, "시험: 표시 못 만나면 멈추기(ms)"},
};
const int PARAM_COUNT = sizeof(params) / sizeof(params[0]);
void paramsLoad() {
#if defined(ESP32)
  Preferences p;
  if (!p.begin("peekokp", true)) return;
  for (int i = 0; i < PARAM_COUNT; i++) if (p.isKey(params[i].key)) *params[i].v = constrain((int)p.getInt(params[i].key, *params[i].v), params[i].lo, params[i].hi);
  p.end();
#endif
}
void paramSave(int i) {
#if defined(ESP32)
  Preferences p;
  if (p.begin("peekokp", false)) { p.putInt(params[i].key, *params[i].v); p.end(); }
#endif
}
void paramsPrint() {
  Out.println("[설정] 이름=값 (범위) 설명 — 바꾸려면 P이름=값 · 처음 값으로 P reset");
  for (int i = 0; i < PARAM_COUNT; i++) Out.printf("  %-10s = %-6d (%d~%d) %s\n", params[i].key, *params[i].v, params[i].lo, params[i].hi, params[i].help);
}
// "이름=값" 한 줄 처리
void paramCommand(const char* line) {
  if (!line[0]) { paramsPrint(); return; }
  if (!strcmp(line, "reset")) {
#if defined(ESP32)
    Preferences p; if (p.begin("peekokp", false)) { p.clear(); p.end(); }
#endif
    Out.println("[설정] 보드에 기억한 값을 지웠어요 — 다시 켜면 config.h 처음 값");
    return;
  }
  const char* eq = strchr(line, '=');
  if (!eq) { Out.printf("[설정] '%s' — P이름=값 형식으로\n", line); return; }
  for (int i = 0; i < PARAM_COUNT; i++) {
    if ((int)strlen(params[i].key) == eq - line && !strncmp(line, params[i].key, eq - line)) {
      int v = constrain(atoi(eq + 1), params[i].lo, params[i].hi);
      *params[i].v = v;
      paramSave(i);
      Out.printf("[설정] %s = %d 저장 (%s)\n", params[i].key, v, params[i].help);
      return;
    }
  }
  Out.printf("[설정] 이름을 모르겠어요: %.*s — P 만 보내면 목록\n", (int)(eq - line), line);
}

int sensorPinMode(int pin) {
#if defined(ESP32)
  return (pin >= 34 && pin <= 39) ? INPUT : INPUT_PULLUP;
#else
  return pin == D0 ? INPUT : INPUT_PULLUP;   // ESP8266 GPIO16 은 풀업 없음
#endif
}

void setup() {
  Serial.begin(115200);
  delay(100);
  Out.println("\n피콕 로봇 몸체 시작");
  pinMode(PIN_LEFT_A, OUTPUT); pinMode(PIN_LEFT_B, OUTPUT);
  pinMode(PIN_RIGHT_A, OUTPUT); pinMode(PIN_RIGHT_B, OUTPUT);
  if (PIN_LEFT_EN >= 0) pinMode(PIN_LEFT_EN, OUTPUT);
  if (PIN_RIGHT_EN >= 0) pinMode(PIN_RIGHT_EN, OUTPUT);
  // 라인 센서 DO: 보드 안 풀업을 켜서 선이 헐겁거나 모듈 출력이 약해도 값이 떠서 깜빡이지 않게 (34~39 는 풀업 없음)
  pinMode(PIN_FRONT_LEFT, sensorPinMode(PIN_FRONT_LEFT)); pinMode(PIN_FRONT_RIGHT, sensorPinMode(PIN_FRONT_RIGHT));
  if (PIN_SENSOR_LEFT >= 0 && !SENSOR_LEFT_ANALOG) pinMode(PIN_SENSOR_LEFT, sensorPinMode(PIN_SENSOR_LEFT));
  if (PIN_SENSOR_RIGHT >= 0 && !SENSOR_RIGHT_ANALOG) pinMode(PIN_SENSOR_RIGHT, sensorPinMode(PIN_SENSOR_RIGHT));
  if (PIN_SONAR_TRIG >= 0) { pinMode(PIN_SONAR_TRIG, OUTPUT); digitalWrite(PIN_SONAR_TRIG, LOW); pinMode(PIN_SONAR_ECHO, INPUT); }
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
#if !defined(ESP32)
  analogWriteRange(PWM_MAX);   // ESP32 는 기본 8비트(0~255)·1kHz 그대로 씀 (PWM_MAX 와 맞춰 둠)
  analogWriteFreq(PWM_FREQ);
#endif
  stopMotors();
#if defined(ESP32)
  // PWM 주파수: 낮을수록 약한 세기에서도 바퀴가 돌아 천천히 달릴 수 있음 (L298N·작은 기어모터는 100~500Hz 가 무난)
  if (PIN_LEFT_EN >= 0) { analogWriteFrequency(PIN_LEFT_EN, PWM_FREQ); analogWriteFrequency(PIN_RIGHT_EN, PWM_FREQ); }
  else { analogWriteFrequency(PIN_LEFT_A, PWM_FREQ); analogWriteFrequency(PIN_LEFT_B, PWM_FREQ); analogWriteFrequency(PIN_RIGHT_A, PWM_FREQ); analogWriteFrequency(PIN_RIGHT_B, PWM_FREQ); }
  stopMotors();
#endif
  trimLoad();
  paramsLoad();
  Out.printf("모터 보정 %+.3f (왼쪽 x%.2f · 오른쪽 x%.2f) · 세기 %d · 끊어 가기 %d%% · PWM %dHz\n", motorTrim, 1 + motorTrim, 1 - motorTrim, speedPwm, speedDuty, (int)PWM_FREQ);

#if defined(ESP32)
  WiFi.onEvent([](arduino_event_id_t, arduino_event_info_t info) {
    if (wifiQuiet) return;
    wifiReason = info.wifi_sta_disconnected.reason;
    wifiReasonCount = wifiReasonCount + 1;
  }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
#endif
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Out.printf("\nWiFi \"%s\" 연결 중 — 그동안에도 시리얼 시험 명령(s m t b k …)·BOOT 버튼 선 시험은 바로 쓸 수 있어요\n", WIFI_SSID);
  // HTTPS: 인증서 검사를 하지 않는 간단한 방식(학교 WiFi 안에서 사용). 보안을 높이려면 README 참고.
  tls.setInsecure();
  wifiStart = millis();
}

// WiFi 연결을 기다리는 동안(막지 않음): 점·끊긴 이유·20초마다 진단. 처음 붙으면 서버에서 지금 상태를 읽는다.
// 시험·주행 중에는 진단(WiFi 검색은 몇 초 걸림)을 하지 않는다.
void wifiTick() {
  bool busy = state == ST_FOLLOW || state == ST_TEST || state == ST_TRACE || state == ST_ELEVATOR;
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiAnnounced) { wifiAnnounced = true; Out.printf("\nWiFi 연결됨: %s\n", WiFi.localIP().toString().c_str()); }
    if (!serverReady && !busy) {
#if !defined(ESP32)
      tls.setSession(&tlsSession);               // 다시 접속할 때 빠르게
      if (tls.probeMaxFragmentLength(SERVER_HOST, 443, 1024)) tls.setBufferSizes(1024, 1024);
#endif
      pollDrive();
      doneRev = planRev;                         // 켜기 전에 남아 있던 계획은 다시 달리지 않는다
      serverReady = true;
      lastPoll = millis();
      Out.printf("서버 연결됨 · 모드 %s\n", serverMode.c_str());
    }
    return;
  }
  if (wifiAnnounced) { wifiAnnounced = false; wifiStart = millis(); Out.print("\n[WiFi] 끊김 — 다시 연결 중"); }
  if (busy) return;
  if (millis() - wifiDotAt >= 1000) { wifiDotAt = millis(); Out.print('.'); }
#if defined(ESP32)
  int r = wifiReason;   // 끊긴 이유가 바뀔 때마다 바로 보여 줌
  if (r && r != shownReason) { shownReason = r; Out.printf("\n[WiFi] 끊김: 이유 %d (%s) %s\n", r, WiFi.disconnectReasonName((wifi_err_reason_t)r), reasonHelp(r)); }
#endif
  if (millis() - wifiStart > 20000) { wifiHelp(wifiFails++ % 3 == 0); wifiStart = millis(); }   // 목록은 1분마다
}

// WiFi 가 붙으면 무선 시리얼·무선 업로드 시작, 그 뒤로는 연결 받기·업로드 처리
void wirelessTick() {
#if defined(ESP32)
  if (WiFi.status() != WL_CONNECTED) return;
  if (!wirelessStarted) {
    wirelessStarted = true;
    telnetServer.begin();
    telnetServer.setNoDelay(true);
    ArduinoOTA.setHostname("peekok-robot");
    ArduinoOTA.setPassword(OTA_PASS);
    ArduinoOTA.onStart([]() { stopMotors(); state = ST_IDLE; Out.println("[무선 업로드] 시작 — 모터 멈춤"); });
    ArduinoOTA.onEnd([]() { Out.println("[무선 업로드] 끝 — 다시 켜짐"); });
    ArduinoOTA.onError([](ota_error_t e) { Out.printf("[무선 업로드] 오류 %d\n", (int)e); });
    ArduinoOTA.begin();
    MDNS.addService("telnet", "tcp", 2323);
    Out.printf("[무선] 준비됨 — IP %s · 이름 peekok-robot.local · 시리얼 2323 · 무선 업로드 가능\n", WiFi.localIP().toString().c_str());
  }
  ArduinoOTA.handle();
  bool conn = telnet && telnet.connected();
  if (telnetWasConnected && !conn) {
    telnetWasConnected = false;
    if (state == ST_TEST || state == ST_TRACE) { abortMotion = true; Serial.println("[무선] 연결 끊김 → 시험 멈춤"); }
  }
  if (telnetServer.hasClient()) {
    if (telnet && telnet.connected()) telnet.stop();
    telnet = telnetServer.available();
    telnet.setNoDelay(true);
    telnetWasConnected = true;
    Out.printf("[무선] 시리얼 연결됨 (%s)\n", telnet.remoteIP().toString().c_str());
  }
#endif
}

void loop() {
  wirelessTick();
  if (abortMotion) {                 // 멈춤 요청 처리 (오래 걸리는 동작에서 빠져나온 뒤)
    abortMotion = false;
    stopMotors();
    if (state == ST_TEST) testFinish("멈춤 요청");
    else if (state == ST_TRACE) traceFinish("멈춤 요청");
    else if (state == ST_FOLLOW || state == ST_ELEVATOR) { doneRev = planRev; state = ST_IDLE; }
  }
  serialCommands();
  wifiTick();
  // WiFi·서버가 아직(또는 끊김)이면 대기 중에는 서버 확인만 건너뜀 — 시리얼 시험과 BOOT 버튼 선 시험은 그대로 됨
  if ((WiFi.status() != WL_CONNECTED || !serverReady) && (state == ST_IDLE || state == ST_ERROR)) {
    stopMotors();
    led((millis() / 150) % 2);
    if (buttonClicked()) {
      Out.println("\n[선 시험] BOOT 버튼 — 2초 뒤 출발");
      for (int i = 0; i < 10; i++) { led(i % 2); delay(200); }
      traceStart();
    }
    return;
  }

  switch (state) {
    case ST_IDLE:
    case ST_ERROR:
      stopMotors();
      led(state == ST_ERROR ? (millis() / 200) % 2 : (millis() / 1000) % 2);
      if (buttonClicked()) {                    // 대기 중 BOOT 버튼 = 선 따라가기 시험 (2초 뒤 출발, USB 없이도)
        Out.println("[선 시험] BOOT 버튼 — 2초 뒤 출발");
        for (int i = 0; i < 10; i++) { led(i % 2); delay(200); }
        traceStart();
        break;
      }
      if (millis() - lastPoll > POLL_IDLE_MS) {
        lastPoll = millis();
        if (pollDrive()) {
          bool moving = serverMode == "to_caller" || serverMode == "delivering" || serverMode == "guiding" || serverMode == "returning";
          if (moving && planLen >= 2 && planRev != doneRev) {
            if (state == ST_ERROR) Out.println("[다시 시도] 새 계획");
            beginPlan();
          }
        }
      }
      break;
    case ST_FOLLOW: {
      led(true);
      String revBefore = planRev;
      followStep();
      // 노드 보고 응답에서 계획이 바뀌었거나(취소·새 목적지) 모드가 바뀌면 멈추고 다시 판단
      bool moving = serverMode == "to_caller" || serverMode == "delivering" || serverMode == "guiding" || serverMode == "returning";
      if (state == ST_FOLLOW && (planRev != revBefore || !moving)) {
        stopMotors();
        Out.println("[계획 바뀜] 멈추고 다시 판단");
        state = ST_IDLE;
        if (moving && planLen >= 2) beginPlan();
      }
      break;
    }
    case ST_ELEVATOR:
      led((millis() / 500) % 2);
      elevatorStep();
      break;
    case ST_TRACE:
      led(true);
      if (buttonClicked()) { traceFinish("BOOT 버튼으로 멈춤"); break; }
      traceStep();
      break;
    case ST_TEST:
      led((millis() / 100) % 2);
      testStep();
      break;
  }
}
