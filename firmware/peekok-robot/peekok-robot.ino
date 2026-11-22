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
 *   - 초음파(HC-SR04)를 달면(PIN_SONAR_TRIG) 달리는 중 앞에 장애물이 가까우면 멈췄다가 치워지면 다시 간다.
 * 시리얼(115200): s 센서 · u 초음파 · m 바퀴 하나씩 · f 앞으로 · l/r 제자리 회전 · c 속도 재기(5초 선 따라가기)
 *                 k 코스 시험(서버 없이 TEST_ROUTE) · v 주행 기록 켜기/끄기 · p 계획 보기 · x 멈춤
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
enum State { ST_IDLE, ST_FOLLOW, ST_ELEVATOR, ST_ERROR, ST_TEST };
State state = ST_IDLE;
int legFrom = 0;              // 지금 달리는 구간: plan[legFrom] → plan[legFrom + 1]
char heading = HOME_HEADING;  // 지금 바라보는 도면 방향
unsigned long legStart = 0;   // 구간 시작 시각
unsigned long legExpected = 0;// 구간 예상 시간(ms)
unsigned long junctionSince = 0;
unsigned long junctionIgnoreUntil = 0;  // 회전·통과 직후 좌우 센서 무시
unsigned long lineSeenAt = 0; // 앞 센서가 마지막으로 검정을 본 시각
int followSide = 0;           // 앞 센서: 0 둘 다 바닥 · -1 왼쪽만 검정 · 1 오른쪽만 검정 · 2 둘 다 검정
unsigned long followSince = 0;// 그 상태가 시작된 시각
unsigned long testLastEvent = 0;
unsigned long lastPoll = 0;
bool verbose = false;         // 'v': 주행 중 센서·바퀴 기록
unsigned long lastLog = 0;
int lastLeftPwm = 0, lastRightPwm = 0;
// 장애물
bool blocked = false;
unsigned long blockedSince = 0;
int nearCount = 0, farCount = 0;
unsigned long lastSonar = 0;
int lastCm = -1;
// 코스 시험
int routeIdx = 0;

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
void drive(int left, int right) {
  lastLeftPwm = left; lastRightPwm = right;
  motor(PIN_LEFT_A, PIN_LEFT_B, PIN_LEFT_EN, left, LEFT_INVERT);
  motor(PIN_RIGHT_A, PIN_RIGHT_B, PIN_RIGHT_EN, right, RIGHT_INVERT);
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
    if (blocked && !was) { blockedSince = now; Serial.printf("[장애물] 앞 %dcm — 멈춤\n", lastCm); }
    if (!blocked && was) {
      unsigned long d = now - blockedSince;
      legStart += d; lineSeenAt += d; followSince = now; testLastEvent += d; junctionSince = 0;
      Serial.printf("[장애물] 치워짐 — %lu.%lu초 만에 다시 출발\n", d / 1000, (d % 1000) / 100);
    }
  }
  if (blocked) stopMotors();
  return blocked;
}

