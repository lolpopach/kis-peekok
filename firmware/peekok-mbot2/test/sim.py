# -*- coding: utf-8 -*-
"""mBot2 펌웨어 컴퓨터 시험 — 진짜 펌웨어(peekok_mbot2.py)를 가짜 mBot2 위에서 돌린다.

가짜 mBot2: 시범 코스 바닥 선(data.js robotCourse, 도면 1단위 = 2cm, 테이프 1.9cm, 방 앞 T 가로선 20cm)을
두 바퀴 로봇이 달리고, 앞 쿼드 RGB 센서 4개·자이로·버튼을 흉내 낸다. 왼쪽 바퀴가 3% 세고 처음 놓는 자리도 조금 비뚤다.

  python3 sim.py unit                          서버 없이: 글자 응답 해석·방향·센서 판단·엘리베이터
  python3 sim.py course                        서버 없이: 코스 시험(TEST_ROUTE)을 가짜 바닥에서
  python3 sim.py server <주소> <로봇 키>        로컬 서버(wrangler pages dev)에 붙어 로봇 화면 역할까지 해 보며
                                               데려다주기·배달·받는 곳 바꾸기(주행 중 새 계획)·제자리 돌아가기
"""
import json
import math
import os
import random
import subprocess
import sys
import types
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
FW = os.path.join(HERE, "..", "peekok_mbot2.py")
FAILS = []


def check(cond, what):
    print(("  ok   " if cond else "  FAIL ") + what)
    if not cond:
        FAILS.append(what)


# ───────── 바닥 ─────────
class Floor:
    def __init__(self, tape=1.9):
        c = json.loads(subprocess.check_output(["node", os.path.join(HERE, "plan.mjs"), '{"course":true}']))
        k = c["cm"]
        self.k = k
        self.nodes = {n: (xy[0] * k, xy[1] * k) for n, xy in c["nodes"].items()}
        self.segs = []
        for e in c["edges"].split():
            a, b = e.split("-")
            self.segs.append((self.nodes[a], self.nodes[b]))
        # 방 앞 끝 가로선(T, 20cm): 가지 선에 수직
        for room, n in c["rooms"].items():
            hx, hy = self.nodes[n]
            other = [b if a == (hx, hy) else a for a, b in self.segs if (hx, hy) in (a, b)][0]
            dx, dy = hx - other[0], hy - other[1]
            L = math.hypot(dx, dy)
            px, py = -dy / L * 10, dx / L * 10
            self.segs.append(((hx + px, hy + py), (hx - px, hy - py)))
        self.half = tape / 2.0

    def black(self, x, y):
        for (ax, ay), (bx, by) in self.segs:
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
            # 테이프 끝은 네모 (선분 끝에서 반 폭만큼 더)
            px, py = ax + t * dx, ay + t * dy
            ex = (x - px) * dx + (y - py) * dy
            if abs((x - px) * dy - (y - py) * dx) / math.sqrt(L2) <= self.half and abs(ex) / math.sqrt(L2) <= self.half:
                return True
        return False

    def node_cm(self, key):
        return self.nodes[key.split(":")[-1]]


