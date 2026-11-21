#pragma once
#include "ESP8266WiFi.h"
namespace BearSSL {
class Session {};
class WiFiClientSecure : public WiFiClient {
 public:
  void setInsecure() {}
  void setSession(Session*) {}
  bool probeMaxFragmentLength(const char*, uint16_t, uint16_t) { return false; }
  void setBufferSizes(int, int) {}
};
}  // namespace BearSSL
