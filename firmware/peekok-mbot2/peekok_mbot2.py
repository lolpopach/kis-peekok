# -*- coding: utf-8 -*-
# 피콕 로봇 몸체 — Makeblock mBot2 (CyberPi MicroPython)
#
# ESP32 펌웨어(firmware/peekok-robot)와 똑같은 서버 약속(글자 형식 API, docs/robot-api.md)으로 말한다.
#   GET  /api/robot/drive              지금 모드·계획 받기 (1.5초마다)
#   POST /api/robot/progress?fmt=text  갈림길(노드)을 지날 때마다
#   POST /api/robot/arrived?fmt=text   끝(T 가로선)에 닿으면
#   POST /api/robot/log?fmt=text       멈춰 있을 때 모아 둔 기록(클라우드에서 원인 보기)
# 요청마다 X-Robot-Body: mbot2 를 붙여 로봇 화면에 "로봇 몸체(mBot2) 연결됨" 이 뜬다.
#
# 올리기: config.py 를 채운 뒤 `python tools/build.py` → dist/upload.py 를 mBlock(mLink) Python 편집기에서 열고 "업로드".
# (이 파일을 그대로 올려도 되지만 그때는 아래 설정의 WiFi·로봇 키를 직접 채워야 함 — 이 파일은 저장소에 올라가니 비워 두기)
#
# CyberPi 버튼 (대기 중)
#   A        선 따라가기 시험 (2초 뒤 출발, 다시 A·B 로 멈춤)
#   B        점검: 센서·자이로·바퀴 방향 (바퀴가 살짝 돎 — 바닥에 두고)
#   가운데(조이스틱 누름)  코스 시험 TEST_ROUTE (서버 없이)
# 달리는 중: B = 멈춤.  엘리베이터 앞: A = 내렸어요(다시 출발)
#
# MicroPython 호환: f-문자열·타입 표기·dataclass 를 쓰지 않는다.

# ---- 설정 시작 ---- (tools/build.py 가 config.py 값을 이 아래에 덧붙여 덮어씀)
WIFI_SSID = ""
WIFI_PASS = ""
ROBOT_KEY = ""                 # Cloudflare 비밀값 ROBOT_KEY 와 같은 값
SERVER_HOST = "kis-peekok.pages.dev"
SERVER_PORT = 443
USE_TLS = True

HOME_HEADING = "E"             # 켤 때 로봇이 보는 도면 방향 (제자리 12-5 앞에서 동쪽)
TEST_ROUTE = "RURLE"           # 코스 시험: 갈림길마다 S 직진 · L · R · U 유턴 · V 도착 후 유턴 · E 멈춤

# 몸 크기 (mBot2 기본: 바퀴 지름 6.5cm, 두 바퀴 사이 11.5cm, 바퀴 축 → 쿼드 RGB 센서 7cm)
WHEEL_DIAM_CM = 6.5
WHEEL_BASE_CM = 11.5
SENSOR_AHEAD_CM = 7.0
TAPE_CM = 1.9                  # 바닥 검정 테이프 폭

# 바퀴 방향: mbot2.drive_speed(왼쪽, 오른쪽) 에 곱함. mBot2 는 오른쪽 모터가 거꾸로 달려 앞으로 = (+, -)
# B 점검이 자이로로 확인해 peekok_cal.txt 에 저장하면 그 값을 씀
LEFT_SIGN = 1
RIGHT_SIGN = -1

# 쿼드 RGB 센서
QUAD_INDEX = 1
LINE_IS_BLACK = True           # 센서가 "선" 이라고 하는 것이 검정 선이면 True

# 속도 (rpm, 바퀴 6.5cm 이면 50rpm ≈ 17cm/s)
FOLLOW_RPM = 45
FOLLOW_KP = 9.0                # 선이 한 칸(센서 간격) 벗어날 때 더하는 바퀴 차이(rpm)
FOLLOW_KD = 4.0
FOLLOW_KI = 0.6                # 한쪽으로 계속 치우치면(바퀴 힘 차이) 조금씩 더 바로잡음 — 선 가운데를 타야 갈림길을 잘 봄
FOLLOW_I_MAX = 12.0            # 그 바로잡기의 한계(rpm)
TURN_RPM = 28                  # 제자리 회전
APPROACH_RPM = 30              # 갈림길에서 바퀴 축을 맞추러 갈 때
ROBOT_SPEED_MPS = 0.5          # 지도 위 속도 처음 값 (구간마다 실제 걸린 시간으로 맞춤)
FLOOR_CM_PER_M = 8.333         # 계획의 next_m(도면 m) → 바닥 cm (시범 코스: 도면 1단위 0.24m = 바닥 2cm)

# 갈림길·회전
DECIDE_CM = 2.2                # 넓은 검정을 처음 본 뒤 이만큼 더 가며 지켜봄 (반대쪽 바깥 센서도 보면 T)
WIDE_MIN_CM = 0.5              # 그동안 넓은 검정을 이만큼 넘게 봐야 갈림길 (못 넘어도 그 뒤 선이 끝나면 갈림길)
JUNCTION_COOLDOWN_CM = 6.0     # 갈림길·회전 뒤 이만큼 갈 때까지는 갈림길로 안 셈
JUNCTION_GATE = 0.0            # 다음 노드까지 계획 거리의 이 비율 전에는 갈림길 무시 (0 = 안 씀, 바닥 길이가 도면과 다를 수 있어서)
TURN_PAUSE_MS = 500
TURN_MIN_DEG = 62              # 90도 회전: 이만큼 돈 뒤부터 새 선 찾기 (센서 앞 거리가 ±2cm 틀려도 새 선은 70~105도)
TURN_MAX_DEG = 160
UTURN_MIN_DEG = 140
UTURN_MAX_DEG = 260
UTURN_DIR = "L"
LOST_CM = 12.0                 # 센서 네 개가 모두 선을 놓친 채 이만큼 가면 멈춤
FOLLOW_GIVEUP_MS = 90000       # 서버 주행: 다음 갈림길을 이만큼 못 만나면 멈춤
LIFT_MS = 1500                 # (선 시험) 네 센서가 모두 검정으로 이만큼 = 들어 올림