# ───────── 가짜 mBot2 ─────────
class Sim:
    """시간·몸·센서. 펌웨어의 ms()/nap() 를 이것으로 바꿔 끼운다."""

    # 진짜 몸이 설정과 조금 다를 때를 흉내 (sweep 시험): 센서 간격·센서 앞 거리·바퀴 지름
    PROBES = {"L2": -2.25, "L1": -0.75, "R1": 0.75, "R2": 2.25}
    AHEAD = None
    WHEEL = None
    NOISE = 0.0      # 센서 값이 이 확률로 뒤집힘
    READ_MS = 0      # 센서 한 개 읽는 데 걸리는 시간 (CyberPi 는 느릴 수 있음)

    def __init__(self, floor, fw, x, y, heading_deg, bias=0.03, seed=1):
        self.floor = floor
        self.fw = fw
        self.t = 0
        self.x, self.y = x, y
        self.th = math.radians(heading_deg)    # 화면 좌표(y 아래): 0 = 동, 90 = 남, -90 = 북
        self.raw_l = 0.0
        self.raw_r = 0.0
        self.bias = bias
        self.buttons = set()
        self.rng = random.Random(seed)
        self.max_t = None
        self.timeline = []                     # (시간, 할 일) — 버튼 누르기 등

    def ms(self):
        return int(self.t)

    def nap(self, ms):
        end = self.t + max(1, ms)
        while self.t < end:
            dt = min(5.0, end - self.t)
            self.physics(dt)
            self.t += dt
        while self.timeline and self.timeline[0][0] <= self.t:
            self.timeline.pop(0)[1]()
        if self.max_t is not None and self.t > self.max_t:
            raise TimeoutError("시뮬레이션 시간 초과")

    def physics(self, dt):
        fw = self.fw
        circ = (self.WHEEL or fw.WHEEL_DIAM_CM) * math.pi
        vl = self.raw_l * (1 + self.bias) * circ / 60000.0        # 진짜 mBot2 처럼 왼쪽 + = 앞, 오른쪽 - = 앞
        vr = -self.raw_r * (1 - self.bias) * circ / 60000.0
        v = (vl + vr) / 2.0
        w = (vl - vr) / fw.WHEEL_BASE_CM
        self.th += w * dt
        self.x += v * math.cos(self.th) * dt
        self.y += v * math.sin(self.th) * dt

    def probe_xy(self, lat):
        fw = self.fw
        ahead = self.AHEAD or fw.SENSOR_AHEAD_CM
        fx = self.x + ahead * math.cos(self.th)
        fy = self.y + ahead * math.sin(self.th)
        rx, ry = -math.sin(self.th), math.cos(self.th)            # 오른쪽 방향
        return fx + lat * rx, fy + lat * ry

    def is_line(self, ch, index=1):
        lat = self.PROBES[ch]
        if self.READ_MS:
            self.physics(self.READ_MS)
            self.t += self.READ_MS
        v = self.floor.black(*self.probe_xy(lat))
        if self.NOISE and self.rng.random() < self.NOISE:
            v = not v
        return v

    def yaw_deg(self):
        return -math.degrees(self.th)                             # 반시계 + (방향은 펌웨어가 안 씀)


def fake_modules(sim_ref, net_ok=True):
    """cyberpi · mbot2 · mbuild · urequests 흉내"""
    cyberpi = types.ModuleType("cyberpi")
    mbot2 = types.ModuleType("mbot2")
    mbuild = types.ModuleType("mbuild")

    def drive_speed(a, b):
        sim_ref[0].raw_l, sim_ref[0].raw_r = float(a), float(b)

    def em_stop(port="all"):
        sim_ref[0].raw_l = sim_ref[0].raw_r = 0.0

    mbot2.drive_speed = drive_speed
    mbot2.EM_stop = em_stop
    quad = types.SimpleNamespace(is_line=lambda ch, index=1: sim_ref[0].is_line(ch, index))
    mbuild.quad_rgb_sensor = quad
    cyberpi.get_rotation = lambda axis="z": sim_ref[0].yaw_deg()
    cyberpi.reset_rotation = lambda axis="z": None
    cyberpi.controller = types.SimpleNamespace(is_press=lambda name: name in sim_ref[0].buttons)
    cyberpi.wifi = types.SimpleNamespace(connect=lambda s, p: None, is_connect=lambda: net_ok)
    shown = []
    cyberpi.console = types.SimpleNamespace(clear=lambda: shown.clear(), println=lambda s: shown.append(s))
    cyberpi.led = types.SimpleNamespace(on=lambda r, g, b: None)
    cyberpi.audio = types.SimpleNamespace(play_tone=lambda f, s: None)

    urequests = types.ModuleType("urequests")

    class Resp:
        def __init__(self, code, text):
            self.status_code, self.text = code, text

        def close(self):
            pass

    def request(method, url, data=None, headers=None):
        req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return Resp(r.status, r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return Resp(e.code, e.read().decode("utf-8"))

    urequests.request = request
    sys.modules.update({"cyberpi": cyberpi, "mbot2": mbot2, "mbuild": mbuild, "urequests": urequests,
                        "peekok_test": types.ModuleType("peekok_test")})


def load_fw(sim_ref, **cfg):
    import importlib.util
    spec = importlib.util.spec_from_file_location("peekok_mbot2", FW)
    fw = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fw)
    for k, v in cfg.items():
        setattr(fw, k, v)
    fw.ms = lambda: sim_ref[0].ms()
    fw.nap = lambda t: sim_ref[0].nap(t)
    fw.print = lambda *a, **k: None if os.environ.get("QUIET") else print(*a, **k)
    return fw


