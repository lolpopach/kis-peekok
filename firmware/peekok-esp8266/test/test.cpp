// 펌웨어 호스트 시험: 서버 응답 해석, 회전 방향, 보고 내용, 엘리베이터 재출발
#include "../peekok-esp8266.ino"
#include <fstream>
#include <sstream>

unsigned long fake_millis = 0;
int fake_pins[32] = {0};
int fake_analog = 0;
int fake_pwm[32] = {0};
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
  CHECK(fake_last_body == "{\"passed\":\"1:b2\",\"next\":\"1:b3\",\"speed\":0.50}", "보고 내용 {passed, next, speed}");
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

  printf("\n%s (%d개 실패)\n", fails ? "실패 있음" : "모두 통과", fails);
  return fails ? 1 : 0;
}