LOOP_TARGET_MS = 30            # 선 따라가기 한 바퀴가 이보다 느리면 속도를 줄임 (최대 절반까지)
POLL_IDLE_MS = 1500
POLL_WAIT_MS = 2000
LOG_FLUSH_MS = 4000
HTTP_TIMEOUT_S = 8
SCREEN_MS = 700
# ---- 설정 끝 ----

import time

try:
    import cyberpi
except ImportError:
    cyberpi = None
try:
    import mbot2
except ImportError:
    mbot2 = None
try:
    import mbuild
except ImportError:
    mbuild = None
# 펌웨어에 따라 cyberpi 안에만 있는 경우 (cyberpi.mbot2, cyberpi.quad_rgb_sensor)
if mbot2 is None and cyberpi is not None:
    mbot2 = getattr(cyberpi, "mbot2", None)

VERSION = "mbot2-1"


# ───────── 시간 (시험에서 바꿔 끼움) ─────────
def ms():
    if hasattr(time, "ticks_ms"):
        return time.ticks_ms()
    return int(time.time() * 1000)


def nap(t):
    if hasattr(time, "sleep_ms"):
        time.sleep_ms(int(t))
    else:
        time.sleep(t / 1000.0)


# ───────── 기록 ─────────
PENDING = []          # 서버로 보낼 기록
DROPPED = [0]
LAST_LINE = [""]


def log(*parts):
    s = " ".join([str(p) for p in parts])
    line = "%.1f %s" % (ms() / 1000.0, s)
    try:
        print(line)
    except Exception:
        pass
    PENDING.append(line)
    if len(PENDING) > 240:
        del PENDING[0:40]
        DROPPED[0] += 40
    LAST_LINE[0] = s


def ascii_only(s):
    out = []
    for ch in s:
        out.append(ch if 32 <= ord(ch) < 127 else "?")
    return "".join(out)


# ───────── 하드웨어 (mBot2 · CyberPi) ─────────
def _find(obj, names):
    if obj is None:
        return None
    for n in names:
        f = getattr(obj, n, None)
        if f is not None:
            return f
    return None


class Body:
    def __init__(self):
        self.l = 0
        self.r = 0
        self.at = ms()
        self.dist = 0.0        # 앞으로 간 거리 누적(cm, 뒤로 가면 줄어듦)
        self.spin = 0.0        # 바퀴로 계산한 회전 누적(도, 오른쪽 +)
        self.left_sign = LEFT_SIGN
        self.right_sign = RIGHT_SIGN
        self.api = {}
        q = getattr(mbuild, "quad_rgb_sensor", None) if mbuild else None
        if q is None and cyberpi is not None:
            q = getattr(cyberpi, "quad_rgb_sensor", None)
        self.quad = q
        self.probe_mode = 0    # 0 is_line("L2",i) · 1 is_line(4..1) · 2 get_line_sta("all",i) 비트 · 3 없음
        self._is_line = _find(q, ["is_line"])
        self._line_sta = _find(q, ["get_line_sta"])
        self._drive = _find(mbot2, ["drive_speed"])
        self._power = _find(mbot2, ["drive_power"])
        self._stop = _find(mbot2, ["EM_stop"])
        self._rot = _find(cyberpi, ["get_rotation"])
        self._rot_reset = _find(cyberpi, ["reset_rotation"])
        self._yaw = _find(cyberpi, ["get_yaw"])
        ctl = getattr(cyberpi, "controller", None) if cyberpi else None
        self._press = _find(ctl, ["is_press"])
        self.has_gyro = self._rot is not None or self._yaw is not None
        self._spin0 = 0.0
        self._yaw0 = None
        self._yraw = None      # 자이로 마지막 값 (±180 에서 넘어가도 이어 붙임)
        self._yacc = 0.0
        self.gyro_bad = False
        self.api = {
            "quad.is_line": self._is_line is not None, "quad.get_line_sta": self._line_sta is not None,
            "drive_speed": self._drive is not None, "drive_power": self._power is not None,
            "gyro": self.has_gyro, "buttons": self._press is not None,
        }
        self.load_cal()

    # 보정값 파일 (B 점검이 저장)
    def load_cal(self):
        try:
            f = open("peekok_cal.txt")
            for ln in f.read().split("\n"):
                kv = ln.strip().split("=")
                if len(kv) == 2 and kv[0] == "right_sign":
                    self.right_sign = int(kv[1])
                if len(kv) == 2 and kv[0] == "left_sign":
                    self.left_sign = int(kv[1])
            f.close()
        except Exception:
            pass

    def save_cal(self):
        try:
            f = open("peekok_cal.txt", "w")
            f.write("left_sign=%d\nright_sign=%d\n" % (self.left_sign, self.right_sign))
            f.close()
            return True
        except Exception:
            return False

    # 거리·회전 누적 (마지막 명령 × 지난 시간)
    def odo(self):
        t = ms()
        dt = t - self.at
        if dt > 0:
            k = WHEEL_DIAM_CM * 3.14159 / 60000.0     # rpm → cm/ms
            vl = self.l * k
            vr = self.r * k
            self.dist += (vl + vr) / 2.0 * dt
            self.spin += (vl - vr) / WHEEL_BASE_CM * dt * 57.2958
        self.at = t
        return self.dist

    def drive(self, l, r):
        self.odo()
        self.l = l
        self.r = r
        self.raw(l * self.left_sign, r * self.right_sign)

    def raw(self, a, b):
        if self._drive:
            self._drive(a, b)
        elif self._power:
            self._power(a, b)

    def stop(self):
        self.odo()
        self.l = 0
        self.r = 0
        if self._stop:
            try:
                self._stop("all")
                return
            except Exception:
                pass
        self.raw(0, 0)

    # 네 센서: (L2, L1, R1, R2) — True = 선(검정) 위
    def probes(self):
        v = None
        while v is None:
            try:
                v = self._probes(self.probe_mode)
            except Exception as e:
                if self.probe_mode >= 3:
                    v = (False, False, False, False)
                else:
                    log("[센서] 읽기 방식 %d 안 됨(%s) → 다음 방식" % (self.probe_mode, e))
                    self.probe_mode += 1
                    self.api["probe_mode"] = self.probe_mode
        if not LINE_IS_BLACK:
            v = tuple([not x for x in v])
        return v

    def _probes(self, mode):
        q = self._is_line
        if mode == 0 and q:
            return tuple([bool(q(ch, QUAD_INDEX)) for ch in ("L2", "L1", "R1", "R2")])
        if mode == 1 and q:
            # 번호식: 1 = 맨 오른쪽 … 4 = 맨 왼쪽
            return tuple([bool(q(n)) for n in (4, 3, 2, 1)])
        if mode == 2 and self._line_sta:
            # 0~15, L2 가 가장 높은 비트, 1 = 선
            n = int(self._line_sta("all", QUAD_INDEX))
            return (bool(n & 8), bool(n & 4), bool(n & 2), bool(n & 1))
        if mode >= 3:
            return (False, False, False, False)
        raise ValueError("no api")

    # 돈 각도(도, 크기만 씀). 자이로가 없으면 바퀴로 계산
    def angle_reset(self):
        self.odo()
        self._spin0 = self.spin
        self._yaw0 = self.yaw()

    def angle(self):
        y = self.yaw()
        self.odo()
        w = abs(self.spin - self._spin0)
        if y is not None and self._yaw0 is not None and not self.gyro_bad:
            g = abs(y - self._yaw0)
            # 자이로 값이 안 바뀌면(멈춘 센서) 바퀴로 센 각도를 씀
            if w > 40 and g < w * 0.2:
                self.gyro_bad = True
                self.api["gyro"] = False
                log("[자이로] 값이 안 바뀌어요 (자이로 %d도 · 바퀴 %d도) → 바퀴로 셈" % (int(g), int(w)))
                return w
            return g
        return w

    def yaw(self):
        # 누적 각도. get_yaw 는 -180~180 에서 넘어가므로 바뀐 만큼만 이어 붙인다
        y = None
        try:
            if self._rot:
                y = float(self._rot("z"))
            elif self._yaw:
                y = float(self._yaw())
        except Exception:
            y = None
        if y is None:
            return None
        if self._yraw is not None:
            d = y - self._yraw
            while d > 180:
                d -= 360
            while d < -180:
                d += 360
            self._yacc += d
        self._yraw = y
        return self._yacc

    def pressed(self, name):
        if not self._press:
            return False
        try:
            return bool(self._press(name))
        except Exception:
            return False

    def show(self, lines):
        if cyberpi is None:
            return
        try:
            con = cyberpi.console
            con.clear()
            for ln in lines:
                con.println(ascii_only(ln)[:20])
        except Exception:
            pass

    def led(self, r, g, b):
        try:
            cyberpi.led.on(r, g, b)
        except Exception:
            pass

    def beep(self, freq=880, sec=0.15):
        try:
            cyberpi.audio.play_tone(freq, sec)
        except Exception:
            pass