// ───────── 선 따라가기 · 교차로 감지 ─────────
// 앞 두 센서 사이에 선을 두고 달린다. 한 번 부를 때마다 바퀴 세기를 정함.
void lineFollow(int base) {
  unsigned long now = millis();
  bool fl = sFrontL(), fr = sFrontR();
  int side = (fl && fr) ? 2 : fl ? -1 : fr ? 1 : 0;
  if (side != followSide) { followSide = side; followSince = now; }
  if (fl || fr) lineSeenAt = now;
  if (side == 0 || side == 2) { drive(base, base); return; }   // 선이 사이에 있음 · 앞에 가로선 → 곧장
  // 한쪽이 검정 = 선이 그쪽으로 치우침 → 그쪽으로 꺾기. 오래 이어질수록 세게(STEER_RAMP_MS 에 STEER_MAX = 제자리 회전에 가깝게)
  unsigned long t = now - followSince;
  if (t > STEER_RAMP_MS) t = STEER_RAMP_MS;
  int steer = STEER_MIN + (int)((long)(STEER_MAX - STEER_MIN) * (long)t / STEER_RAMP_MS);
  drive(base + side * steer, base - side * steer);   // side -1: 왼쪽 바퀴를 느리게 = 왼쪽으로
}
// 새로 선을 잡은 뒤(회전·출발) 따라가기 상태를 처음부터
void followReset() { followSide = -9; followSince = millis(); lineSeenAt = millis(); }
// 좌우 센서가 JUNCTION_MS 이상 선을 보면 교차로 (allowed 가 false 거나 회전 직후면 무시)
bool junctionSeen(bool allowed) {
  unsigned long now = millis();
  if (!allowed || (long)(now - junctionIgnoreUntil) < 0 || !(sLeft() || sRight())) { junctionSince = 0; return false; }
  if (!junctionSince) junctionSince = now;
  return now - junctionSince >= JUNCTION_MS;
}
void logDrive(const char* tag) {
  if (!verbose || millis() - lastLog < 100) return;
  lastLog = millis();
  Serial.printf("[%s] 센서 옆L%d 앞L%d 앞R%d 옆R%d · 바퀴 %d %d · 앞 %dcm\n", tag, (int)sLeft(), (int)sFrontL(), (int)sFrontR(), (int)sRight(), lastLeftPwm, lastRightPwm, lastCm);
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
  else Serial.printf("[http] %s %s → %d\n", post ? "POST" : "GET", path.c_str(), code);
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
    Serial.printf("[plan] rev %s · 노드 %d개 (예상 %d)\n", planRev.c_str(), planLen, count);
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
  Serial.printf("[노드] %s 지남 → %s\n", plan[i].key, next.c_str());
  return report("progress", json);
}

// ───────── 회전 (막는 동작: 끝날 때까지 기다림) ─────────
// dir: -1 왼쪽, +1 오른쪽. minMs 가 지나기 전에는 선을 무시(유턴용).
// 제자리에서 돌다가 도는 쪽 앞 센서(오른쪽으로 돌면 앞 오른쪽)가 새 선을 잡으면 멈춘다.
// 처음 minMs 동안은 선을 무시(지금 서 있는 선을 벗어나기), 그 뒤에는 바닥 → 검정으로 바뀌는 순간에 멈춤.
bool spinToLine(int dir, unsigned long minMs) {
  drive(dir * -TURN_PWM, dir * TURN_PWM);
  unsigned long t0 = millis();
  bool sawFloor = false;
  while (millis() - t0 < TURN_TIMEOUT_MS) {
    bool c = dir > 0 ? sFrontR() : sFrontL();
    if (millis() - t0 >= minMs) {
      if (!c) sawFloor = true;
      else if (sawFloor) { stopMotors(); delay(80); return true; }
    }
    yield();
  }
  stopMotors();
  return false;
}
// 핸들을 고정하고 곧장 ms 동안 (교차로 통과·바퀴 축 맞추기)
void forwardFor(unsigned long ms) {
  drive(SPEED_PWM, SPEED_PWM);
  unsigned long t0 = millis();
  while (millis() - t0 < ms) yield();
  stopMotors();
}
// 회전 동작 t('S' 직진 · 'L' 좌 · 'R' 우 · 'U' 유턴)을 하고 지금 방향을 want 로 바꾼다
bool doTurn(char t, char want, bool atJunction) {
  bool ok = true;
  if (t == 'S') { if (atJunction) forwardFor(CROSS_CLEAR_MS); }
  else if (t == 'L' || t == 'R') { forwardFor(TURN_FORWARD_MS); ok = spinToLine(t == 'L' ? -1 : 1, TURN_MIN_MS); }
  else if (t == 'U') { ok = spinToLine(1, UTURN_MIN_MS); }
  if (ok && want != '-') heading = want;
  junctionIgnoreUntil = millis() + JUNCTION_COOLDOWN_MS;   // 방금 지난 교차로 선을 다시 세지 않게
  junctionSince = 0;
  followReset();
  Serial.printf("[회전] %c → 방향 %c %s\n", t, want, ok ? "" : "(선을 못 찾음)");
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
  Serial.printf("[구간] %s → %s  %.2fm, 약 %lums\n", plan[from].key, plan[from + 1].key, m, legExpected);
}

