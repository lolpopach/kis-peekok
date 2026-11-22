// 펌웨어 호스트 시험: 서버 응답 해석, 회전 방향, 보고 내용, 엘리베이터 재출발
#include "../peekok-robot.ino"
#include <fstream>
#include <sstream>

unsigned long fake_millis = 0;
int fake_pins[32] = {0};
int fake_analog = 0;
int fake_pwm[32] = {0};
unsigned long fake_pulse_us = 0;
FakeSerial Serial;
FakeWiFi WiFi;
String fake_response;
int fake_code = 200;
String fake_last_path, fake_last_body;
static int fails = 0;
#define CHECK(c, msg) do { if (c) printf("  OK  %s\n", msg); else { printf("  ✗✗  %s\n", msg); fails++; } } while (0)

String readFile(const char* p) { std::ifstream f(p); std::stringstream ss; ss << f.rdbuf(); return String(ss.str()); }

int main(int argc, char** argv) {
  std::string dir = argc > 1 ? argv[1] : "samples";
  fake_pins[D3] = HIGH;   // FLASH 버튼은 평소 HIGH (풀업)
  speedDuty = 100;        // 시험은 끊어 가기 없이 (끊어 가기는 아래에서 따로)
  printf("== 서버 응답 해석 ==\n");
  CHECK(parseDrive(readFile((dir + "/idle.txt").c_str())), "대기 응답 읽기");
  CHECK(serverMode == "idle" && planLen == 0, "대기: 모드 idle, 노드 0");

  CHECK(parseDrive(readFile((dir + "/to_5-1.txt").c_str())), "5-1반 호출 응답 읽기");
  CHECK(serverMode == "to_caller", "모드 to_caller");
  CHECK(planLen == 17, "노드 17개");
  CHECK(strcmp(plan[0].key, "START") == 0 && plan[0].action == 's' && plan[0].heading == 'N', "첫 노드 START 출발 N");
  CHECK(strcmp(plan[7].key, "1:eL") == 0 && plan[7].action == 'E' && plan[7].toFloor == 2, "엘리베이터 노드 → 2층");
  CHECK(strcmp(plan[8].key, "2:eL") == 0 && plan[8].action == 'X', "엘리베이터 출구 노드");
  CHECK(strcmp(plan[16].key, "END") == 0 && plan[16].action == 'T', "마지막 END 정지");
  CHECK(plan[1].nextM > 24.2f && plan[1].nextM < 24.3f, "거리 24.24m 읽기");

  printf("== 같은 계획은 다시 읽지 않음 ==\n");
  String rev = planRev;
  plan[1].nextM = -1;  // 표시
  parseDrive(readFile((dir + "/to_5-1.txt").c_str()));
  CHECK(planRev == rev && plan[1].nextM == -1, "rev 가 같으면 노드 목록 유지");
  parseDrive(readFile((dir + "/deliver_health.txt").c_str()));
  CHECK(planRev != rev && planLen == 13 && serverMode == "delivering", "rev 가 바뀌면 새 계획(보건실 13노드)");

  printf("== 회전 방향 (방향 비교) ==\n");
  CHECK(turnFor('N', 'E') == 'R' && turnFor('N', 'W') == 'L' && turnFor('N', 'S') == 'U' && turnFor('E', 'E') == 'S', "N→E 우, N→W 좌, N→S 유턴, 그대로 직진");
  CHECK(turnFor('S', 'W') == 'R' && turnFor('W', 'S') == 'L', "S→W 우, W→S 좌");

  printf("== 서버 동작과 방향 비교가 맞는지 (경로 3개) ==\n");
  const char* files[] = {"to_5-1.txt", "deliver_health.txt", "to_12-5.txt"};
  for (const char* f : files) {
    parseDrive(String("ok\nrev 0\nnodes 0\nend\n"));
    planRev = "x";
    parseDrive(readFile((dir + "/" + f).c_str()));
    char h = plan[0].heading;
    int agree = 0, total = 0;
    for (int i = 1; i < planLen; i++) {
      const Node& n = plan[i];
      if (n.action == 'E' || n.action == 'T') continue;
      if (n.action == 'X') { h = n.heading; continue; }
      char byHeading = turnFor(h, n.heading);
      total++;
      if (byHeading == n.action) agree++;
      else printf("     %s: 서버 %c / 방향 비교 %c (대각선 구간 — 펌웨어는 서버 동작을 따름)\n", n.key, n.action, byHeading);
      h = n.heading;
    }
    printf("  %-20s 교차로 %d곳 중 %d곳 일치\n", f, total, agree);
  }

  printf("== 노드 보고 내용 ==\n");
  parseDrive(String("ok\nrev 0\nnodes 0\nend\n"));
  planRev = "y";
  parseDrive(readFile((dir + "/to_5-1.txt").c_str()));
  fake_response = readFile((dir + "/to_5-1.txt").c_str());
  reportPassed(1);
  CHECK(fake_last_path == "/api/robot/progress?fmt=text", "보고 주소 /api/robot/progress?fmt=text");
  CHECK(fake_last_body == String("{\"passed\":\"1:b2\",\"next\":\"1:b3\",\"speed\":") + String(ROBOT_SPEED_MPS, 2) + "}", "보고 내용 {passed, next, speed}");
  printf("     %s\n", fake_last_body.c_str());

  printf("== 엘리베이터: 로봇 화면의 '내렸어요' 로 재출발 ==\n");
  state = ST_ELEVATOR;
  legFrom = 7;
  fake_response = readFile((dir + "/elevator_out.txt").c_str());
  fake_millis += 5000;
  lastPoll = 0;
  elevatorStep();
  CHECK(state == ST_FOLLOW && legFrom == 8 && heading == 'S', "출구 2:eL 에서 S 방향으로 다시 출발");

  printf("== 엘리베이터: 버튼을 누르기 전에는 기다림 ==\n");
  state = ST_ELEVATOR;
  legFrom = 7;
  heading = 'N';
  fake_response = readFile((dir + "/to_5-1.txt").c_str());   // passed 가 아직 출구가 아님
  fake_millis += 5000;
  lastPoll = 0;
  elevatorStep();
  CHECK(state == ST_ELEVATOR && legFrom == 7, "버튼·화면 신호가 없으면 엘리베이터 앞에서 계속 기다림");
  CHECK(buttonPressed() == false, "FLASH 버튼은 평소 안 눌림 (HIGH)");
  fake_pins[D3] = LOW;
  CHECK(buttonPressed() == true, "FLASH 버튼 누르면 LOW = 눌림");
  fake_pins[D3] = HIGH;

  printf("== 모터: L298N EN(PWM) + IN(방향) 방식 ==\n");
  motor(5, 6, 7, 600, false);
  CHECK(fake_pins[5] == HIGH && fake_pins[6] == LOW && fake_pwm[7] == 600, "앞으로: IN1 HIGH · IN2 LOW · EN 600");
  motor(5, 6, 7, -500, false);
  CHECK(fake_pins[5] == LOW && fake_pins[6] == HIGH && fake_pwm[7] == 500, "뒤로: IN1 LOW · IN2 HIGH · EN 500");
  motor(5, 6, 7, 450, true);
  CHECK(fake_pins[5] == LOW && fake_pins[6] == HIGH && fake_pwm[7] == 450, "반대 설정(INVERT): 방향만 바뀜");
  motor(5, 6, 7, 0, false);
  CHECK(fake_pins[5] == LOW && fake_pins[6] == LOW && fake_pwm[7] == 0, "멈춤: IN 둘 다 LOW · EN 0");
  motor(5, 6, 7, 99999, false);
  CHECK(fake_pwm[7] == PWM_MAX, "세기는 PWM_MAX 까지");
  printf("== 모터: 바퀴가 안 도는 약한 세기(MIN_PWM %d) ==\n", (int)MIN_PWM);
  CHECK(deadzone(MIN_PWM - 10) == MIN_PWM && deadzone(-(MIN_PWM - 10)) == -MIN_PWM, "MIN_PWM 보다 조금 약하면 MIN_PWM 으로 올림");
  CHECK(deadzone(MIN_PWM / 4) == 0 && deadzone(0) == 0, "아주 약하면 0 (멈춤)");
  CHECK(deadzone(MIN_PWM + 50) == MIN_PWM + 50, "MIN_PWM 이상은 그대로");
  printf("== 모터: 점퍼 꽂은 방식(IN 핀에 PWM) ==\n");
  motor(8, 9, -1, 700, false);
  CHECK(fake_pwm[8] == 700 && fake_pwm[9] == 0, "앞으로: IN1 PWM · IN2 0");
  motor(8, 9, -1, -700, false);
  CHECK(fake_pwm[8] == 0 && fake_pwm[9] == 700, "뒤로: IN1 0 · IN2 PWM");

  printf("== 선 따라가기: 앞 두 센서 사이에 선 ==\n");
  fake_analog = 0;                                     // 옆 센서(ESP8266 은 오른쪽만, A0) 바닥
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = LOW;
  followReset();
  lineFollow(SPEED_PWM);
  CHECK(lastLeftPwm == SPEED_PWM && lastRightPwm == SPEED_PWM, "둘 다 바닥(선이 사이) → 곧장");
  fake_pins[PIN_FRONT_LEFT] = HIGH;
  lineFollow(SPEED_PWM);
  CHECK(lastLeftPwm < lastRightPwm && lastRightPwm - lastLeftPwm == 2 * STEER_MIN, "앞 왼쪽 검정 → 왼쪽으로 살살");
  fake_millis += STEER_RAMP_MS;
  lineFollow(SPEED_PWM);
  CHECK(lastLeftPwm == 0 && lastRightPwm == SPEED_PWM + STEER_MAX, "오래 이어지면 STEER_MAX 까지 세게 (안쪽 바퀴는 0 까지만)");
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = HIGH;
  lineFollow(SPEED_PWM);
  CHECK(lastLeftPwm > lastRightPwm && lastLeftPwm - lastRightPwm == 2 * STEER_MIN, "앞 오른쪽 검정 → 오른쪽으로 (세기 처음부터)");
  fake_pins[PIN_FRONT_LEFT] = HIGH;
  lineFollow(SPEED_PWM);
  CHECK(lastLeftPwm == lastRightPwm, "둘 다 검정(앞에 가로선) → 꺾지 않고 곧장");
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = LOW;

  printf("== 좌우 모터 힘 보정 ==\n");
  setTrim(0); drive(500, 500);
  CHECK(fake_pwm[PIN_LEFT_A] == 500 && fake_pwm[PIN_RIGHT_B] == 500, "보정 0: 양쪽 같은 세기 (오른쪽은 반대 배선이라 IN4 쪽)");
  setTrim(0.1f); drive(500, 500);
  CHECK(fake_pwm[PIN_LEFT_A] == 550 && fake_pwm[PIN_RIGHT_B] == 450, "보정 +0.1: 왼쪽 x1.1 · 오른쪽 x0.9");
  CHECK(lastLeftPwm == 500 && lastRightPwm == 500, "기록은 보정 전 세기");
  setTrim(5); CHECK(motorTrim == (float)TRIM_MAX, "보정 한계 TRIM_MAX");
  setTrim(-5); CHECK(motorTrim == -(float)TRIM_MAX, "보정 한계 -TRIM_MAX");
  setTrim(0);
  if (TRIM_LEARN > 0) {
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = LOW;
  followReset(); lineFollow(SPEED_PWM);
  fake_pins[PIN_FRONT_LEFT] = HIGH;                    // 앞 왼쪽만 자꾸 켜짐 = 오른쪽으로 쏠림 = 왼쪽이 셈
  for (int i = 0; i < 20; i++) { fake_millis += 10; lineFollow(SPEED_PWM); }
  float afterShort = motorTrim;
  CHECK(afterShort < 0 && afterShort > -0.01f, "짧은 바로잡기(왼쪽 센서) → 보정을 조금 줄임 (왼쪽을 약하게)");
  for (int i = 0; i < STEER_RAMP_MS / 10; i++) { fake_millis += 10; lineFollow(SPEED_PWM); }   // STEER_RAMP_MS 를 넘김
  float atRamp = motorTrim;
  for (int i = 0; i < 100; i++) { fake_millis += 10; lineFollow(SPEED_PWM); }
  CHECK(motorTrim == atRamp, "꺾기가 STEER_RAMP_MS 넘게 이어지면(곡선) 배우지 않음");
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = HIGH;
  float before = motorTrim;
  for (int i = 0; i < 20; i++) { fake_millis += 10; lineFollow(SPEED_PWM); }
  CHECK(motorTrim > before, "오른쪽 센서로 바로잡으면 반대로 (왼쪽을 세게)");
  fake_pins[PIN_FRONT_RIGHT] = LOW;
  }
  setTrim(0);

  printf("== 흔들림 줄이기: 바로잡기 끝나면 반대로 살짝 ==\n");
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = LOW;
  followReset(); lineFollow(SPEED_PWM);
  fake_pins[PIN_FRONT_RIGHT] = HIGH;
  for (int i = 0; i < 20; i++) { fake_millis += 10; lineFollow(SPEED_PWM); }  // 0.2초 오른쪽으로 바로잡기
  fake_pins[PIN_FRONT_RIGHT] = LOW;
  fake_millis += 10; lineFollow(SPEED_PWM);
  if (COUNTER_RATIO > 0) {
    CHECK(lastLeftPwm < lastRightPwm && lastRightPwm - lastLeftPwm == 2 * STEER_MIN, "선이 가운데로 돌아오면 → 왼쪽으로 살짝 (반대로)");
    fake_millis += (unsigned long)(200 * COUNTER_RATIO) + 20; lineFollow(SPEED_PWM);
  }
  CHECK(lastLeftPwm == lastRightPwm, "반대로 꺾기가 꺼져 있거나 시간이 지나면 곧장");
  setTrim(0);

  printf("== 교차로: 옆 센서 ==\n");
  junctionIgnoreMove = 0; moveMs = 0; junctionSince = 0;
  CHECK(!junctionSeen(true), "옆 센서가 바닥이면 교차로 아님");
  fake_pins[PIN_FRONT_LEFT] = HIGH; fake_pins[PIN_FRONT_RIGHT] = HIGH; fake_millis += 100;
  CHECK(!junctionSeen(true), "앞 센서만 검정이면 아직 교차로 아님 (옆 센서가 볼 때)");
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = LOW;
  CHECK(!sLeft(), "ESP8266: 왼쪽 옆 센서 없음(-1) → 항상 바닥");
  fake_pins[PIN_FRONT_RIGHT] = HIGH; junctionSeen(true); fake_pins[PIN_FRONT_RIGHT] = LOW;   // 앞 오른쪽이 먼저 지나감
  frontBothMove = 0; decideStart = 0;
  fake_analog = 1000;                                  // 오른쪽 옆 센서 검정
  CHECK(!junctionSeen(true), "옆 센서가 막 켜짐 → 아직 (잡음 거르기)");
  fake_millis += JUNCTION_MS;
  CHECK(!junctionSeen(true), "JUNCTION_MS 이어지면 후보 → 반대쪽 기다림");
  moveMs += DECIDE_MS + 1; fake_millis += 10;
  CHECK(junctionSeen(true) && junctionR && !junctionL, "DECIDE_MS 뒤 결정: 뒤 오른쪽만 → 오른쪽 분기");
  CHECK(!junctionSeen(false), "서버 주행에서 예상 시간 전(문 닫힘)이면 무시");
  junctionIgnoreMove = moveMs + 100; junctionSince = 0;
  fake_millis += JUNCTION_MS + 10;
  CHECK(!junctionSeen(true), "회전 직후(JUNCTION_COOLDOWN_MS)는 무시");
  fake_analog = 0;

  printf("== 장애물: 초음파 ==\n");
  blocked = false; nearCount = farCount = 0;
  CHECK(!obstacleUpdate(12), "가까움 1번은 아직 (잡음)");
  CHECK(obstacleUpdate(12), "가까움 2번 연속 → 멈춤");
  CHECK(obstacleUpdate(-1) && obstacleUpdate(50) && obstacleUpdate(-1), "멂 3번까지는 계속 멈춤");
  CHECK(!obstacleUpdate(60), "멂 4번 연속 → 다시 출발");
  CHECK(!obstacleUpdate(25) && !obstacleUpdate(25), "멈춤·출발 거리 사이(25cm)는 상태 유지");
  fake_pulse_us = 10 * 58;
  CHECK(sonarCm() == (PIN_SONAR_TRIG < 0 ? -1 : 10), "메아리 580us = 10cm (초음파 없는 보드는 -1)");
  fake_pulse_us = 0;

  printf("== 코스 시험 (서버 없이) ==\n");
  testRoute = "RE";
  testStart();
  CHECK(state == ST_TEST && routeIdx == 0, "시작");
  fake_millis += 1000;
  testEvent();   // R: 회전 중 앞 오른쪽 센서가 계속 바닥 → 선을 못 찾음
  CHECK(state == ST_IDLE && routeIdx == 1, "회전하다 선을 못 찾으면 멈춤");
  testRoute = "E";
  testStart();
  testEvent();
  CHECK(state == ST_IDLE && routeIdx == 1, "E: 정지 (완료)");
  testRoute = "S";
  testStart();
  fake_millis += TEST_GIVEUP_MS + 1;
  testStep();
  CHECK(state == ST_IDLE, "표시를 너무 오래 못 만나면 멈춤 (선 벗어나 계속 달리지 않게)");
  testRoute = TEST_ROUTE;

  printf("== 선 따라가기 시험 (t) ==\n");
  setTrim(0);
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = LOW;
  traceStart();
  for (int i = 0; i < 80; i++) { fake_millis += 10; traceStep(); }            // 0.8초 가운데
  fake_pins[PIN_FRONT_LEFT] = HIGH;
  for (int i = 0; i < 10; i++) { fake_millis += 10; traceStep(); }            // 0.1초 왼쪽 바로잡기
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = HIGH;
  for (int i = 0; i < 10; i++) { fake_millis += 10; traceStep(); }            // 0.1초 오른쪽
  fake_pins[PIN_FRONT_RIGHT] = LOW;
  CHECK(state == ST_TRACE && tracePct(0) >= 75 && tracePct(1) >= 8 && tracePct(2) >= 8, "가운데·왼쪽·오른쪽 시간 비율");
  CHECK(traceSwitches == 1 && traceLongest >= 90 && traceLongest <= 110, "지그재그 1번 · 가장 긴 꺾기 약 0.1초");
  fake_pins[PIN_FRONT_LEFT] = HIGH;
  for (int i = 0; i < TRACE_LOST_MS / 10 + 5 && state == ST_TRACE; i++) { fake_millis += 10; traceStep(); }
  CHECK(state == ST_IDLE, "한쪽 꺾기가 TRACE_LOST_MS 넘으면 선을 놓친 것으로 멈춤");
  fake_pins[PIN_FRONT_LEFT] = LOW;
  traceStart();
  for (int i = 0; i < TRACE_MS / 50 + 5 && state == ST_TRACE; i++) { fake_millis += 50; traceStep(); }
  CHECK(state == ST_IDLE, "TRACE_MS 가 지나면 멈춤");
  setTrim(0);

  printf("== 회전 뒤: 옆 센서가 바닥을 본 뒤에야 다음 교차로 ==\n");
  junctionArmed = false; sideClearSince = 0; junctionIgnoreMove = 0; junctionSince = 0;
  fake_analog = 1000;                          // 회전 직후 옆 센서가 방금 지난 선 위
  for (int i = 0; i < 50; i++) { fake_millis += 10; moveMs += 10; CHECK(i < 49 || !junctionSeen(true), "옆 센서가 선 위에 계속 있으면 교차로로 안 셈"); }
  fake_analog = 0;
  for (int i = 0; i < 12; i++) { fake_millis += 10; moveMs += 10; junctionSeen(true); }
  CHECK(junctionArmed, "바닥을 0.1초 보면 다시 셀 준비");
  fake_pins[PIN_FRONT_RIGHT] = HIGH; junctionSeen(true); fake_pins[PIN_FRONT_RIGHT] = LOW;
  fake_analog = 1000; junctionSeen(true); fake_millis += JUNCTION_MS; moveMs += JUNCTION_MS;
  junctionSeen(true); moveMs += DECIDE_MS + 1; fake_millis += 10;
  CHECK(junctionSeen(true), "그 다음 선 = 다음 교차로");
  fake_analog = 0;

  if (RECOVER_ENABLE) {
  printf("== 선 되찾기: 뒤 센서는 방향만, 다시 잡는 건 앞 센서 ==\n");
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = LOW;
  followReset();
  fake_analog = 1000; fake_millis += 10; lineFollow(SPEED_PWM, true); fake_millis += RECOVER_CONFIRM_MS; lineFollow(SPEED_PWM, true);
  CHECK(recoverDir == 0, "앞 센서가 선을 가운데 두고 있을 때 뒤 센서만 선을 보면 꺾지 않음");
  fake_analog = 0; followReset();
  fake_pins[PIN_FRONT_RIGHT] = HIGH; fake_millis += 10; lineFollow(SPEED_PWM, true);   // 앞 오른쪽이 선을 보고 바로잡던 중
  fake_pins[PIN_FRONT_RIGHT] = LOW;
  fake_analog = 1000;                           // 선이 앞 오른쪽 바깥으로 빠져 뒤 오른쪽이 봄
  fake_millis += 10; lineFollow(SPEED_PWM, true);
  CHECK(recoverDir == 0, "뒤 센서가 막 봤을 땐 아직 (잡음 거르기)");
  fake_millis += RECOVER_CONFIRM_MS; lineFollow(SPEED_PWM, true);
  CHECK(recoverDir == 1 && lastLeftPwm > lastRightPwm, "뒤 오른쪽 쪽으로 크게 꺾기 시작");
  fake_analog = 0;                              // 뒤 센서가 선을 벗어남
  fake_millis += 10; lineFollow(SPEED_PWM, true);
  CHECK(recoverDir == 1 && lastLeftPwm > lastRightPwm, "뒤 센서가 벗어나도 앞 센서가 잡을 때까지 계속 꺾기");
  fake_pins[PIN_FRONT_RIGHT] = HIGH;            // 앞 오른쪽이 선을 다시 잡음
  fake_millis += 10; lineFollow(SPEED_PWM, true);
  CHECK(recoverDir == 0 && lastLeftPwm - lastRightPwm == 2 * STEER_MIN, "앞 센서가 잡으면 평소 따라가기로");
  fake_pins[PIN_FRONT_RIGHT] = LOW;
  followReset(); fake_analog = 1000; fake_millis += 10; lineFollow(SPEED_PWM, false);
  CHECK(recoverDir == 0 && lastLeftPwm == lastRightPwm, "분기 시험·서버 주행(sideRecover 끔)에서는 뒤 센서로 꺾지 않음");
  fake_analog = 0;
  }

  printf("== 분기는 앞 → 뒤 순서로 ==\n");
  junctionArmed = true; junctionIgnoreMove = 0; junctionSince = 0; frontRSeenMove = 0;
  fake_analog = 1000;                          // 앞 오른쪽이 본 적 없이 뒤 오른쪽만
  for (int i = 0; i < 10; i++) { fake_millis += 10; moveMs += 10; }
  CHECK(!junctionSeen(true) && !junctionSeen(true), "뒤 오른쪽만 선을 보면(앞 오른쪽이 안 지나감) 잡음으로 무시");
  fake_analog = 0;
  fake_pins[PIN_FRONT_RIGHT] = HIGH; junctionSeen(true); fake_pins[PIN_FRONT_RIGHT] = LOW;
  moveMs += BRANCH_PAIR_MS + 10; fake_analog = 1000; junctionSeen(true); fake_millis += JUNCTION_MS;
  CHECK(!junctionSeen(true), "앞 오른쪽을 본 지 너무 오래됐으면 무시");
  fake_analog = 0; junctionSince = 0;

  printf("== 뒤로 가며 앞 센서로 선 맞추기 ==\n");
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = LOW; revSide = 0;
  reverseFollow(400);
  CHECK(lastLeftPwm == -400 && lastRightPwm == -400, "앞 센서 둘 다 바닥 → 곧장 뒤로");
  fake_pins[PIN_FRONT_LEFT] = HIGH; fake_millis += 10; reverseFollow(400);
  CHECK(lastLeftPwm < lastRightPwm && lastLeftPwm < 0 && lastRightPwm <= 0, "앞 왼쪽 검정 → 앞으로 갈 때처럼 왼쪽으로 돌림 (왼쪽 바퀴가 더 빨리 뒤로)");
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = HIGH; fake_millis += 10; reverseFollow(400);
  CHECK(lastLeftPwm > lastRightPwm && lastLeftPwm <= 0, "앞 오른쪽 검정 → 오른쪽으로 돌림");
  fake_pins[PIN_FRONT_RIGHT] = LOW;

  printf("== 깜빡임 거르기 (떠 있는 핀) ==\n");
  { Flicker f = {false, {0, 0, 0, 0}, 0, false}; bool any = false;
    for (int i = 0; i < 20; i++) { fake_millis += 100; if (steadyRead(f, i % 2 == 0, "시험")) any = (i > 4) ? true : any; }
    CHECK(!any && f.noisy, "0.1초마다 바뀌면 깜빡임으로 보고 무시");
    fake_millis += FLICKER_MS + 10;
    CHECK(steadyRead(f, true, "시험") == true && !f.noisy, "1초 동안 안정되면 다시 씀");
    Flicker g = {false, {0, 0, 0, 0}, 0, false};
    fake_millis += 10; steadyRead(g, true, "시험"); fake_millis += 200;
    CHECK(steadyRead(g, true, "시험") == true, "진짜 선(한 번 켜짐)은 그대로");
    fake_millis += 100; steadyRead(g, false, "시험"); }

  printf("== T자 판단: 앞 센서 둘이 동시에 검정 → T자 ==\n");
  junctionArmed = true; junctionIgnoreMove = 0; junctionSince = 0; decideStart = 0; frontBothMove = 0; fake_analog = 0;
  fake_pins[PIN_FRONT_LEFT] = HIGH; fake_pins[PIN_FRONT_RIGHT] = HIGH; junctionSeen(true);   // 가로선을 앞 센서 둘이 지남
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = LOW; moveMs += 100;
  fake_analog = 1000; junctionSeen(true); fake_millis += JUNCTION_MS; junctionSeen(true); moveMs += DECIDE_MS + 1; fake_millis += 10;
  CHECK(junctionSeen(true) && junctionL && junctionR, "뒤 한쪽만 봐도 직전에 앞 둘이 동시에 검정이면 T자");
  fake_analog = 0;

  printf("== 제자리 회전 방향 ==\n");
  fake_pins[PIN_FRONT_LEFT] = LOW; fake_pins[PIN_FRONT_RIGHT] = LOW;
  spinDrive(1);
  CHECK(lastLeftPwm > 0 && lastRightPwm < 0, "우회전 = 왼쪽 바퀴 앞으로 · 오른쪽 바퀴 뒤로");
  spinDrive(-1);
  CHECK(lastLeftPwm < 0 && lastRightPwm > 0, "좌회전 = 왼쪽 바퀴 뒤로 · 오른쪽 바퀴 앞으로");

  printf("== 멈춤 시험 (h): 분기를 알아보면 멈춤 ==\n");
  testRoute = "!";
  testStart();
  junctionL = false; junctionR = true;
  testEvent();
  CHECK(state == ST_IDLE && routeIdx == 1, "분기에서 돌지 않고 멈춤");
  testRoute = TEST_ROUTE;

  printf("== 분기 시험 (j): 옆에 선이 보인 쪽으로 ==\n");
  testRoute = "??";
  testStart();
  junctionL = false; junctionR = true;
  testEvent();   // R 로 돌다가(가짜 센서는 바닥) 선을 못 찾음 → 멈춤. 어느 쪽으로 돌기로 했는지만 확인
  CHECK(routeIdx == 1 && state == ST_IDLE, "오른쪽 옆 센서 → 우회전 시도");
  testStart();
  junctionL = true; junctionR = true;
  testEvent();
  CHECK(state == ST_IDLE, "양쪽 옆 센서 → 멈춤");
  testRoute = TEST_ROUTE;

  printf("== 느리게 달리기 (끊어 가기) ==\n");
  speedDuty = 30; fake_millis = 1000000; moveLastAt = 0;
  { unsigned long m0 = moveMs; int on = 0;
    int n = 2 * PULSE_MS, want = n * 30 / 100;
    for (int i = 0; i < n; i++) { fake_millis += 1; driveP(500, 500); if (fake_pwm[PIN_LEFT_A] > 0) on++; }
    CHECK(on >= want - 10 && on <= want + 10, "PULSE_MS 주기 중 약 30% 만 바퀴를 돌림");
    CHECK((int)(moveMs - m0) >= want - 10 && (int)(moveMs - m0) <= want + 10, "움직인 시간(moveMs)은 돌린 시간만 셈");
    CHECK(lastLeftPwm == 500, "멈춘 동안에도 기록은 정한 세기"); }
  { unsigned long m0 = moveMs, t0 = fake_millis; forwardFor(200);
    CHECK(moveMs - m0 >= 200 && fake_millis - t0 >= 450, "회전 전 전진 200ms = 돌린 시간 200ms (실제로는 2~3배 걸림)"); }
  speedDuty = 100;

  printf("== WiFi 이름 비교 (iPhone ’ 따옴표·대소문자·띄어쓰기) ==\n");
  {
    char a[48], b[48];
    ssidKey("Chan\xE2\x80\x99s iPhone", a, sizeof a);
    ssidKey("chan's iphone", b, sizeof b);
    CHECK(strcmp(a, b) == 0 && strcmp(a, "chansiphone") == 0, "’ 와 ' · 대소문자 · 띄어쓰기만 다르면 비슷한 이름");
    ssidKey("PEEKOK-2G", a, sizeof a);
    ssidKey("PEEKOK-5G", b, sizeof b);
    CHECK(strcmp(a, b) != 0, "다른 이름은 다르게");
    CHECK(strcmp(encName(ENC_TYPE_NONE), "비밀번호 없음") == 0, "보안 방식 이름");
    CHECK(strstr(reasonHelp(15), "비밀번호") && strstr(reasonHelp(202), "비밀번호") && reasonHelp(999)[0] == 0, "끊긴 이유 15·202 → 비밀번호 안내");
  }
  printf("\n%s (%d개 실패)\n", fails ? "실패 있음" : "모두 통과", fails);
  return fails ? 1 : 0;
}