# ───────── WiFi · 서버 ─────────
def clean_key(k):
    return str(k or "").strip().strip("\"'`").strip()


class Net:
    def __init__(self):
        self.ok = False
        self.started = False
        self.wlan = None
        self.fails = 0

    def tick(self):
        if self.connected():
            if not self.ok:
                self.ok = True
                log("[WiFi] 연결됨")
            return True
        if self.ok:
            self.ok = False
            log("[WiFi] 끊김 — 다시 연결")
            self.started = False
        if not self.started:
            self.started = True
            self.start_at = ms()
            self.connect()
        elif ms() - self.start_at > 20000:
            log("[WiFi] 20초 넘게 안 붙어요: 이름 \"%s\" · 2.4GHz 인지 · 비밀번호 확인 (iPhone 핫스팟은 '호환성 최대화')" % WIFI_SSID)
            self.started = False
        return False

    def connect(self):
        if not WIFI_SSID:
            log("[WiFi] 설정에 WIFI_SSID 가 비어 있어요 (config.py → tools/build.py)")
            return
        log("[WiFi] \"%s\" 연결 중" % WIFI_SSID)
        try:
            if cyberpi is not None and hasattr(cyberpi, "wifi"):
                cyberpi.wifi.connect(WIFI_SSID, WIFI_PASS)
                return
        except Exception as e:
            log("[WiFi] cyberpi.wifi 오류", e)
        try:
            import network
            self.wlan = network.WLAN(network.STA_IF)
            self.wlan.active(True)
            self.wlan.connect(WIFI_SSID, WIFI_PASS)
        except Exception as e:
            log("[WiFi] network 오류", e)

    def connected(self):
        try:
            if cyberpi is not None and hasattr(cyberpi, "wifi"):
                return bool(cyberpi.wifi.is_connect())
        except Exception:
            pass
        try:
            return bool(self.wlan and self.wlan.isconnected())
        except Exception:
            return False


def _headers(ctype):
    h = {"X-Robot-Key": clean_key(ROBOT_KEY), "X-Robot-Body": "mbot2", "User-Agent": "peekok-mbot2/1.0"}
    if ctype:
        h["Content-Type"] = ctype
    return h