def make(floor, x, y, heading_deg, gyro=True, bias=0.03, **cfg):
    ref = [None]
    fake_modules(ref)
    if not gyro:
        del sys.modules["cyberpi"].get_rotation
    fw = load_fw(ref, **cfg)
    sim = Sim(floor, fw, x, y, heading_deg, bias=bias)
    ref[0] = sim
    robot = fw.Robot()
    return fw, sim, robot


def home_pose(floor, jitter=True):
    hx, hy = floor.nodes["H5"]
    # 제자리: 12-5 끝 가로선 바로 앞(바퀴 축이 가로선에서 6cm), 동쪽을 봄. 조금 비뚤게
    return hx + 6, hy + (0.4 if jitter else 0), 4 if jitter else 0


def near(sim, floor, node, cm):
    nx, ny = floor.nodes[node]
    fx, fy = sim.probe_xy(0)
    return math.hypot(fx - nx, fy - ny) <= cm


# ───────── 1. 서버 없이 논리 ─────────
def unit():
    print("== 글자 응답 해석 · 방향 · 센서 판단 ==")
    floor = Floor()
    fw, sim, r = make(floor, *home_pose(floor))
    txt = "ok\nmode to_caller\nrev 40bae05a\npassed -\nnodes 4\nSTART start N 2.06 0\n1:eL elevator - 0.00 2\n2:eL exit S 4.25 0\nEND stop - 0.00 0\nend\n"
    check(r.parse(txt) and r.mode == "to_caller" and r.rev == "40bae05a" and len(r.plan) == 4, "drive 응답 해석 (모드·rev·노드 4개)")
    check(r.plan[1]["a"] == "E" and r.plan[1]["fl"] == 2 and r.plan[2]["h"] == "S" and abs(r.plan[2]["m"] - 4.25) < 1e-9, "노드 줄: 동작·층·방향·거리")
    r.plan[0]["key"] = "same"
    r.parse(txt.replace("passed -", "passed 2:eL"))
    check(r.plan[0]["key"] == "same" and r.passed == "2:eL", "rev 가 같으면 노드를 다시 읽지 않고 passed 만 바뀜")
    check(r.parse(txt.replace("40bae05a", "ffff0000")) and r.plan[0]["key"] == "START", "rev 가 바뀌면 새 계획")
    check(not r.parse("error\n"), "ok 로 시작하지 않으면 무시")
    check([fw.turn_for("N", h) for h in "NESW"] == list("SRUL"), "방향: N 에서 N·E·S·W = 직진·우·유턴·좌")
    check(fw.line_err((0, 1, 1, 0)) == 0 and fw.line_err((0, 1, 0, 0)) == -1 and fw.line_err((0, 0, 0, 1)) == 3 and fw.line_err((0, 0, 0, 0)) is None, "선 위치: 가운데 0 · 왼쪽 − · 오른쪽 + · 없음")
    check(fw.wide((1, 1, 1, 0)) and fw.wide((0, 1, 1, 1)) and fw.wide((1, 1, 1, 1)), "넓은 검정 = 갈림길 (왼쪽·오른쪽·T)")
    check(not fw.wide((1, 1, 0, 0)) and not fw.wide((0, 0, 1, 1)) and not fw.wide((0, 1, 1, 0)), "테이프 한 줄로 덮이는 모양은 갈림길 아님 (쏠림)")
    check(fw.clean_key(' "abc" \n') == "abc", "로봇 키 앞뒤 공백·따옴표 무시")
    hd = fw._headers("application/json")
    check(hd["X-Robot-Body"] == "mbot2" and "X-Robot-Key" in hd, "요청 머리: X-Robot-Body mbot2 · X-Robot-Key")

    print("== 엘리베이터: 화면 '내렸어요'(passed = 출구) 또는 A 버튼으로 다시 출발 ==")
    r.parse(txt.replace("40bae05a", "e1e1e1e1"))
    r.state = fw.ELEVATOR
    r.leg_from = 1
    r.passed = "1:eL"
    r.poll = lambda: r.parse(txt.replace("40bae05a", "e1e1e1e1").replace("passed -", "passed 1:eL"))
    sim.t += 5000
    r.elevator_step()
    check(r.state == fw.ELEVATOR, "신호가 없으면 엘리베이터 앞에서 기다림")
    r.poll = lambda: r.parse(txt.replace("40bae05a", "e1e1e1e1").replace("passed -", "passed 2:eL"))
    sim.t += 5000
    r.elevator_step()
    check(r.state == fw.FOLLOW and r.leg_from == 2 and r.heading == "S", "출구 2:eL 에서 S 방향으로 다시 출발")
    r.state = fw.ELEVATOR
    r.leg_from = 1
    r.passed = "1:eL"
    sent = []
    r.report = lambda a, b: sent.append((a, b)) or True
    sim.buttons.add("a")
    sim.timeline.append((sim.t + 300, lambda: sim.buttons.discard("a")))
    r.elevator_step()
    check(r.state == fw.FOLLOW and sent and '"passed":"2:eL"' in sent[0][1], "A 버튼으로도 출발 · 출구 노드를 보고")
    r.state = fw.ELEVATOR
    r.leg_from = 1
    r.poll = lambda: r.parse(txt.replace("40bae05a", "abcdabcd"))
    sim.t += 5000
    r.elevator_step()
    check(r.state == fw.IDLE, "기다리는 동안 계획이 바뀌면(취소) 처음부터 다시 판단")

    print("== 기록 ==")
    del fw.PENDING[:]
    for i in range(300):
        fw.log("줄", i)
    check(len(fw.PENDING) <= 240 and fw.DROPPED[0] > 0, "기록이 넘치면 오래된 것부터 버리고 개수를 셈")


