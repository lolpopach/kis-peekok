#pragma once
#include "Arduino.h"
#define WL_NO_SSID_AVAIL 1
#define WL_CONNECTED 3
#define WL_CONNECT_FAILED 4
#define ENC_TYPE_WEP 5
#define ENC_TYPE_CCMP 4
#define ENC_TYPE_NONE 7
#define WIFI_STA 1
struct IPAddress { String toString() const { return String("10.0.0.2"); } };
struct FakeWiFi {
  int st = WL_CONNECTED;
  void mode(int) {}
  void begin(const char*, const char*) {}
  int status() { return st; }
  IPAddress localIP() { return IPAddress(); }
  void disconnect() {}
  int scanNetworks() { return 0; }
  String SSID(int) { return String(); }
  int RSSI(int) { return 0; }
  int encryptionType(int) { return ENC_TYPE_CCMP; }
  void scanDelete() {}
};
extern FakeWiFi WiFi;
class WiFiClient {};