def http(method, path, body=None, ctype="application/json"):
    """(상태 코드, 본문 글자). 실패하면 (0, 이유)"""
    url = ("https://" if USE_TLS else "http://") + SERVER_HOST
    if SERVER_PORT not in (80, 443):
        url += ":%d" % SERVER_PORT
    url += path
    hdr = _headers(ctype if body is not None else None)
    data = body.encode("utf-8") if isinstance(body, str) else body
    try:
        import urequests
    except ImportError:
        urequests = None
    err = ""
    if urequests is not None and HTTP_WAY[0] != "socket":
        try:
            r = urequests.request(method, url, data=data, headers=hdr)
            code = r.status_code
            txt = r.text
            r.close()
            HTTP_WAY[0] = "urequests"
            return code, txt
        except Exception as e:
            err = "urequests: %s · " % e
            if HTTP_WAY[0] == "urequests":
                return 0, err     # 한 번 됐던 방식이면 WiFi·서버 문제 — 소켓으로 바꾸지 않음
    code, txt = _socket_http(method, path, data, hdr)
    if code:
        if HTTP_WAY[0] != "socket":
            log("[서버] 소켓으로 붙음 (%s)" % (err.strip(" ·") or "urequests 없음"))
        HTTP_WAY[0] = "socket"
        return code, txt
    return 0, err + txt


HTTP_WAY = [None]     # 처음 된 방식 (urequests 또는 socket)


def _socket_http(method, path, data, hdr):
    try:
        import usocket as socket
    except ImportError:
        import socket
    s = None
    try:
        ai = socket.getaddrinfo(SERVER_HOST, SERVER_PORT)[0][-1]
        s = socket.socket()
        try:
            s.settimeout(HTTP_TIMEOUT_S)
        except Exception:
            pass
        s.connect(ai)
        if USE_TLS:
            try:
                import ussl as ssl
            except ImportError:
                import ssl
            try:
                s = ssl.wrap_socket(s, server_hostname=SERVER_HOST)
            except TypeError:
                s = ssl.wrap_socket(s)
        req = "%s %s HTTP/1.0\r\nHost: %s\r\n" % (method, path, SERVER_HOST)
        for k in hdr:
            req += "%s: %s\r\n" % (k, hdr[k])
        if data is not None:
            req += "Content-Length: %d\r\n" % len(data)
        req += "Connection: close\r\n\r\n"
        s.write(req.encode("utf-8")) if hasattr(s, "write") else s.send(req.encode("utf-8"))
        if data is not None:
            s.write(data) if hasattr(s, "write") else s.send(data)
        chunks = []
        while True:
            c = s.read(1024) if hasattr(s, "read") else s.recv(1024)
            if not c:
                break
            chunks.append(c)
        raw = b"".join(chunks)
        i = raw.find(b"\r\n\r\n")
        head, body = raw[:i], raw[i + 4:]
        code = int(head.split(b" ")[1])
        return code, body.decode("utf-8")
    except Exception as e:
        return 0, "socket: %s" % e
    finally:
        try:
            s.close()
        except Exception:
            pass


# ───────── 방향 ─────────
HEADINGS = "NESW"


def turn_for(frm, to):
    """지금 방향 frm 에서 to 로: S 직진 · R 우회전 · U 유턴 · L 좌회전"""
    if frm not in HEADINGS or to not in HEADINGS or len(frm) != 1 or len(to) != 1:
        return "S"
    d = (HEADINGS.index(to) - HEADINGS.index(frm)) % 4
    return "SRUL"[d]


ACTION = {"start": "s", "straight": "S", "left": "L", "right": "R", "uturn": "U", "elevator": "E", "exit": "X"}


# ───────── 선 따라가기 · 갈림길 ─────────
def line_err(p):
    """선이 왼쪽이면 음수, 오른쪽이면 양수 (센서 한 칸 = 1). 선이 없으면 None"""
    L2, L1, R1, R2 = p
    if L1 and R1:
        return 0.0
    s = 0
    n = 0
    for k, b in ((-3, L2), (-1, L1), (1, R1), (3, R2)):
        if b:
            s += k
            n += 1
    if n == 0:
        return None
    return float(s) / n


def wide(p):
    """테이프 한 줄로는 덮을 수 없는 넓은 검정 = 옆으로 뻗은 선(갈림길·꺾이는 곳·T)"""
    L2, L1, R1, R2 = p
    return (L2 and R1) or (R2 and L1) or (L2 and R2)


# ───────── 로봇 ─────────
IDLE, FOLLOW, ELEVATOR, ERROR, TEST, TRACE = "idle", "follow", "elevator", "error", "test", "trace"
MOVING = ("to_caller", "delivering", "guiding", "returning")


class Aborted(Exception):
    pass