# ───────── 2. 코스 시험 (서버 없이) ─────────
def course():
    print("== 코스 시험: 제자리 → 12-5 꺾임 L → 12-4 갈림길 S → 위 꺾임 R → 12-3 갈림길 L → T 에서 멈춤 ==")
    floor = Floor()
    fw, sim, r = make(floor, *home_pose(floor))
    sim.max_t = 120000
    r.test_start("LSRLE")
    while r.state == fw.TEST:
        r.step()
    check("정지 (완료)" in fw.LAST_LINE[0], "코스 글자를 끝까지 (%s)" % fw.LAST_LINE[0])
    check(near(sim, floor, "H3", 5), "12-3 앞 T 가로선에서 멈춤 (센서 위치 %.0f,%.0f · 목표 %s)" % (sim.probe_xy(0) + (floor.nodes["H3"],)))

    print("== 선 따라가기 시험 (A) ==")
    fw, sim, r = make(floor, *home_pose(floor))
    sim.max_t = 120000
    r.trace_start()
    while r.state == fw.TRACE:
        r.step()
    check("선을 놓쳤어요" in fw.LAST_LINE[0] or "끝" in fw.LAST_LINE[0], "선 시험 결과를 기록 (%s)" % fw.LAST_LINE[0])


def sweep():
    """몸·바닥이 설정과 조금 달라도 코스를 왕복하는지 (제자리 → 12-3 → 제자리)"""
    print("== 몸·바닥이 조금 달라도 왕복 ==")
    cases = [
        ("기본", {}),
        ("왼쪽 바퀴 8% 셈", {"bias": 0.08}),
        ("오른쪽 바퀴 8% 셈", {"bias": -0.08}),
        ("자이로 없음(바퀴로 각도)", {"gyro": False}),
        ("테이프 2.5cm", {"tape": 2.5}),
        ("테이프 1.5cm", {"tape": 1.5}),
        ("센서 간격 넓음(±1·±3cm)", {"probes": (-3, -1, 1, 3)}),
        ("센서 간격 좁음(±0.6·±1.8cm)", {"probes": (-1.8, -0.6, 0.6, 1.8)}),
        ("센서가 바퀴 축에서 5.5cm", {"ahead": 5.5}),
        ("센서가 바퀴 축에서 9cm", {"ahead": 9.0}),
        ("바퀴 지름 6.0cm(설정 6.5)", {"wheel": 6.0}),
        ("처음 5도 비뚤게", {"skew": 5}),
        ("센서 잡음 2%", {"noise": 0.02}),
        ("느린 반복 (센서 읽기 6ms씩 = 한 번에 24ms)", {"read_ms": 6}),
        ("느린 반복 + 잡음 1% + 오른쪽 바퀴 5% 셈", {"read_ms": 6, "noise": 0.01, "bias": -0.05}),
    ]
    for name, c in cases:
        floor = Floor(tape=c.get("tape", 1.9))
        x, y, h = home_pose(floor)
        Sim.PROBES = dict(zip(("L2", "L1", "R1", "R2"), c.get("probes", (-2.25, -0.75, 0.75, 2.25))))
        Sim.AHEAD = c.get("ahead")
        Sim.WHEEL = c.get("wheel")
        Sim.NOISE = c.get("noise", 0.0)
        Sim.READ_MS = c.get("read_ms", 0)
        fw, sim, r = make(floor, x, y, h + c.get("skew", 0), gyro=c.get("gyro", True), bias=c.get("bias", 0.03))
        sim.max_t = 180000
        r.test_start("LSRLVRLSRE")
        try:
            while r.state == fw.TEST:
                r.step()
            ok = "정지 (완료)" in fw.LAST_LINE[0] and near(sim, floor, "H5", 6)
        except TimeoutError:
            ok = False
        check(ok, "%s: %s" % (name, fw.LAST_LINE[0]))
    Sim.PROBES = {"L2": -2.25, "L1": -0.75, "R1": 0.75, "R2": 2.25}
    Sim.AHEAD = Sim.WHEEL = None
    Sim.NOISE = 0.0
    Sim.READ_MS = 0


