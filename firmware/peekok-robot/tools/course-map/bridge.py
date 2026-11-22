#!/usr/bin/env python3
"""피콕 코스 지도 — 로봇 위치를 실시간으로 웹에 보여 주는 로컬 프로그램 (추가 설치 없음)

  python3 bridge.py            로봇(peekok-robot.local:2323)에 WiFi 로 붙어서 http://localhost:8790 에 지도
  python3 bridge.py --demo     로봇 없이 가짜 주행 기록으로 시험
  python3 bridge.py --host 192.168.0.17

위치를 아는 방법 (회전·유턴 기준):
  - 로봇이 분기/T자를 판단할 때([판단] 왼쪽/오른쪽 분기 · T자) 지도에서 그 모양이 나오는 가장 가까운 점에 위치를 맞춤
  - 회전·유턴([자동] … 좌회전/우회전/유턴)으로 어느 길에 들어갔는지 바꿈
  - 점과 점 사이는 달린 시간 × 속도 (속도는 점을 지날 때마다 스스로 맞춤)
  - 첫 분기에서 왼쪽/오른쪽이 지도와 반대면 지도를 위아래로 뒤집음 (사진을 반대쪽에서 찍은 경우)

로봇 시리얼(TCP 2323)은 한 번에 하나만 붙을 수 있어서, 이 프로그램을 켜 두는 동안은 run 대신 웹 화면의 버튼을 쓴다.
"""
import argparse, heapq, json, math, os, socket, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
SETTINGS = os.path.join(HERE, '.settings.json')   # 지도 방향(뒤집기) 기억 — 저장소에 올리지 않음

# ───────── 지도 (사진의 코스를 그대로 옮김, 단위 = 사진 픽셀) ─────────
MID_Y = 455
MID_X = (68 + 1075) / 2    # 좌우 뒤집기 기준
NODES = {
    'S': (1075, 455), 'J1': (810, 455), 'J2': (575, 455), 'J3': (315, 455), 'J4': (175, 455), 'F': (68, 455),
    'B1': (810, 762), 'B2': (575, 172), 'B3': (315, 762), 'B4': (175, 205),
}
EDGES = [('S', 'J1'), ('J1', 'J2'), ('J2', 'J3'), ('J3', 'J4'), ('J4', 'F'),
         ('J1', 'B1'), ('J2', 'B2'), ('J3', 'B3'), ('J4', 'B4')]
CAPS = {'B1', 'B2', 'B3', 'B4', 'F'}          # 끝에 가로선(T)이 있는 점
NAMES = {'S': '출발점', 'F': '끝점', 'J1': '분기 1', 'J2': '분기 2', 'J3': '분기 3', 'J4': '분기 4',
         'B1': '분기 1 끝', 'B2': '분기 2 끝', 'B3': '분기 3 끝', 'B4': '분기 4 끝'}
NBR = {n: [] for n in NODES}
for a, b in EDGES:
    NBR[a].append(b); NBR[b].append(a)
TURN_WORD = {'L': '좌회전', 'R': '우회전', 'U': '유턴', 'S': '직진', 'V': '도착 후 유턴', 'E': '도착·멈춤'}
TARGETS = {'1': 'B1', '2': 'B2', '3': 'B3', '4': 'B4', 'F': 'F', '끝': 'F'}   # 목적지로 고를 수 있는 곳 (끝에 가로선이 있어야 도착을 앎)
JUDGE_LINE = {'L': '[판단] 뒤 왼쪽만 → 왼쪽 분기', 'R': '[판단] 뒤 오른쪽만 → 오른쪽 분기', 'T': '[판단] 뒤 센서 양쪽 → T자'}
SIDE_WORD = {'L': '왼쪽 분기', 'R': '오른쪽 분기', 'T': 'T자', 'end': '선 끝', 'S': '직진'}


