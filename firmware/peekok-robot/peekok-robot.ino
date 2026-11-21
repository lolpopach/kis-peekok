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
 * 시리얼(115200): s 센서 보기 · f 앞으로 · l/r 제자리 회전 · c 속도 재기(5초 직진) · p 계획 보기 · x 멈춤
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
enum State { ST_IDLE, ST_FOLLOW, ST_ELEVATOR, ST_ERROR };
State state = ST_IDLE;
int legFrom = 0;              // 지금 달리는 구간: plan[legFrom] → plan[legFrom + 1]
char heading = HOME_HEADING;  // 지금 바라보는 도면 방향
unsigned long legStart = 0;   // 구간 시작 시각
unsigned long legExpected = 0;// 구간 예상 시간(ms)
unsigned long junctionSince = 0;
unsigned long lineSeenAt = 0;
int lastSteer = 0;            // 마지막으로 선이 보인 쪽 (-1 왼쪽, 1 오른쪽)
unsigned long lastPoll = 0;

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
bool sLeft() { return SENSOR_LEFT_ANALOG ? readAnalogLine(PIN_SENSOR_LEFT, LEFT_ANALOG_THRESHOLD) : readLine(PIN_SENSOR_LEFT); }
bool sMid() { return SENSOR_MID_ANALOG ? readAnalogLine(PIN_SENSOR_MID, MID_ANALOG_THRESHOLD) : readLine(PIN_SENSOR_MID); }
bool sRight() { return SENSOR_RIGHT_ANALOG ? readAnalogLine(PIN_SENSOR_RIGHT, RIGHT_ANALOG_THRESHOLD) : readLine(PIN_SENSOR_RIGHT); }