# ───────── 3. 로컬 서버와 전체 흐름 ─────────
class Tablet:
    """로봇 화면(robot.html)이 하는 서버 요청을 대신 한다"""

    def __init__(self, base, key):
        self.base, self.key = base.rstrip("/"), key

    def api(self, method, path, body=None, robot=True):
        h = {"Content-Type": "application/json"}
        if robot:
            h["X-Robot-Key"] = self.key
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            raise RuntimeError("%s %s → %s %s" % (method, path, e.code, e.read().decode()))

    def state(self):
        return self.api("GET", "/api/robot")

    def target(self, **a):
        return json.loads(subprocess.check_output(["node", os.path.join(HERE, "plan.mjs"), json.dumps(a)]))

    def pos(self):
        r = self.state()["robot"]
        return r.get("position") or {"floor": 4, "x": 70, "y": 564.5}


def run_until(fw, sim, r, tablet, modes, limit_s=150):
    sim.max_t = sim.t + limit_s * 1000
    last_check = 0
    while True:
        r.step()
        if sim.t - last_check > 1000 and r.state in (fw.IDLE, fw.ERROR):
            last_check = sim.t
            m = tablet.state()["robot"]["mode"]
            if m in modes:
                return m
        if r.state == fw.ERROR:
            raise AssertionError("로봇 오류: " + fw.LAST_LINE[0])


