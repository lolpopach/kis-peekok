#pragma once
#include "ESP8266WiFi.h"
// 시험용: 요청을 기록하고, 미리 정한 응답을 돌려준다
extern String fake_response;
extern int fake_code;
extern String fake_last_path;
extern String fake_last_body;
class HTTPClient {
 public:
  void setReuse(bool) {}
  void setTimeout(int) {}
  bool begin(WiFiClient&, const String&, uint16_t, const String& uri, bool) { fake_last_path = uri; return true; }
  void addHeader(const char*, const char*) {}
  int GET() { return fake_code; }
  int POST(const String& b) { fake_last_body = b; return fake_code; }
  String getString() { return fake_response; }
  void end() {}
};
