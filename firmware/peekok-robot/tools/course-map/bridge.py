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
import argparse, json, math, os, socket, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))

# ───────── 지도 (사진의 코스를 그대로 옮김, 단위 = 사진 픽셀) ─────────
MID_Y = 455
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
TURN_WORD = {'L': '좌회전', 'R': '우회전', 'U': '유턴'}
SIDE_WORD = {'L': '왼쪽 분기', 'R': '오른쪽 분기', 'T': 'T자', 'end': '선 끝', 'S': '직진'}


class Locator:
    def __init__(self):
        self.flip = False          # 지도를 위아래로 뒤집었는지
        self.flip_known = False    # 첫 분기로 방향을 확인했는지
        self.speed = 40.0          # 추정 속도 (픽셀/초)
        self.lock = threading.RLock()
        self.reset()

    # ── 기하 ──
    def p(self, n):
        x, y = NODES[n]
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

    def note(self, msg):
        self.events.append({'t': time.strftime('%H:%M:%S'), 'msg': msg})
        self.events = self.events[-30:]

    def start(self):
        with self.lock:
            self.reset()
            self.mode = 'follow'
            self.status = '선 따라가는 중'
            self.note('출발 — 출발점에서 분기 1 쪽으로')

    def tick(self, dt):
        with self.lock:
            if self.mode == 'turning' and time.time() - self.turn_since > 4.0:
                self.finish_turn('(회전 끝 기록이 없어 시간으로 판단)')
            if self.mode != 'follow': return
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
            if any(k in line for k in ('[판단]', '[회전]', '[유턴]', '[되돌기]', '[자동]')):
                self.turn_since = time.time()
            if '[자동] 한쪽 분기 → 그쪽으로' in line:
                self.start()
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
                if self.mode != 'stopped': self.mode = 'stopped'
                self.status = '멈춤 — ' + line.split('끝:', 1)[-1].strip()
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
        if kind in 'LR' and best: self.flip_known = True
        if best is None:
            self.note(f'{SIDE_WORD[kind]}를 봤는데 지도에서 맞는 곳이 없음 (위치 그대로)')
            return
        _, node, frm, d = best
        if self.follow_t > 1.5:                           # 속도 스스로 맞추기
            true = self.odo + d
            if true > 30:
                self.speed = max(5.0, min(300.0, 0.6 * self.speed + 0.4 * true / self.follow_t))
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

    def finish_turn(self, why=''):
        self.mode = 'follow'
        self.follow_t = 0.0; self.odo = 0.0
        self.status = '선 따라가는 중'
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


def demo_run(run_id):
    """오른쪽 분기 → 왼쪽 분기 → … → 끝점 순서의 가짜 주행 기록 (60픽셀/초)"""
    v = 60.0
    def go(px):
        end = time.time() + px / v
        while time.time() < end:
            if DEMO['run'] != run_id: raise SystemExit
            time.sleep(0.05)
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


def command(text):
    text = text.strip()
    if text == 'reset': LOC.reset(); return
    if text == 'flip':
        with LOC.lock: LOC.flip = not LOC.flip; LOC.flip_known = True; LOC.reset()
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