void beginPlan() {
  if (planLen < 2) return;
  Serial.printf("[출발] 모드 %s\n", serverMode.c_str());
  state = ST_FOLLOW;
  if (!faceHeading(plan[0].heading)) { state = ST_ERROR; return; }
  reportPassed(0);
  startLeg(0);
}

void arriveEnd() {
  stopMotors();
  Serial.println("[도착] 목적지");
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
    Serial.printf("[엘리베이터] %d층으로 태워 주세요. 내린 뒤 FLASH 버튼\n", n.toFloor);
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

  lineFollow(SPEED_PWM);
  logDrive("주행");
  // 다음 교차로가 예상 시간의 2배 + LOST_LINE_MS 가 지나도 안 나오면 선을 벗어난 것으로 보고 멈춤
  if (!finalLeg && now - legStart > legExpected * 2 + LOST_LINE_MS) {
    stopMotors(); state = ST_ERROR; Serial.println("[오류] 다음 교차로가 너무 안 나와요 (선을 벗어났을 수 있음)");
  }
}

// ───────── 코스 시험 (서버 없이, 시리얼 'k') ─────────
// 표시(양옆 센서가 보는 교차로·분기·선 끝 가로선)를 만날 때마다 TEST_ROUTE 의 다음 글자를 한다.
const char* testRoute = TEST_ROUTE;
void testStart() {
  routeIdx = 0;
  blocked = false; nearCount = farCount = 0;
  junctionIgnoreUntil = millis() + JUNCTION_COOLDOWN_MS;
  junctionSince = 0;
  testLastEvent = millis();
  followReset();
  state = ST_TEST;
  Serial.printf("[코스 시험] \"%s\" 시작 — x 로 멈춤\n", testRoute);
}
void testFinish(const char* why) {
  stopMotors();
  state = ST_IDLE;
  doneRev = planRev;   // 시험 중에 온 계획을 끝난 뒤 갑자기 달리지 않게
  Serial.printf("[코스 시험] 끝: %s\n", why);
}
// 표시를 만났을 때 다음 글자를 한다
void testEvent() {
  char a = testRoute[routeIdx];
  stopMotors();
  testLastEvent = millis();
  if (!a) { testFinish("코스 글자를 다 썼어요"); return; }
  routeIdx++;
  Serial.printf("[코스 시험] %d번째 표시 → %c\n", routeIdx, a);
  if (a == 'E') { testFinish("정지 (완료)"); return; }
  if (!doTurn(a, '-', true)) { testFinish("회전하다 선을 못 찾았어요"); return; }
  if (!testRoute[routeIdx]) testFinish("코스 글자를 다 썼어요");
}
void testStep() {
  if (obstacleHold()) return;
  if (junctionSeen(true)) { testEvent(); return; }
  lineFollow(SPEED_PWM);
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
      Serial.println("[엘리베이터] 계획이 바뀌었어요");
      state = ST_IDLE;
      return;
    }
    go = (serverPassed == exitNode.key);      // 로봇 화면에서 "내렸어요"를 누름
  }
  if (!go) return;
  Serial.printf("[엘리베이터] %s 에서 다시 출발\n", exitNode.key);
  while (buttonPressed()) yield();
  heading = exitNode.heading;                 // 내려 준 사람이 출구 방향으로 놓아 준다고 본다
  if (serverPassed != exitNode.key) reportPassed(j + 1);
  state = ST_FOLLOW;
  startLeg(j + 1);
}