class Locator:
    def __init__(self):
        # 지도를 위아래로 뒤집었는지 — 처음 값은 '출발해서 첫 분기가 오른쪽'(사진은 반대쪽에서 찍힘)
        self.flip = True
        self.mirror = True         # 좌우 뒤집기: 출발점이 왼쪽, 출발해서 분기 1 이 로봇 왼쪽 (사용자 확인)
        self.flip_known = False    # 실제 주행이나 버튼으로 방향을 확인했는지
        try:
            with open(SETTINGS) as f: st = json.load(f)
            self.flip = bool(st['flip']); self.flip_known = True
            self.speed = float(st.get('speed', self.speed))
            self.mirror = bool(st.get('mirror', self.mirror))
        except (OSError, ValueError, KeyError):
            pass
        self.plan_pts = []; self.plan_route = ''; self.plan_names = []
        self.speed = 40.0          # 추정 속도 (픽셀 / 바퀴 돌린 1초) — 분기를 지날 때마다 스스로 맞추고 기억
        self.lock = threading.RLock()
        self.reset()

    # ── 기하 ──
    def p(self, n):
        x, y = NODES[n]
        if self.mirror: x = 2 * MID_X - x
        return (x, 2 * MID_Y - y) if self.flip else (x, y)

    def length(self, a, b):
        (x1, y1), (x2, y2) = self.p(a), self.p(b)
        return math.hypot(x2 - x1, y2 - y1)

    def unit(self, a, b):
        (x1, y1), (x2, y2) = self.p(a), self.p(b)
        L = math.hypot(x2 - x1, y2 - y1) or 1
        return ((x2 - x1) / L, (y2 - y1) / L)

    def side(self, h, v):
        """h 방향으로 오다가 v 방향으로 가면? S 직진 · L · R · U (화면 좌표: y 가 아래로)"""
        dot = h[0] * v[0] + h[1] * v[1]
        cross = h[0] * v[1] - h[1] * v[0]
        if dot > 0.7: return 'S'
        if dot < -0.7: return 'U'
        return 'R' if cross > 0 else 'L'

    def expected(self, node, frm):
        """frm 에서 node 로 왔을 때 뒤 센서가 보게 될 모양"""
        h = self.unit(frm, node)
        sides = {self.side(h, self.unit(node, n)) for n in NBR[node] if n != frm}
        if not sides: return 'T' if node in CAPS else 'end'
        if 'L' in sides and 'R' in sides: return 'T'
        if 'L' in sides: return 'L'
        if 'R' in sides: return 'R'
        return 'S'

    def straight_next(self, a, b):
        h = self.unit(a, b)
        for n in NBR[b]:
            if n != a and self.side(h, self.unit(b, n)) == 'S': return n
        return None

    # ── 상태 ──
    def save_flip(self):
        try:
            with open(SETTINGS, 'w') as f: json.dump({'flip': self.flip, 'mirror': self.mirror, 'speed': round(self.speed, 2)}, f)
        except OSError:
            pass

    def set_flip(self, v):
        with self.lock:
            self.flip = v; self.flip_known = True; self.save_flip(); self.reset()

    # ── 경로 계산: 지금 위치 → 목적지들 (분기에서 유턴은 못 하고, 끝에 가로선이 있는 곳에서만 유턴) ──
    def shortest(self, a, b, goal):
        start = (a, b)
        dist = {start: 0.0}; prev = {}
        q = [(0.0, a, b)]
        while q:
            c, p, n = heapq.heappop(q)
            if c > dist.get((p, n), 1e18): continue
            if n == goal:
                path = [n, p]; st = (p, n)
                while st in prev:
                    st = prev[st]; path.append(st[0])
                return path[::-1]
            for m in NBR[n]:
                if m == p and n not in CAPS: continue
                nc = c + self.length(n, m)
                if nc < dist.get((n, m), 1e18):
                    dist[(n, m)] = nc; prev[(n, m)] = (p, n); heapq.heappush(q, (nc, n, m))
        return None

    def plan(self, targets):
        """→ (경로 글자, 지도에 그릴 점들, 데모용 단계, 오류)"""
        with self.lock:
            nodes = []
            for t in targets:
                if t not in TARGETS: return None, [], [], f'목적지 "{t}" 를 모르겠어요 (1~4, F)'
                nodes.append(TARGETS[t])
            if not nodes: return None, [], [], '목적지를 골라 주세요'
            a, b, d = self.a, self.b, self.d
            route = ''; steps = []
            first = self.length(a, b) - d
            if d >= self.length(a, b) - 0.5 and self.mode != 'follow':
                if b in CAPS:                               # 끝(가로선)에 서 있음 → 먼저 제자리 유턴
                    route = 'u'; a, b = b, a; first = self.length(a, b)
                else:
                    n = self.straight_next(a, b)            # 분기 위에 서 있음 → 그 분기는 이미 지남
                    if n: a, b = b, n; first = self.length(a, b)
            pts = [self.snapshot_xy()]
            for i, goal in enumerate(nodes):
                path = self.shortest(a, b, goal)
                if not path: return None, [], [], f'{NAMES[goal]}로 가는 길이 없어요'
                travel = first
                for k in range(1, len(path)):
                    frm, node = path[k - 1], path[k]
                    pts.append(self.p(node))
                    if k > 1: travel += self.length(frm, node)
                    if k == len(path) - 1:
                        act = 'E' if i == len(nodes) - 1 else 'V'
                    elif self.expected(node, frm) == 'S':
                        continue
                    else:
                        act = self.side(self.unit(frm, node), self.unit(node, path[k + 1]))
                    route += act; steps.append((travel, node, frm, act)); travel = 0.0
                a, b = goal, path[-2]
                first = self.length(a, b)
            self.plan_route = route; self.plan_pts = pts; self.plan_names = [NAMES[n] for n in nodes]
            return route, pts, steps, None

    def snapshot_xy(self):
        L = self.length(self.a, self.b) or 1
        f = min(1.0, self.d / L)
        (x1, y1), (x2, y2) = self.p(self.a), self.p(self.b)
        return (x1 + (x2 - x1) * f, y1 + (y2 - y1) * f)

    def reset(self):
        with self.lock:
            self.a, self.b, self.d = 'S', 'J1', 0.0
            self.mode = 'idle'
            self.status = '대기 — 로봇을 출발점에 두고 시작'
            self.follow_t = 0.0
            self.odo = 0.0
            self.turn_since = 0.0
            self.trail = [self.p('S')]
            self.events = []
            self.last_m = None
            self.m_seen = getattr(self, 'm_seen', 0.0)

    def note(self, msg):
        self.events.append({'t': time.strftime('%H:%M:%S'), 'msg': msg})
        self.events = self.events[-30:]

    def start(self):
        with self.lock:
            self.reset()
            self.mode = 'follow'
            self.plan_pts = []; self.plan_route = ''; self.plan_names = []
            self.status = '선 따라가는 중 (자동)'
            self.note('출발 — 출발점에서 분기 1 쪽으로')

    def tick(self, dt):
        with self.lock:
            if self.mode == 'turning' and (time.time() - self.turn_since > 8.0 or (self.m_seen and self.last_m is not None)):
                self.finish_turn('(회전 끝 기록이 없어 시간으로 판단)')
            if self.mode != 'follow': return
            if self.m_seen: return     # 로봇이 바퀴 시간(@m)을 보내 오면 그걸로만 움직임 (멈춰 있을 땐 안 움직임)
            self.advance(dt)

    def on_move(self, m):
        """로봇이 보낸 바퀴 돌린 시간(ms) — 실제로 바퀴가 돈 만큼만 앞으로 (멈칫·끊어 가기 그대로 반영)"""
        with self.lock:
            self.m_seen = time.time()
            if self.mode == 'follow' and self.last_m is not None and 0 <= m - self.last_m < 2000:
                self.advance((m - self.last_m) / 1000.0)
            self.last_m = m

    def advance(self, dt):
            step = self.speed * dt
            self.follow_t += dt
            self.d += step
            self.odo += step
            while self.d >= self.length(self.a, self.b):
                nxt = self.straight_next(self.a, self.b)
                if nxt is None:                          # 길 끝 → 끝에서 기다림
                    over = self.d - self.length(self.a, self.b)
                    self.d -= over; self.odo -= over
                    break
                self.d -= self.length(self.a, self.b)
                self.a, self.b = self.b, nxt

    def where(self):
        if self.d >= self.length(self.a, self.b) - 0.5: return NAMES[self.b]
        if self.d < 0.5 and self.mode == 'turning': return NAMES[self.a]
        ends = {self.a, self.b}
        if ends & {'B1', 'B2', 'B3', 'B4'}:
            j = [n for n in ends if n.startswith('J')]
            return f'{NAMES[j[0]]} 길' if j else '분기 길'
        order = ['S', 'J1', 'J2', 'J3', 'J4', 'F']
        i, k = sorted((order.index(self.a), order.index(self.b)))
        return f'직진 도로 ({NAMES[order[i]]} ~ {NAMES[order[k]]})'

    # ── 로봇 기록 한 줄 ──
    def on_line(self, line):
        with self.lock:
            if any(k in line for k in ('[판단]', '[회전]', '[유턴]', '[되돌기]', '[자동]', '[경로]', '[코스 시험]')):
                self.turn_since = time.time()
                self.last_m = None          # 회전·물러나기에 쓴 바퀴 시간은 길 따라 간 거리에 넣지 않음
            if '[자동] 한쪽 분기 → 그쪽으로' in line:
                self.start()
            elif line.startswith('[경로]') and '출발' in line:
                self.mode = 'follow'; self.follow_t = 0.0; self.odo = 0.0
                self.status = '경로 주행 중 → ' + ' → '.join(self.plan_names)
                self.note('경로 출발: ' + ' → '.join(self.plan_names))
            elif line.startswith('[경로] 먼저 제자리 유턴'):
                self.on_action('U')
            elif line.startswith('[코스 시험]') and '번째 표시 →' in line:
                act = line.rsplit('→', 1)[-1].strip()[:1]
                if act in ('L', 'R', 'U'): self.on_action(act)
                elif act == 'V': self.note(f'{NAMES[self.b]} 도착!'); self.on_action('U')
                elif act == 'S': self.on_straight()
                elif act == 'E':
                    self.mode = 'stopped'; self.status = f'{NAMES[self.b]} 도착 (멈춤)'; self.note(self.status)
                    self.plan_pts = []
            elif line.startswith('[판단]'):
                kind = 'T' if '양쪽' in line else 'L' if '왼쪽' in line else 'R' if '오른쪽' in line else None
                if kind: self.on_judge(kind)
            elif line.startswith('[자동]') and ('→' in line):
                t = 'U' if line.rstrip().endswith('유턴') else 'L' if '좌회전' in line else 'R' if '우회전' in line else None
                if t: self.on_action(t)
            elif line.startswith('[되돌기]'):
                if self.mode == 'turning': self.finish_turn()
            elif '왔던 선을 끝내 못 찾음' in line:
                self.mode = 'stopped'; self.status = '유턴하다 선을 못 찾고 멈춤'; self.note(self.status)
            elif line.startswith('[코스 시험] 끝'):
                why = line.split('끝:', 1)[-1].strip()
                if self.mode == 'stopped' and '도착' in self.status: return
                self.mode = 'stopped'
                self.status = '멈춤 — ' + why
                self.note(self.status)

    def candidates(self):
        """지금 위치 앞뒤로 판단 후보 점: (점, 그 점으로 들어온 이전 점, 지금 위치에서의 거리)"""
        out = []
        if self.d < 150: out.append((self.a, self.prev_of(self.a, self.b), -self.d))
        dist = self.length(self.a, self.b) - self.d
        a, b = self.a, self.b
        for _ in range(4):
            out.append((b, a, dist))
            n = self.straight_next(a, b)
            if n is None: break
            dist += self.length(b, n)
            a, b = b, n
        return out

    def prev_of(self, node, ahead):
        """node 로 들어오던 직진 방향의 이전 점 (없으면 ahead 반대쪽 아무거나)"""
        h = self.unit(node, ahead)
        for n in NBR[node]:
            if n != ahead and self.side(self.unit(n, node), h) == 'S': return n
        return next((n for n in NBR[node] if n != ahead), ahead)

    def on_judge(self, kind):
        def pick():
            m = [(abs(d), node, frm, d) for node, frm, d in self.candidates() if self.expected(node, frm) == kind]
            return min(m) if m else None
        best = pick()
        if kind in 'LR' and not self.flip_known:     # 방향 확인 전: 뒤집은 지도와 비교해 더 가까운 쪽
            self.flip = not self.flip
            other = pick()
            if other and (best is None or other[0] < best[0]):
                best = other
                self.trail = [self.p('S')]
                self.note('왼쪽/오른쪽이 사진과 반대 → 지도를 위아래로 뒤집음')
            else:
                self.flip = not self.flip
        if kind in 'LR' and best and not self.flip_known: self.flip_known = True; self.save_flip()
        if best is None:
            self.note(f'{SIDE_WORD[kind]}를 봤는데 지도에서 맞는 곳이 없음 (위치 그대로)')
            return
        _, node, frm, d = best
        if self.follow_t > 1.5:                           # 속도 스스로 맞추기
            true = self.odo + d
            if true > 30:
                self.speed = max(5.0, min(300.0, 0.6 * self.speed + 0.4 * true / self.follow_t))
                if self.flip_known: self.save_flip()
        self.a, self.b, self.d = frm, node, self.length(frm, node)
        self.trail.append(self.p(node)); self.trail = self.trail[-60:]
        self.mode = 'junction'
        self.status = f'{NAMES[node]}에서 {SIDE_WORD[kind]} 판단'
        self.note(self.status + (f' (예상과 {abs(d):.0f}px 차이 보정)' if abs(d) > 20 else ''))
        self.follow_t = 0.0; self.odo = 0.0

    def on_action(self, t):
        node, frm = self.b, self.a
        if self.mode not in ('junction',):               # 판단 기록 없이 회전 → 앞의 점에서 도는 것으로
            self.d = self.length(frm, node)
        h = self.unit(frm, node)
        if t == 'U':
            nxt = frm
        else:
            nxt = next((n for n in NBR[node] if n != frm and self.side(h, self.unit(node, n)) == t), None)
        if nxt is None:
            self.note(f'{NAMES[node]}에서 {TURN_WORD[t]}할 길이 지도에 없음')
            return
        self.a, self.b, self.d = node, nxt, 0.0
        self.mode = 'turning'
        self.turn_since = time.time()
        self.status = f'{NAMES[node]}에서 {TURN_WORD[t]} 중'
        self.note(f'{NAMES[node]}에서 {TURN_WORD[t]} → {NAMES[nxt]} 쪽으로')

    def on_straight(self):
        nxt = self.straight_next(self.a, self.b)
        if nxt:
            self.note(f'{NAMES[self.b]} 직진')
            self.a, self.b, self.d = self.b, nxt, 0.0
        self.mode = 'follow'; self.follow_t = 0.0; self.odo = 0.0
        self.status = '경로 주행 중 → ' + ' → '.join(self.plan_names) if self.plan_names else '선 따라가는 중'

    def finish_turn(self, why=''):
        self.mode = 'follow'
        self.follow_t = 0.0; self.odo = 0.0
        self.status = '경로 주행 중 → ' + ' → '.join(self.plan_names) if self.plan_pts else '선 따라가는 중'
        if why: self.note('회전 끝 ' + why)

    def snapshot(self):
        with self.lock:
            L = self.length(self.a, self.b) or 1
            f = min(1.0, self.d / L)
            (x1, y1), (x2, y2) = self.p(self.a), self.p(self.b)
            hx, hy = self.unit(self.a, self.b)
            return {
                'x': x1 + (x2 - x1) * f, 'y': y1 + (y2 - y1) * f,
                'angle': math.degrees(math.atan2(hy, hx)),
                'mode': self.mode, 'status': self.status, 'where': self.where(),
                'speed': round(self.speed, 1), 'flip': self.flip,
                'lines': [[*self.p(a), *self.p(b)] for a, b in EDGES],
                'caps': [self.cap_line(n) for n in CAPS],
                'labels': [{'x': self.p(n)[0], 'y': self.p(n)[1], 'name': NAMES[n], 'kind': n[0]} for n in NODES],
                'trail': self.trail, 'events': self.events,
                'flip_known': self.flip_known, 'plan': self.plan_pts, 'route': self.plan_route,
                'targets': [{'key': k, 'x': self.p(n)[0], 'y': self.p(n)[1]} for k, n in TARGETS.items() if k != '끝'],
            }

    def cap_line(self, n):
        x, y = self.p(n)
        o = NBR[n][0]
        hx, hy = self.unit(o, n)
        return [x - hy * 48, y + hx * 48, x + hy * 48, y - hx * 48]