class Robot:
    def __init__(self, body=None, net=None):
        self.b = body or Body()
        self.net = net or Net()
        self.state = IDLE
        self.heading = HOME_HEADING
        self.mode = "idle"
        self.rev = ""
        self.done_rev = ""
        self.passed = "-"
        self.plan = []
        self.server_ready = False
        self.last_poll = 0
        self.last_flush = 0
        self.last_screen = 0
        self.speed = ROBOT_SPEED_MPS
        self.leg_from = 0
        self.leg_start = 0
        self.leg_dist0 = 0.0
        self.route_i = 0
        self.route = TEST_ROUTE
        self.reset_junction()
        self.prev_err = 0.0
        self.last_err = 0.0
        self.loop_ms = 20.0          # 선 따라가기 한 바퀴 시간(ms) 평균
        self.loop_at = 0
        self.i_sum = 0.0             # 치우침 바로잡기 (바퀴 힘 차이는 늘 같으니 회전 뒤에도 유지)
        self.i_at = 0.0
        self.lost_at = None
        self.http_fail = 0

    # ── 서버 ──
    def parse(self, txt):
        if not txt or not txt.startswith("ok"):
            return False
        rev = self.rev
        nodes = None
        reading = False
        for line in txt.split("\n"):
            line = line.strip()
            if line.startswith("mode "):
                self.mode = line[5:]
            elif line.startswith("rev "):
                rev = line[4:]
            elif line.startswith("passed "):
                self.passed = line[7:]
            elif line.startswith("nodes "):
                reading = rev != self.rev
                if reading:
                    nodes = []
            elif line == "end":
                break
            elif reading and line:
                t = line.split(" ")
                if len(t) >= 5:
                    nodes.append({"key": t[0], "a": ACTION.get(t[1], "T"), "h": t[2], "m": float(t[3]), "fl": int(float(t[4]))})
        if nodes is not None:
            self.plan = nodes
            self.rev = rev
            log("[계획] rev %s · 노드 %d개" % (rev, len(nodes)))
        return True

    def request(self, method, path, body=None, ctype="application/json"):
        if not self.net.connected():
            return False
        code, txt = http(method, path, body, ctype)
        if code == 200:
            self.http_fail = 0
            return self.parse(txt)
        self.http_fail += 1
        if code == 401:
            log("[서버] 401 로봇 키가 서버와 달라요:", txt[:120])
        else:
            log("[서버] %s %s → %s %s" % (method, path, code, txt[:120]))
        return False

    def poll(self):
        if PENDING and ms() - self.last_flush > LOG_FLUSH_MS:
            return self.flush()
        return self.request("GET", "/api/robot/drive")

    def flush(self):
        """모아 둔 기록 보내기 (응답 = 지금 모드·계획)"""
        self.last_flush = ms()
        if not PENDING:
            return self.request("GET", "/api/robot/drive")
        lines = PENDING[:60]
        if DROPPED[0]:
            lines = ["(기록 %d줄 넘쳐서 버림)" % DROPPED[0]] + lines
        sent = len(PENDING[:60])
        body = "\n".join(lines)
        if not self.net.connected():
            return False
        code, txt = http("POST", "/api/robot/log?fmt=text", body, "text/plain; charset=utf-8")
        if code == 200:
            del PENDING[0:sent]
            DROPPED[0] = 0
            return self.parse(txt)
        return False

    def report(self, action, body):
        return self.request("POST", "/api/robot/%s?fmt=text" % action, body)

    def report_passed(self, i):
        nxt = self.plan[i + 1]["key"] if i + 1 < len(self.plan) else ""
        log("[노드] %s 지남 → %s" % (self.plan[i]["key"], nxt))
        body = '{"passed":"%s","next":"%s","speed":%.3f}' % (self.plan[i]["key"], nxt, self.speed)
        for _ in range(3):
            if self.report("progress", body):
                return True
            nap(500)
        return False

    # ── 몸 움직임 (끝날 때까지 기다리는 동작. B 버튼 = 멈춤) ──
    def check_abort(self):
        if self.b.pressed("b"):
            self.b.stop()
            log("[멈춤] B 버튼")
            while self.b.pressed("b"):
                nap(20)
            raise Aborted()

    def forward(self, cm, rpm=None):
        rpm = rpm or APPROACH_RPM
        if abs(cm) < 0.2:
            return
        d0 = self.b.odo()
        sgn = 1 if cm > 0 else -1
        t0 = ms()
        while abs(self.b.odo() - d0) < abs(cm) and ms() - t0 < 8000:
            self.check_abort()
            self.b.drive(sgn * rpm, sgn * rpm)
            nap(10)
        self.b.stop()

    def spin_to_line(self, d, min_deg, max_deg):
        """제자리에서 d(+1 오른쪽 · -1 왼쪽)로 돌다가 min_deg 지난 뒤 안쪽 센서가 새 선을 잡으면 멈춤"""
        self.b.angle_reset()
        self.hist = []
        t0 = ms()
        lead_n = 0                      # 도는 쪽 안쪽 센서가 새 선을 연달아 본 횟수
        while ms() - t0 < 12000:
            self.check_abort()
            self.b.drive(d * TURN_RPM, -d * TURN_RPM)
            nap(10)
            L2, L1, R1, R2 = self.sense()   # 돌기 시작부터 읽어 잡음 거르기를 채워 둠
            a = self.b.angle()
            if a > max_deg:
                break
            if a < min_deg:
                continue
            lead = R1 if d > 0 else L1
            trail = L1 if d > 0 else R1
            # 새 선: 안쪽 센서가 두 번 넘게 이어서 선을 본 뒤, 두 안쪽이 다 보거나 반대쪽 안쪽이 보거나 지나가면 멈춤
            if lead_n >= 2 and ((L1 and R1) or trail or not lead):
                self.b.stop()
                log("[회전] %d도 돌아 새 선" % int(a))
                return True
            lead_n = lead_n + 1 if (lead or (L1 and R1)) else (lead_n if lead_n >= 2 else 0)
        self.b.stop()
        log("[회전] %d도 돌았는데 선을 못 찾음" % int(self.b.angle()))
        return False

    def do_turn(self, t, want, at_junction):
        ok = True
        if t in "LR":
            self.b.stop()
            if at_junction:
                nap(TURN_PAUSE_MS)
                # 바퀴 축을 갈림길 가운데로: 센서가 처음 본 곳 + (축→센서 거리) + 테이프 반 폭 − 판단하며 더 간 거리
                go = SENSOR_AHEAD_CM + TAPE_CM / 2.0 - (self.b.odo() - self.j_seen)
                self.forward(go)
            ok = self.spin_to_line(1 if t == "R" else -1, TURN_MIN_DEG, TURN_MAX_DEG)
        elif t == "U":
            self.b.stop()
            if at_junction:
                nap(TURN_PAUSE_MS)
            ok = self.spin_to_line(1 if UTURN_DIR == "R" else -1, UTURN_MIN_DEG, UTURN_MAX_DEG)
        if ok and want in HEADINGS and len(want) == 1:
            self.heading = want
        self.reset_junction(cooldown=True)
        log("[회전] %s → 방향 %s%s" % (t, self.heading, "" if ok else " (선을 못 찾음)"))
        return ok

    # ── 선 따라가기 한 걸음 ──
    def sense(self):
        """네 센서를 읽고 센서마다 최근 3번 중 2번 이상 (한 번 튀는 잡음 거르기)"""
        p = self.b.probes()
        h = self.hist
        h.append(p)
        if len(h) > 3:
            del h[0]
        if len(h) < 3:
            return p
        return tuple([(h[0][i] + h[1][i] + h[2][i]) >= 2 for i in range(4)])

    def reset_junction(self, cooldown=False):
        self.j_cand = None      # 넓은 검정을 처음 본 거리 (지켜보는 중이면 숫자)
        self.j_seen = 0.0
        self.j_decide = None    # 결정 대기 시작 거리
        self.j_last = 0.0
        self.j_wide = 0.0
        self.j_prev_d = self.b.odo()
        self.j_left = False
        self.j_right = False
        self.j_ignore_until = (self.b.odo() + JUNCTION_COOLDOWN_CM) if cooldown else -1e9
        self.lost_at = None
        self.hist = []
        self.loop_at = 0

    def follow(self, p, rpm=None):
        """한 걸음. 선을 놓친 채 LOST_CM 넘게 가면 False"""
        rpm = rpm or FOLLOW_RPM
        # 한 바퀴(센서 읽기+계산)가 느리면 그만큼 천천히 — 한 번 읽는 사이 1cm 넘게 가지 않게
        t = ms()
        if self.loop_at:
            self.loop_ms = 0.8 * self.loop_ms + 0.2 * min(200, t - self.loop_at)
        self.loop_at = t
        if self.loop_ms > LOOP_TARGET_MS:
            rpm = max(rpm * 0.5, rpm * LOOP_TARGET_MS / self.loop_ms)
        e = line_err(p)
        if self.j_cand is not None or self.j_decide is not None:
            # 갈림길을 지나는 중: 옆으로 뻗은 선 쪽으로 끌려가지 않게 안쪽 두 센서만 본다
            e = -1.0 if (p[1] and not p[2]) else 1.0 if (p[2] and not p[1]) else 0.0
        if e is None:
            if self.lost_at is None:
                self.lost_at = self.b.odo()
            elif self.b.odo() - self.lost_at > LOST_CM:
                return False
            e = 3.0 if self.last_err > 0 else -3.0     # 마지막으로 본 쪽으로 크게
        else:
            self.lost_at = None
            self.last_err = e
        d = self.b.odo()
        step = max(0.0, d - self.i_at)
        self.i_at = d
        if self.lost_at is None:
            self.i_sum = max(-FOLLOW_I_MAX, min(FOLLOW_I_MAX, self.i_sum + FOLLOW_KI * e * step))
        c = FOLLOW_KP * e + FOLLOW_KD * (e - self.prev_err) + self.i_sum
        self.prev_err = e
        lo = 0
        self.b.drive(max(lo, rpm + c), max(lo, rpm - c))
        return True

    def junction(self, p, allowed=True):
        """갈림길을 다 지나 판단이 끝나면 True (j_left·j_right = 어느 쪽에 선)
        넓은 검정을 처음 보면 DECIDE_CM 더 가며 지켜본다. 그동안 넓은 검정을 WIDE_MIN_CM 넘게 봤거나,
        다 지난 뒤 선이 끝났으면(꺾이는 곳·T) 갈림길. 잠깐 한 번만 본 것은 잡음으로 버린다."""
        d = self.b.odo()
        if d < self.j_ignore_until or not allowed:
            self.j_decide = None
            self.j_cand = None
            return False
        w = wide(p)
        prev = self.j_prev_d
        self.j_prev_d = d
        if self.j_decide is None:
            if not w:
                return False
            self.j_decide = d
            self.j_cand = d
            self.j_seen = d
            self.j_last = d
            self.j_wide = min(1.0, max(0.0, d - prev))   # 처음 본 칸도 그 사이 간 거리만큼 셈
            self.j_left = p[0]
            self.j_right = p[3]
            return False
        step = d - self.j_last
        self.j_last = d
        if w:
            self.j_wide += max(0.0, step)
            self.j_left = self.j_left or p[0]
            self.j_right = self.j_right or p[3]
        if d - self.j_decide < DECIDE_CM:
            return False
        ended = not p[1] and not p[2]
        self.j_decide = None
        self.j_cand = None
        if self.j_wide < WIDE_MIN_CM and not ended:
            return False
        log("[판단] %s" % ("양쪽 → T자" if self.j_left and self.j_right else "왼쪽 갈림길" if self.j_left else "오른쪽 갈림길"))
        return True

    # ── 계획 실행 ──
    def start_leg(self, i):
        self.leg_from = i
        self.leg_start = ms()
        self.leg_dist0 = self.b.odo()
        n = self.plan[i]
        log("[구간] %s → %s  %.2fm (바닥 약 %dcm)" % (n["key"], self.plan[i + 1]["key"], n["m"], int(n["m"] * FLOOR_CM_PER_M)))

    def learn_speed(self):
        dur = ms() - self.leg_start
        m = self.plan[self.leg_from]["m"]
        if dur > 1000 and m > 0:
            v = 0.5 * self.speed + 0.5 * (m / (dur / 1000.0))
            self.speed = min(3.0, max(0.02, v))

    def begin_plan(self):
        if len(self.plan) < 2:
            return
        log("[출발] 모드 %s · 지금 방향 %s → %s" % (self.mode, self.heading, self.plan[0]["h"]))
        self.state = FOLLOW
        if not self.do_turn(turn_for(self.heading, self.plan[0]["h"]), self.plan[0]["h"], False):
            self.fail("출발 방향으로 돌다 선을 못 찾음")
            return
        self.reset_junction(cooldown=False)
        self.report_passed(0)
        self.start_leg(0)

    def fail(self, why):
        self.b.stop()
        self.state = ERROR
        self.done_rev = self.rev
        self.b.led(255, 0, 0)
        log("[오류] %s — 같은 계획으로 다시 출발하지 않음" % why)

    def arrive(self):
        self.b.stop()
        log("[도착] 목적지")
        for _ in range(3):
            if self.report("arrived", "{}"):
                break
            nap(1000)
        self.done_rev = self.rev
        self.state = IDLE
        self.b.beep(1046, 0.2)

    def at_node(self, j):
        self.b.stop()
        self.learn_speed()
        rev = self.rev
        self.report_passed(j)
        if self.rev != rev:
            return                       # 보고 응답에서 계획이 바뀜 → loop 가 처리
        n = self.plan[j]
        if n["a"] == "E":
            self.state = ELEVATOR
            self.leg_from = j
            self.last_poll = ms()
            log("[엘리베이터] %d층으로 태워 주세요. 내린 뒤 A 버튼" % n["fl"])
            self.b.beep(660, 0.3)
            return
        a = n["a"] if n["a"] in "LRUS" else turn_for(self.heading, n["h"])
        if not self.do_turn(a, n["h"], True):
            self.fail("회전하다 선을 못 찾음")
            return
        self.start_leg(j)

    def follow_step(self):
        p = self.sense()
        last = self.leg_from + 1 >= len(self.plan) - 1
        gate = True
        if JUNCTION_GATE > 0 and not last:
            gate = self.b.odo() - self.leg_dist0 > self.plan[self.leg_from]["m"] * FLOOR_CM_PER_M * JUNCTION_GATE
        if self.junction(p, gate):
            if last:
                self.learn_speed()
                self.arrive()
            else:
                self.at_node(self.leg_from + 1)
            return
        if not self.follow(p):
            self.fail("선을 놓쳤어요 (네 센서 모두 바닥 %dcm)" % int(LOST_CM))
            return
        if ms() - self.leg_start > FOLLOW_GIVEUP_MS:
            self.fail("다음 갈림길이 너무 오래 안 나와요")

    def elevator_step(self):
        j = self.leg_from
        if j + 1 >= len(self.plan):
            self.fail("엘리베이터 다음 노드가 없음")
            return
        ex = self.plan[j + 1]
        go = self.b.pressed("a")
        if not go and ms() - self.last_poll > POLL_WAIT_MS:
            self.last_poll = ms()
            rev = self.rev
            self.poll()
            if self.rev != rev:
                log("[엘리베이터] 계획이 바뀌었어요")
                self.state = IDLE
                return
            go = self.passed == ex["key"]
        if not go:
            return
        log("[엘리베이터] %s 에서 다시 출발" % ex["key"])
        while self.b.pressed("a"):
            nap(20)
        self.heading = ex["h"]
        if self.passed != ex["key"]:
            self.report_passed(j + 1)
        self.state = FOLLOW
        self.reset_junction(cooldown=True)
        self.start_leg(j + 1)

    # ── 코스 시험 (서버 없이, 가운데 버튼) ──
    def test_start(self, route=None):
        self.route = route or TEST_ROUTE
        self.route_i = 0
        self.reset_junction()
        self.test_at = ms()
        self.state = TEST
        log("[코스 시험] \"%s\" 시작 — B 로 멈춤" % self.route)

    def test_finish(self, why):
        self.b.stop()
        self.state = IDLE
        self.done_rev = self.rev
        log("[코스 시험] 끝: %s" % why)

    def test_step(self):
        p = self.sense()
        if self.junction(p):
            self.test_at = ms()
            if self.route_i >= len(self.route):
                self.test_finish("코스 글자를 다 썼어요")
                return
            a = self.route[self.route_i]
            self.route_i += 1
            log("[코스 시험] %d번째 표시 → %s" % (self.route_i, a))
            if a == "E":
                self.test_finish("정지 (완료)")
                return
            if a == "V":
                self.b.stop()
                nap(2000)
                a = "U"
            if not self.do_turn(a, "-", True):
                self.test_finish("회전하다 선을 못 찾았어요")
            return
        if not self.follow(p):
            self.test_finish("선을 놓쳤어요")
            return
        if ms() - self.test_at > 30000:
            self.test_finish("표시를 너무 오래 못 만났어요")

    # ── 선 따라가기 시험 (A 버튼) ──
    def trace_start(self):
        self.trace = {"t0": ms(), "last": ms(), "center": 0, "side": 0, "lost": 0, "flip": 0, "sgn": 0, "black": None}
        self.reset_junction()
        self.state = TRACE
        log("[선 시험] 시작 — A·B 로 멈춤, 60초")

    def trace_step(self):
        if self.b.pressed("a"):
            self.trace_finish("A 버튼")
            while self.b.pressed("a"):
                nap(20)
            return
        p = self.sense()
        tr = self.trace
        t = ms()
        dt = t - tr["last"]
        tr["last"] = t
        e = line_err(p)
        if e is None:
            tr["lost"] += dt
        elif e == 0:
            tr["center"] += dt
        else:
            tr["side"] += dt
            s = 1 if e > 0 else -1
            if tr["sgn"] and s != tr["sgn"]:
                tr["flip"] += 1
            tr["sgn"] = s
        if p[0] and p[1] and p[2] and p[3]:
            if tr["black"] is None:
                tr["black"] = t
            elif t - tr["black"] > LIFT_MS:
                self.trace_finish("네 센서 모두 검정 — 들어 올렸어요?")
                return
        else:
            tr["black"] = None
        if not self.follow(p):
            self.trace_finish("선을 놓쳤어요")
            return
        if t - tr["t0"] > 60000:
            self.trace_finish("60초 끝")

    def trace_finish(self, why):
        self.b.stop()
        tr = self.trace
        tot = max(1, tr["center"] + tr["side"] + tr["lost"])
        log("[선 시험] 끝: %s · 가운데 %d%% · 바로잡기 %d%% · 놓침 %d%% · 좌우 바뀜 %d번 · %.0fcm" % (
            why, tr["center"] * 100 // tot, tr["side"] * 100 // tot, tr["lost"] * 100 // tot, tr["flip"], self.b.odo()))
        self.state = IDLE
        self.done_rev = self.rev

    # ── 점검 (B 버튼): API·센서·자이로·바퀴 방향 ──
    def check(self):
        b = self.b
        log("[점검] %s · API %s" % (VERSION, b.api))
        log("[점검] 센서 L2 L1 R1 R2 = %s" % "".join(["1" if x else "0" for x in b.probes()]))
        log("[점검] 자이로 %s" % b.yaw())
        if not b.has_gyro:
            log("[점검] 자이로가 없어 바퀴 방향은 확인 못 함 (설정 RIGHT_SIGN 그대로)")
            return
        spins = []
        for sa, sb in ((25, 25), (25, -25)):
            y0 = b.yaw()
            t0 = ms()
            while ms() - t0 < 600:
                b.raw(sa, sb)
                nap(10)
            b.raw(0, 0)
            nap(300)
            y1 = b.yaw()
            spins.append(abs((y1 or 0) - (y0 or 0)))
        log("[점검] 같은 부호(+,+) %d도 · 반대 부호(+,-) %d도" % (int(spins[0]), int(spins[1])))
        if spins[0] > 15 and spins[0] > spins[1] * 2:
            b.right_sign = -b.left_sign
        elif spins[1] > 15 and spins[1] > spins[0] * 2:
            b.right_sign = b.left_sign
        else:
            log("[점검] 바퀴가 거의 안 돌았어요 — 배터리·모터 선 확인")
            return
        saved = b.save_cal()
        log("[점검] 바퀴 방향 right_sign=%d (%s)" % (b.right_sign, "저장함" if saved else "저장 못 함, 켤 때마다 점검"))
        # 앞으로 3cm: 센서가 바닥에서 선을 지나며 바뀌면 앞쪽이 맞음 — 사람 눈으로 확인
        self.forward(3.0)
        self.forward(-3.0)
        log("[점검] 앞으로 3cm 갔다 돌아옴 — 뒤로 먼저 갔으면 설정 LEFT_SIGN=-1")

    # ── 화면 ──
    def screen(self):
        if ms() - self.last_screen < SCREEN_MS:
            return
        self.last_screen = ms()
        p = self.b.probes()
        self.b.show([
            "PEEKOK mBot2",
            "WiFi " + ("ok" if self.net.ok else "..."),
            "srv " + (self.mode if self.server_ready else "-"),
            "st " + self.state + " " + self.heading,
            "L2L1R1R2 " + "".join(["#" if x else "." for x in p]),
            "A:line B:check",
        ])

    # ── 한 바퀴 ──
    def loop_once(self):
        wifi = self.net.tick()
        if wifi and not self.server_ready and self.state in (IDLE, ERROR):
            if self.request("GET", "/api/robot/drive"):
                self.done_rev = self.rev        # 켜기 전에 남아 있던 계획은 다시 달리지 않음
                self.server_ready = True
                self.last_poll = ms()
                log("서버 연결됨 · 모드 %s" % self.mode)
        st = self.state
        if st in (IDLE, ERROR):
            self.b.stop()
            self.screen()
            if self.b.pressed("a"):
                while self.b.pressed("a"):
                    nap(20)
                log("[선 시험] A 버튼 — 2초 뒤 출발")
                nap(2000)
                self.trace_start()
                return
            if self.b.pressed("b"):
                while self.b.pressed("b"):
                    nap(20)
                self.check()
                return
            if self.b.pressed("middle"):
                while self.b.pressed("middle"):
                    nap(20)
                nap(1500)
                self.test_start()
                return
            if self.server_ready and wifi and ms() - self.last_poll > POLL_IDLE_MS:
                self.last_poll = ms()
                if self.poll():
                    moving = self.mode in MOVING
                    if not moving:
                        self.done_rev = ""      # 서버가 쉬는 중이면 끝낸 계획 기억을 지움
                    if moving and len(self.plan) >= 2 and self.rev != self.done_rev:
                        if self.state == ERROR:
                            log("[다시 시도] 새 계획")
                        self.b.led(0, 0, 255)
                        self.begin_plan()
            nap(20)
        elif st == FOLLOW:
            self.check_abort()
            rev = self.rev
            self.follow_step()
            moving = self.mode in MOVING
            if self.state == FOLLOW and (self.rev != rev or not moving):
                self.b.stop()
                log("[계획 바뀜] 멈추고 다시 판단 (모드 %s)" % self.mode)
                self.state = IDLE
                if moving and len(self.plan) >= 2:
                    self.begin_plan()
            nap(10)
        elif st == ELEVATOR:
            self.elevator_step()
            nap(20)
        elif st == TEST:
            self.check_abort()
            self.test_step()
            nap(10)
        elif st == TRACE:
            self.check_abort()
            self.trace_step()
            nap(10)

    def step(self):
        try:
            self.loop_once()
        except Aborted:
            self.b.stop()
            self.done_rev = self.rev
            self.state = IDLE
        except Exception as e:
            self.b.stop()
            self.done_rev = self.rev
            self.state = ERROR
            log("[오류] 프로그램 예외: %s" % e)
            nap(500)


def main():
    r = Robot()
    log("피콕 mBot2 %s 켜짐 · 서버 %s · API %s" % (VERSION, SERVER_HOST, r.b.api))
    r.b.stop()
    while True:
        r.step()


# 컴퓨터 시험(test/sim.py)은 sys.modules 에 peekok_test 를 넣고 불러서 main 이 돌지 않게 한다
try:
    import sys
    _TEST = "peekok_test" in sys.modules
except Exception:
    _TEST = False
if not _TEST:
    main()