def server(base, key):
    floor = Floor()
    tab = Tablet(base, key)
    fw, sim, r = make(floor, *home_pose(floor), USE_TLS=False, SERVER_HOST=base.split("//")[1].split(":")[0],
                      SERVER_PORT=int(base.rsplit(":", 1)[1].strip("/")), ROBOT_KEY=key, WIFI_SSID="sim")
    tab.api("POST", "/api/robot/reset", {"all": True})

    print("== 켜기: 서버 연결 · 로봇 화면에 'mBot2' ==")
    sim.max_t = 20000
    while not r.server_ready:
        r.step()
    st = tab.state()["robot"]
    check(st["bodyOnline"] and st["bodyKind"] == "mbot2", "서버에 몸체 mBot2 연결됨 (bodyKind=%s)" % st.get("bodyKind"))

    print("== 데려다주기: 제자리 → 12-1 ==")
    tab.api("POST", "/api/robot/guide", {"to_room": "f4-12-1", "to_label": "12-1반", "target": tab.target(room="f4-12-1")})
    m = run_until(fw, sim, r, tab, ("guided",))
    check(m == "guided" and near(sim, floor, "H1", 6), "12-1 T 앞에 도착 → guided")
    prog = tab.state()["robot"]
    check(prog["position"] is not None, "도착 위치 기록")

    print("== 데려다주기 마침 → 제자리 ==")
    tab.api("POST", "/api/robot/cancel", {})
    tab.api("POST", "/api/robot/target", {"target": tab.target(**{"from": tab.pos(), "home": True})})
    m = run_until(fw, sim, r, tab, ("idle",))
    check(m == "idle" and near(sim, floor, "H5", 6), "12-5 제자리 T 앞에 돌아옴 → idle")

    print("== 배달: 12-3 에서 불러 12-2 로 ==")
    call = tab.api("POST", "/api/calls", {"from_room": "f4-12-3", "from_label": "12-3반", "to_room": "f4-12-2", "to_label": "12-2반", "caller": "시험"}, robot=False)
    q = tab.state()["queue"]
    check(len(q) == 1, "기다리는 호출 1건")
    tab.api("POST", "/api/robot/accept", {"id": q[0]["id"], "target": tab.target(**{"from": tab.pos(), "room": "f4-12-3"})})
    m = run_until(fw, sim, r, tab, ("loading",))
    check(m == "loading" and near(sim, floor, "H3", 6), "부른 곳(12-3) 도착 → loading")
    tab.api("POST", "/api/robot/depart", {"to_room": "f4-12-2", "to_label": "12-2반", "target": tab.target(**{"from": tab.pos(), "room": "f4-12-2"})})
    m = run_until(fw, sim, r, tab, ("at_recipient",))
    check(m == "at_recipient" and near(sim, floor, "H2", 6), "받는 곳(12-2) 도착 → at_recipient")
    tab.api("POST", "/api/robot/delivered", {})
    tab.api("POST", "/api/robot/target", {"target": tab.target(**{"from": tab.pos(), "home": True})})
    m = run_until(fw, sim, r, tab, ("idle",))
    check(m == "idle" and near(sim, floor, "H5", 6), "제자리 → idle")
    c = tab.api("GET", "/api/calls/%s?t=%s" % (call["id"], call["token"]), robot=False)
    check((c.get("call") or c).get("status") == "delivered", "호출 기록 delivered")

    print("== 달리는 중 새 계획 (rev 바뀜): 12-1 로 가다가 12-4 로 ==")
    tab.api("POST", "/api/robot/guide", {"to_room": "f4-12-1", "to_label": "12-1반", "target": tab.target(room="f4-12-1")})
    sim.max_t = sim.t + 60000
    while True:
        r.step()
        st = tab.state()["robot"] if r.state == fw.FOLLOW and r.leg_from == 2 and r.b.odo() - r.leg_dist0 > 20 else None
        if st:
            break
    # 로봇 화면처럼 지금 위치(locate)에서 새 계획
    # 서버 시각 기준 지난 시간 = 시뮬레이션에서 그 구간을 달린 시간
    new = tab.target(plan=st["target"]["plan"], progress=st["progress"], now=st["progress"]["at"] + (sim.t - r.leg_start), room="f4-12-4")
    check([n["action"] for n in new["plan"]["nodes"]][:2] == ["start", "right"], "새 계획: 복도 중간에서 출발(유턴) → 12-4 갈림길에서 우회전")
    tab.api("POST", "/api/robot/target", {"target": new})
    r.last_poll = 0
    m = run_until(fw, sim, r, tab, ("guided",))
    check(m == "guided" and near(sim, floor, "H4", 6), "계획 바뀜 → 멈추고 다시 판단 → 12-4 도착")
    tab.api("POST", "/api/robot/cancel", {})
    tab.api("POST", "/api/robot/target", {"target": tab.target(**{"from": tab.pos(), "home": True})})
    m = run_until(fw, sim, r, tab, ("idle",))
    check(m == "idle" and near(sim, floor, "H5", 6), "다시 제자리")

    print("== urequests 가 없는 CyberPi: 소켓으로 직접 ==")
    import builtins
    real_import = builtins.__import__

    def no_urequests(n, *a, **k):
        if n == "urequests":
            raise ImportError(n)
        return real_import(n, *a, **k)
    builtins.__import__ = no_urequests
    try:
        code, txt = fw.http("GET", "/api/robot/drive")
    finally:
        builtins.__import__ = real_import
    check(code == 200 and txt.startswith("ok"), "소켓 HTTP 로도 drive 응답")

    print("== 원격 기록 ==")
    r.flush()
    lines = tab.api("GET", "/api/robot/log?limit=50")["lines"]
    check(len(lines) > 5 and all(l["body"] == "mbot2" for l in lines), "기록이 서버 robot_log 에 (몸체 mbot2)")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "unit"
    if what == "unit":
        unit()
    elif what == "course":
        course()
        sweep()
    elif what == "server":
        server(sys.argv[2], sys.argv[3])
    print("\n%s" % ("모두 통과" if not FAILS else "실패 %d개: %s" % (len(FAILS), FAILS)))
    sys.exit(1 if FAILS else 0)