LOC = Locator()
LOG = []                     # 로봇 기록 최근 줄
STATE = {'connected': False, 'host': ''}
ROBOT = {'sock': None, 'lock': threading.Lock()}
DEMO = {'on': False, 'run': 0}


def handle_line(line):
    line = line.strip('\r')
    if not line: return
    if line.startswith('@m '):
        try: LOC.on_move(int(line[3:]))
        except ValueError: pass
        return
    LOG.append(line); del LOG[:-200]
    print(line, flush=True)
    LOC.on_line(line)


def send_robot(text):
    with ROBOT['lock']:
        s = ROBOT['sock']
        if s:
            try: s.sendall(text.encode())
            except OSError: pass


def robot_thread(host):
    while True:
        try:
            s = socket.create_connection((host, 2323), timeout=5)
            s.settimeout(None)
            with ROBOT['lock']: ROBOT['sock'] = s
            STATE['connected'] = True
            handle_line(f'[지도] 로봇에 연결됨 ({host})')
            s.sendall(b'@')                 # 위치 보고(@m) 켜기
            buf = b''
            while True:
                data = s.recv(4096)
                if not data: break
                buf += data
                while b'\n' in buf:
                    raw, buf = buf.split(b'\n', 1)
                    handle_line(raw.decode('utf-8', 'replace'))
        except OSError as e:
            if STATE['connected'] or not STATE.get('warned'):
                handle_line(f'[지도] 로봇 연결 안 됨 ({host}): {e} — 2초 뒤 다시')
                STATE['warned'] = True
        STATE['connected'] = False
        with ROBOT['lock']: ROBOT['sock'] = None
        time.sleep(2)


