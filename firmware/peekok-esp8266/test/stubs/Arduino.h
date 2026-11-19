// 호스트(PC)에서 펌웨어 문법·논리를 시험하기 위한 아주 작은 Arduino/ESP8266 흉내
#pragma once
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <cstdarg>
#include <string>
#include <algorithm>

#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
enum { D0 = 16, D1 = 5, D2 = 4, D3 = 0, D4 = 2, D5 = 14, D6 = 12, D7 = 13, D8 = 15, A0 = 17 };

template <class T, class L, class H> T constrain(T v, L lo, H hi) { return v < lo ? lo : v > hi ? hi : v; }

extern unsigned long fake_millis;
extern int fake_pins[32];
extern int fake_analog;
extern int fake_pwm[32];
inline unsigned long millis() { return fake_millis; }
inline void delay(unsigned long ms) { fake_millis += ms; }
inline void yield() { fake_millis += 1; }
inline void pinMode(int, int) {}
inline int digitalRead(int p) { return fake_pins[p]; }
inline void digitalWrite(int p, int v) { fake_pins[p] = v; }
inline int analogRead(int) { return fake_analog; }
inline void analogWrite(int p, int v) { fake_pwm[p] = v; }
inline void analogWriteRange(int) {}
inline void analogWriteFreq(int) {}

class String {
 public:
  std::string s;
  String() {}
  String(const char* c) : s(c ? c : "") {}
  String(const std::string& x) : s(x) {}
  String(char c) : s(1, c) {}
  String(int v) : s(std::to_string(v)) {}
  String(float v, int dec) { char b[32]; snprintf(b, sizeof b, "%.*f", dec, v); s = b; }
  String(double v, int dec) { char b[32]; snprintf(b, sizeof b, "%.*f", dec, v); s = b; }
  unsigned int length() const { return s.size(); }
  const char* c_str() const { return s.c_str(); }
  int indexOf(char c, unsigned int from = 0) const { auto p = s.find(c, from); return p == std::string::npos ? -1 : (int)p; }
  String substring(unsigned int a) const { return a >= s.size() ? String() : String(s.substr(a)); }
  String substring(unsigned int a, unsigned int b) const { if (a > s.size()) return String(); return String(s.substr(a, std::min<size_t>(b, s.size()) - a)); }
  void trim() { size_t a = s.find_first_not_of(" \t\r\n"); size_t b = s.find_last_not_of(" \t\r\n"); s = a == std::string::npos ? "" : s.substr(a, b - a + 1); }
  bool startsWith(const char* p) const { return s.rfind(p, 0) == 0; }
  long toInt() const { return atol(s.c_str()); }
  float toFloat() const { return (float)atof(s.c_str()); }
  void toCharArray(char* buf, unsigned int n) const { strncpy(buf, s.c_str(), n - 1); buf[n - 1] = 0; }
  char operator[](unsigned int i) const { return i < s.size() ? s[i] : 0; }
  bool operator==(const String& o) const { return s == o.s; }
  bool operator==(const char* o) const { return s == o; }
  bool operator!=(const String& o) const { return s != o.s; }
  bool operator!=(const char* o) const { return s != o; }
  String& operator+=(const String& o) { s += o.s; return *this; }
  friend String operator+(const String& a, const String& b) { return String(a.s + b.s); }
  friend String operator+(const String& a, const char* b) { return String(a.s + b); }
  friend String operator+(const char* a, const String& b) { return String(std::string(a) + b.s); }
};

struct FakeSerial {
  void begin(int) {}
  int available() { return 0; }
  int read() { return -1; }
  void print(const char* t) { fputs(t, stdout); }
  void print(char c) { fputc(c, stdout); }
  void println(const char* t) { puts(t); }
  void printf(const char* f, ...) { va_list a; va_start(a, f); vprintf(f, a); va_end(a); }
};
extern FakeSerial Serial;
