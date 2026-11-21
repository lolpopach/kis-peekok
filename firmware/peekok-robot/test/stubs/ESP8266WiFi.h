#pragma once
#include "Arduino.h"
#define WL_CONNECTED 3
#define WIFI_STA 1
struct IPAddress { String toString() const { return String("10.0.0.2"); } };
struct FakeWiFi {
  int st = WL_CONNECTED;
  void mode(int) {}
  void begin(const char*, const char*) {}
  int status() { return st; }
  IPAddress localIP() { return IPAddress(); }
};
extern FakeWiFi WiFi;
class WiFiClient {};