def demo_go(run_id, px):
    """가짜 로봇: 65% 끊어 가기 · 바퀴 1초에 60픽셀 · 0.1초마다 @m 보고"""
    m = DEMO.setdefault('m', 0)
    done = 0.0; k = 0
    while done < px:
        if DEMO['run'] != run_id: raise SystemExit
        time.sleep(0.1); k += 1
        if k % 20 < 7: continue                      # 끊어 가기: 쉬는 동안은 바퀴 시간이 안 늚
        dm = 100
        done += 60.0 * dm / 1000; DEMO['m'] = DEMO['m'] + dm
        handle_line(f'@m {DEMO["m"]}')


def demo_run(run_id):
    """오른쪽 분기 → 왼쪽 분기 → … → 끝점 순서의 가짜 주행 기록 (60픽셀/초)"""
    def go(px):
        demo_go(run_id, px)
    def say(*lines):
        for ln in lines:
            if DEMO['run'] != run_id: raise SystemExit
            handle_line(ln)
    def branch(side, dist, blen):
        word = '왼쪽' if side == 'L' else '오른쪽'
        turn = '좌회전' if side == 'L' else '우회전'
        go(dist)
        say(f'[판단] 뒤 {word}만 → {word} 분기 (판단하며 150ms 더 감 → 그만큼 물러남)', f'[자동] {word} 분기 → {turn}')
        time.sleep(2); say('[되돌기] 선이 앞 두 센서 사이에 들어옴 → 직진')
        go(blen)
        say('[판단] 뒤 센서 양쪽 → T자 (판단하며 150ms 더 감 → 그만큼 물러남)', '[자동] T자 → 유턴')
        time.sleep(3); say('[되돌기] 선이 앞 두 센서 사이에 들어옴 → 직진')
        go(blen)
        say('[판단] 뒤 센서 양쪽 → T자 (판단하며 150ms 더 감 → 그만큼 물러남)', f'[자동] 유턴 뒤 T자 = 직진 도로 → {turn} (들어갔던 쪽)')
        time.sleep(2); say('[되돌기] 선이 앞 두 센서 사이에 들어옴 → 직진')
    try:
        say('[자동] 한쪽 분기 → 그쪽으로 · T자(뒤 센서 양쪽) → 제자리 유턴 · 유턴 다음 T자 = 직진 도로 (x 로 멈춤)')
        branch('R', 265, 307); branch('L', 235, 283); branch('R', 260, 307); branch('L', 140, 250)
        go(107)
        say('[판단] 뒤 센서 양쪽 → T자 (판단하며 150ms 더 감 → 그만큼 물러남)', '[자동] T자 → 유턴')
        time.sleep(3)
        say('[코스 시험] 끝: 데모 끝 (끝점)')
    except SystemExit:
        pass