// ───────── 시리얼 점검 명령 ─────────
void serialCommands() {
  if (!Serial.available()) return;
  char ch = Serial.read();
  if (ch == 's') {
    Serial.println("센서 5초 — 1 = 검정 선을 봄. 선 가운데에 똑바로 두면 앞L 0 · 앞R 0 · 옆 0 이 맞음 (선 위 센서가 0 이면 LINE_IS_HIGH 를 바꾸기)");
    for (int i = 0; i < 50; i++) {
      Serial.printf("옆왼쪽 %d  앞왼쪽 %d  앞오른쪽 %d  옆오른쪽 %d", (int)sLeft(), (int)sFrontL(), (int)sFrontR(), (int)sRight());
      if (SENSOR_LEFT_ANALOG || SENSOR_RIGHT_ANALOG)
        Serial.printf("   (옆 아날로그 원값 %d %d)", SENSOR_LEFT_ANALOG ? analogRead(PIN_SENSOR_LEFT) : -1, SENSOR_RIGHT_ANALOG ? analogRead(PIN_SENSOR_RIGHT) : -1);
      Serial.println();
      delay(100);
    }
  } else if (ch == 'u') {
    if (PIN_SONAR_TRIG < 0) { Serial.println("초음파를 안 씀 (config.h 의 PIN_SONAR_TRIG)"); return; }
    for (int i = 0; i < 20; i++) {
      int cm = sonarCm();
      if (cm < 0) Serial.printf("앞 %dcm 안에 없음\n", OBSTACLE_CLEAR_CM + 20); else Serial.printf("앞 %dcm%s\n", cm, cm < OBSTACLE_STOP_CM ? "  ← 멈춤 거리" : "");
      delay(200);
    }
  } else if (ch == 'm') {
    Serial.println("[바퀴] 왼쪽 바퀴만 1초 앞으로");
    drive(SPEED_PWM, 0); delay(1000); stopMotors(); delay(500);
    Serial.println("[바퀴] 오른쪽 바퀴만 1초 앞으로");
    drive(0, SPEED_PWM); delay(1000); stopMotors();
    Serial.println("[바퀴] 뒤로 돈 바퀴가 있으면 config.h 의 LEFT_INVERT / RIGHT_INVERT 를 바꾸세요");
  } else if (ch == 'f') { Serial.println("[바퀴] 1초 앞으로"); forwardFor(1000); }
  else if (ch == 'l') { Serial.println("[바퀴] 0.5초 왼쪽 제자리 회전"); drive(-TURN_PWM, TURN_PWM); delay(500); stopMotors(); }
  else if (ch == 'r') { Serial.println("[바퀴] 0.5초 오른쪽 제자리 회전"); drive(TURN_PWM, -TURN_PWM); delay(500); stopMotors(); }
  else if (ch == 'c') {
    Serial.println("5초 동안 선을 따라갑니다(교차로 무시). 간 거리(m) ÷ 5 = ROBOT_SPEED_MPS");
    followReset();
    unsigned long t0 = millis();
    while (millis() - t0 < 5000) { lineFollow(SPEED_PWM); logDrive("속도"); yield(); }
    stopMotors();
  } else if (ch == 'k') {
    if (state == ST_FOLLOW || state == ST_ELEVATOR) { Serial.println("서버 주행 중이라 시험할 수 없어요 (x 로 멈춘 뒤)"); return; }
    testStart();
  } else if (ch == 'v') {
    verbose = !verbose;
    Serial.printf("주행 기록 %s (0.1초마다 센서·바퀴·초음파)\n", verbose ? "켬" : "끔");
  } else if (ch == 'p') {
    Serial.printf("모드 %s · rev %s · 방향 %c\n", serverMode.c_str(), planRev.c_str(), heading);
    for (int i = 0; i < planLen; i++) Serial.printf("  %-8s %c %c %.2fm %d\n", plan[i].key, plan[i].action, plan[i].heading, plan[i].nextM, plan[i].toFloor);
  } else if (ch == 'x') {
    stopMotors();
    if (state == ST_TEST) testFinish("x 로 멈춤");
    else { if (state == ST_FOLLOW || state == ST_ELEVATOR) doneRev = planRev; state = ST_IDLE; }
    Serial.println("[멈춤]");
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
  Serial.printf("\n[WiFi] \"%s\" 에 20초 동안 못 붙었어요 (상태 %d%s)\n", WIFI_SSID, st,
    st == WL_NO_SSID_AVAIL ? ": 이 이름의 WiFi 가 안 보임" : st == WL_CONNECT_FAILED ? ": 비밀번호가 틀렸거나 지원하지 않는 방식" :
#if !defined(ESP32)
    st == WL_WRONG_PASSWORD ? ": 비밀번호가 틀림" :
#endif
    "");
#if defined(ESP32)
  if (wifiReason) Serial.printf("[WiFi] 지금까지 %lu번 끊김, 마지막 이유 %d (%s) %s\n", (unsigned long)wifiReasonCount, wifiReason,
                                WiFi.disconnectReasonName((wifi_err_reason_t)wifiReason), reasonHelp(wifiReason));
  else Serial.println("[WiFi] 끊긴 기록 없음 → 연결 시도 자체가 안 되고 있어요");
#endif
  Serial.printf("[WiFi] config.h 의 비밀번호 길이: %d바이트 (WPA2 는 8~63자, 실제 비밀번호 글자 수와 같은지 확인)\n", (int)strlen(WIFI_PASS));
  if (strcmp(WIFI_SSID, "학교WiFi이름") == 0) Serial.println("[WiFi] config.h 의 WIFI_SSID·WIFI_PASS 를 아직 안 고쳤어요 (config.h 가 없으면 config.example.h 로 올라감)");
  if (!scan) { Serial.print("[WiFi] 계속 연결 중"); return; }
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
  Serial.printf("[WiFi] 지금 보이는 WiFi %d개 (2.4GHz 만 보여요)  ▶ 같은 이름 · ? 비슷한 이름\n", n < 0 ? 0 : n);
  for (int i = 0; i < n; i++) {
    String name = WiFi.SSID(i);
    ssidKey(name.c_str(), key, sizeof key);
    bool same = strcmp(name.c_str(), WIFI_SSID) == 0;
    bool like = !same && strcmp(key, want) == 0;
    exact = exact || same;
    similar = similar || like;
    Serial.printf("  %s \"%s\"  신호 %d  %s\n", same ? "▶" : like ? "?" : " ", name.c_str(), (int)WiFi.RSSI(i), encName(WiFi.encryptionType(i)));
  }
  if (exact) Serial.println("[WiFi] 이름은 맞아요 → WIFI_PASS(비밀번호)를 확인하세요. '아이디+비밀번호' 방식이면 펌웨어에 기능을 추가해야 해요.");
  else if (similar) Serial.println("[WiFi] ? 이름과 똑같이(대소문자·띄어쓰기·’ 따옴표까지) config.h 의 WIFI_SSID 를 고치세요. 목록 글자를 그대로 복사하면 정확해요.");
  else Serial.println("[WiFi] 같은 이름이 안 보여요 → 5GHz 전용인지 확인하세요. iPhone 핫스팟은 '호환성 최대화'를 켜고 핫스팟 설정 화면을 열어 두세요.");
  WiFi.scanDelete();
  WiFi.setAutoReconnect(true);
#if defined(ESP32)
  wifiQuiet = false;
#endif
  WiFi.reconnect();   // 설정은 그대로 두고 다시 연결 (begin 을 다시 부르면 연결 중일 때 "cannot set config" 오류)
  Serial.print("[WiFi] 다시 연결 중");
}

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n피콕 로봇 몸체 시작");
  pinMode(PIN_LEFT_A, OUTPUT); pinMode(PIN_LEFT_B, OUTPUT);
  pinMode(PIN_RIGHT_A, OUTPUT); pinMode(PIN_RIGHT_B, OUTPUT);
  if (PIN_LEFT_EN >= 0) pinMode(PIN_LEFT_EN, OUTPUT);
  if (PIN_RIGHT_EN >= 0) pinMode(PIN_RIGHT_EN, OUTPUT);
  pinMode(PIN_FRONT_LEFT, INPUT); pinMode(PIN_FRONT_RIGHT, INPUT);
  if (PIN_SENSOR_LEFT >= 0 && !SENSOR_LEFT_ANALOG) pinMode(PIN_SENSOR_LEFT, INPUT);
  if (PIN_SENSOR_RIGHT >= 0 && !SENSOR_RIGHT_ANALOG) pinMode(PIN_SENSOR_RIGHT, INPUT);
  if (PIN_SONAR_TRIG >= 0) { pinMode(PIN_SONAR_TRIG, OUTPUT); digitalWrite(PIN_SONAR_TRIG, LOW); pinMode(PIN_SONAR_ECHO, INPUT); }
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
#if !defined(ESP32)
  analogWriteRange(PWM_MAX);   // ESP32 는 기본 8비트(0~255)·1kHz 그대로 씀 (PWM_MAX 와 맞춰 둠)
  analogWriteFreq(1000);
#endif
  stopMotors();

#if defined(ESP32)
  WiFi.onEvent([](arduino_event_id_t, arduino_event_info_t info) {
    if (wifiQuiet) return;
    wifiReason = info.wifi_sta_disconnected.reason;
    wifiReasonCount = wifiReasonCount + 1;
  }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
#endif
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("\nWiFi \"%s\" 연결 중", WIFI_SSID);
  unsigned long wifiStart = millis();
  int wifiFails = 0;
#if defined(ESP32)
  int shownReason = -1;
#endif
  while (WiFi.status() != WL_CONNECTED) {
    led(true); delay(150); led(false); delay(150); Serial.print('.');
#if defined(ESP32)
    int r = wifiReason;   // 끊긴 이유가 바뀔 때마다 바로 보여 줌
    if (r && r != shownReason) { shownReason = r; Serial.printf("\n[WiFi] 끊김: 이유 %d (%s) %s\n", r, WiFi.disconnectReasonName((wifi_err_reason_t)r), reasonHelp(r)); }
#endif
    if (millis() - wifiStart > 20000) { wifiHelp(wifiFails++ % 3 == 0); wifiStart = millis(); }   // 목록은 1분마다
  }
  Serial.printf("\nWiFi 연결됨: %s\n", WiFi.localIP().toString().c_str());

  // HTTPS: 인증서 검사를 하지 않는 간단한 방식(학교 WiFi 안에서 사용). 보안을 높이려면 README 참고.
  tls.setInsecure();
#if !defined(ESP32)
  tls.setSession(&tlsSession);                 // 다시 접속할 때 빠르게
  if (tls.probeMaxFragmentLength(SERVER_HOST, 443, 1024)) tls.setBufferSizes(1024, 1024);
#endif
  pollDrive();
  doneRev = planRev;                           // 켜기 전에 남아 있던 계획은 다시 달리지 않는다
  Serial.printf("서버 연결됨 · 모드 %s\n", serverMode.c_str());
}

void loop() {
  serialCommands();
  if (WiFi.status() != WL_CONNECTED && state != ST_FOLLOW && state != ST_TEST) { stopMotors(); led(true); delay(200); return; }

  switch (state) {
    case ST_IDLE:
    case ST_ERROR:
      stopMotors();
      led(state == ST_ERROR ? (millis() / 200) % 2 : (millis() / 1000) % 2);
      if (millis() - lastPoll > POLL_IDLE_MS) {
        lastPoll = millis();
        if (pollDrive()) {
          bool moving = serverMode == "to_caller" || serverMode == "delivering" || serverMode == "guiding" || serverMode == "returning";
          if (moving && planLen >= 2 && planRev != doneRev) {
            if (state == ST_ERROR) Serial.println("[다시 시도] 새 계획");
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
        Serial.println("[계획 바뀜] 멈추고 다시 판단");
        state = ST_IDLE;
        if (moving && planLen >= 2) beginPlan();
      }
      break;
    }
    case ST_ELEVATOR:
      led((millis() / 500) % 2);
      elevatorStep();
      break;
    case ST_TEST:
      led((millis() / 100) % 2);
      testStep();
      break;
  }
}