void motor(int pinA, int pinB, int v, bool invert) {
  v = constrain(v, -PWM_MAX, PWM_MAX);
  if (invert) v = -v;
  if (v >= 0) { analogWrite(pinA, v); analogWrite(pinB, 0); }
  else { analogWrite(pinA, 0); analogWrite(pinB, -v); }
}
void drive(int left, int right) {
  motor(PIN_LEFT_A, PIN_LEFT_B, left, LEFT_INVERT);
  motor(PIN_RIGHT_A, PIN_RIGHT_B, right, RIGHT_INVERT);
}
void stopMotors() { drive(0, 0); }
void led(bool on) { digitalWrite(PIN_LED, on ? LED_ON : LED_OFF); }
bool buttonPressed() { return digitalRead(PIN_BUTTON) == LOW; }

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
bool spinToLine(int dir, unsigned long minMs) {
  drive(dir * -TURN_PWM, dir * TURN_PWM);
  unsigned long t0 = millis();
  bool leftLine = false;
  while (millis() - t0 < TURN_TIMEOUT_MS) {
    bool c = sMid();
    if (!c) leftLine = true;
    if (leftLine && c && millis() - t0 >= minMs) { stopMotors(); return true; }
    yield();
  }
  stopMotors();
  return false;
}
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
  else if (t == 'L' || t == 'R') { forwardFor(TURN_FORWARD_MS); ok = spinToLine(t == 'L' ? -1 : 1, 120); }
  else if (t == 'U') { ok = spinToLine(1, UTURN_MIN_MS); }
  if (ok && want != '-') heading = want;
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
  bool l = sLeft(), c = sMid(), r = sRight();
  unsigned long now = millis();
  bool finalLeg = (legFrom + 1 == planLen - 1);   // 다음이 END 면 시간으로 멈춘다
  if (finalLeg && now - legStart >= legExpected) { arriveEnd(); return; }

  // 교차로 감지: 양쪽이 함께 보이거나, 가운데와 한쪽이 JUNCTION_MS 이상 함께 보임
  bool junction = (l && r) || (c && (l || r));
  if (!finalLeg && junction && now - legStart > (unsigned long)(legExpected * JUNCTION_GATE)) {
    if (!junctionSince) junctionSince = now;
    if (now - junctionSince >= JUNCTION_MS) { atNode(legFrom + 1); return; }
  } else {
    junctionSince = 0;
  }

  // 라인 따라가기
  if (l || c || r) lineSeenAt = now;
  if (c && !l && !r) drive(SPEED_PWM, SPEED_PWM);
  else if (l && !r) { drive(STEER_PWM, SPEED_PWM); lastSteer = -1; }
  else if (r && !l) { drive(SPEED_PWM, STEER_PWM); lastSteer = 1; }
  else if (!l && !c && !r) {
    if (now - lineSeenAt > LOST_LINE_MS) { stopMotors(); state = ST_ERROR; Serial.println("[오류] 선을 잃었어요"); return; }
    if (lastSteer < 0) drive(STEER_PWM, SPEED_PWM); else if (lastSteer > 0) drive(SPEED_PWM, STEER_PWM);
  } else {
    drive(SPEED_PWM, SPEED_PWM);
  }
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
    for (int i = 0; i < 50; i++) {
      Serial.printf("왼쪽 %d(%d)  가운데 %d(%d)  오른쪽 %d(%d)  — 괄호는 아날로그 핀일 때만 원값, 문턱값은 config.h 에서 조정\n",
        sLeft(), SENSOR_LEFT_ANALOG ? analogRead(PIN_SENSOR_LEFT) : -1,
        sMid(), SENSOR_MID_ANALOG ? analogRead(PIN_SENSOR_MID) : -1,
        sRight(), SENSOR_RIGHT_ANALOG ? analogRead(PIN_SENSOR_RIGHT) : -1);
      delay(100);
    }
  } else if (ch == 'f') forwardFor(1000);
  else if (ch == 'l') { drive(-TURN_PWM, TURN_PWM); delay(500); stopMotors(); }
  else if (ch == 'r') { drive(TURN_PWM, -TURN_PWM); delay(500); stopMotors(); }
  else if (ch == 'c') {
    Serial.println("5초 동안 라인을 따라 직진합니다. 간 거리(m) ÷ 5 = ROBOT_SPEED_MPS");
    unsigned long t0 = millis();
    while (millis() - t0 < 5000) {
      bool l = sLeft(), r = sRight();
      if (l && !r) drive(STEER_PWM, SPEED_PWM); else if (r && !l) drive(SPEED_PWM, STEER_PWM); else drive(SPEED_PWM, SPEED_PWM);
      yield();
    }
    stopMotors();
  } else if (ch == 'p') {
    Serial.printf("모드 %s · rev %s · 방향 %c\n", serverMode.c_str(), planRev.c_str(), heading);
    for (int i = 0; i < planLen; i++) Serial.printf("  %-8s %c %c %.2fm %d\n", plan[i].key, plan[i].action, plan[i].heading, plan[i].nextM, plan[i].toFloor);
  } else if (ch == 'x') { stopMotors(); state = ST_IDLE; }
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
const char* encName(int t) {
#if defined(ESP32)
  if (t == WIFI_AUTH_OPEN) return "비밀번호 없음";
  if (t == WIFI_AUTH_WEP) return "WEP(오래된 방식)";
  if (t == WIFI_AUTH_WPA2_ENTERPRISE) return "아이디+비밀번호(엔터프라이즈) - 펌웨어 기능 추가 필요";
  if (t == WIFI_AUTH_WPA3_PSK) return "비밀번호(WPA3)";
#else
  if (t == ENC_TYPE_NONE) return "비밀번호 없음";
  if (t == ENC_TYPE_WEP) return "WEP(오래된 방식)";
#endif
  return "비밀번호(WPA/WPA2)";
}
void wifiHelp() {
  int st = WiFi.status();
  Serial.printf("\n[WiFi] \"%s\" 에 20초 동안 못 붙었어요 (상태 %d%s)\n", WIFI_SSID, st,
    st == WL_NO_SSID_AVAIL ? ": 이 이름의 WiFi 가 안 보임" : st == WL_CONNECT_FAILED ? ": 비밀번호가 틀렸거나 지원하지 않는 방식" : "");
  if (strcmp(WIFI_SSID, "학교WiFi이름") == 0) Serial.println("[WiFi] config.h 의 WIFI_SSID·WIFI_PASS 를 아직 안 고쳤어요 (config.h 가 없으면 config.example.h 로 올라감)");
  WiFi.disconnect();
  delay(200);
  int n = WiFi.scanNetworks();
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
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WiFi] 다시 연결 중");
}

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n피콕 로봇 몸체 시작");
  pinMode(PIN_LEFT_A, OUTPUT); pinMode(PIN_LEFT_B, OUTPUT);
  pinMode(PIN_RIGHT_A, OUTPUT); pinMode(PIN_RIGHT_B, OUTPUT);
  pinMode(PIN_SENSOR_LEFT, INPUT); pinMode(PIN_SENSOR_MID, INPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
#if !defined(ESP32)
  analogWriteRange(PWM_MAX);   // ESP32 는 기본 8비트(0~255)·1kHz 그대로 씀 (PWM_MAX 와 맞춰 둠)
  analogWriteFreq(1000);
#endif
  stopMotors();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("\nWiFi \"%s\" 연결 중", WIFI_SSID);
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED) {
    led(true); delay(150); led(false); delay(150); Serial.print('.');
    if (millis() - wifiStart > 20000) { wifiHelp(); wifiStart = millis(); }
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
  if (WiFi.status() != WL_CONNECTED && state != ST_FOLLOW) { stopMotors(); led(true); delay(200); return; }

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
  }
}