def demo_route(run_id, route, steps):
    """계산한 경로대로 달리는 가짜 기록 (60픽셀/초)"""
    def go(px):
        demo_go(run_id, px)
    def say(*lines):
        for ln in lines:
            if DEMO['run'] != run_id: raise SystemExit
            handle_line(ln)
    try:
        say(f'[경로] "{route.lstrip("u")}" 출발' + (' (먼저 제자리 유턴)' if route.startswith('u') else ''))
        if route.startswith('u'):
            say('[경로] 먼저 제자리 유턴'); time.sleep(2.5); say('[되돌기] 선이 앞 두 센서 사이에 들어옴 → 직진')
        for i, (dist, node, frm, act) in enumerate(steps, 1):
            go(dist)
            say(JUDGE_LINE.get(LOC.expected(node, frm), '[판단] ?'), f'[코스 시험] {i}번째 표시 → {act}')
            if act == 'E':
                say('[도착] 마지막 목적지', '[코스 시험] 끝: 정지 (완료)'); return
            if act == 'V':
                say('[도착] 목적지 — 2초 쉬고 유턴해서 다음 목적지로'); time.sleep(2)
            if act != 'S':
                time.sleep(2.5); say('[되돌기] 선이 앞 두 센서 사이에 들어옴 → 직진')
    except SystemExit:
        pass


def command(text):
    text = text.strip()
    if text == 'reset': LOC.reset(); return
    if text == 'flip': LOC.set_flip(not LOC.flip); return
    if text == 'mirror':
        with LOC.lock: LOC.mirror = not LOC.mirror
        LOC.set_flip(LOC.flip); return
    if text.startswith('go'):
        targets = text[2:].replace(',', ' ').replace('→', ' ').split()
        route, pts, steps, err = LOC.plan(targets)
        if err: handle_line('[지도] ' + err); return
        handle_line(f'[지도] 경로 {" → ".join(LOC.plan_names)} = "{route}" 보냄')
        if DEMO['on']:
            DEMO['run'] += 1
            threading.Thread(target=demo_route, args=(DEMO['run'], route, steps), daemon=True).start()
        else:
            send_robot('x'); time.sleep(0.4); send_robot('G' + route + '\n')
        return
    if text.startswith('plan'):
        t = text[4:].replace(',', ' ').split()
        if t: LOC.plan(t)
        else: LOC.plan_pts = []; LOC.plan_route = ''
        return
    if DEMO['on']:
        if text == 'j':
            DEMO['run'] += 1
            threading.Thread(target=demo_run, args=(DEMO['run'],), daemon=True).start()
        elif text == 'x':
            DEMO['run'] += 1; handle_line('[코스 시험] 끝: 멈춤 요청')
        return
    if text == 'j':
        send_robot('x'); time.sleep(0.4); send_robot('j')
    elif text:
        send_robot(text if len(text) == 1 else text + '\n')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_GET(self):
        if self.path in ('/', '/index.html'):
            body = open(os.path.join(HERE, 'index.html'), 'rb').read()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        elif self.path == '/events':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream'); self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            try:
                while True:
                    snap = LOC.snapshot()
                    snap.update(connected=STATE['connected'] or DEMO['on'], demo=DEMO['on'], host=STATE['host'], log=LOG[-40:])
                    self.wfile.write(b'data: ' + json.dumps(snap, ensure_ascii=False).encode() + b'\n\n')
                    self.wfile.flush()
                    time.sleep(0.1)
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != '/cmd': return self.send_error(404)
        n = int(self.headers.get('Content-Length') or 0)
        command(self.rfile.read(n).decode('utf-8', 'replace'))
        self.send_response(204); self.end_headers()


def ticker():
    last = time.time()
    while True:
        time.sleep(0.05)
        now = time.time()
        LOC.tick(now - last)
        last = now


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default=os.environ.get('ROBOT_HOST', 'peekok-robot.local'))
    ap.add_argument('--port', type=int, default=8790)
    ap.add_argument('--demo', action='store_true')
    args = ap.parse_args()
    STATE['host'] = 'demo' if args.demo else args.host
    DEMO['on'] = args.demo
    threading.Thread(target=ticker, daemon=True).start()
    if not args.demo:
        threading.Thread(target=robot_thread, args=(args.host,), daemon=True).start()
    print(f'[지도] http://localhost:{args.port} 를 브라우저로 여세요 · ' + ('데모 모드' if args.demo else f'로봇 {args.host}:2323'), flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
