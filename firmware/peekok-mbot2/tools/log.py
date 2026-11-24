# mBot2 기록(로그) 보기 — 서버 /api/robot/log 에서 최근 기록을 가져와 보여 준다.
#   python tools/log.py            최근 200줄
#   python tools/log.py 500        최근 500줄 (최대 1000)
#   python tools/log.py -f         새 기록을 3초마다 계속 (Ctrl+C 로 멈춤)
# 로봇 키·서버 주소는 config.py 에서 읽고, 키는 화면에 내지 않는다.
import ast
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, "..", "config.py")


def config():
    vals = {}
    try:
        tree = ast.parse(open(CFG, encoding="utf-8").read())
    except FileNotFoundError:
        sys.exit("config.py 가 없어요 — config.example.py 를 복사해 채우세요")
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            try:
                vals[node.targets[0].id] = ast.literal_eval(node.value)
            except ValueError:
                pass
    key = str(vals.get("ROBOT_KEY", "")).strip()
    if not key or key == "로봇키":
        sys.exit("config.py 의 ROBOT_KEY 를 채우세요")
    host = vals.get("SERVER_HOST", "kis-peekok.pages.dev")
    tls = vals.get("USE_TLS", True)
    port = vals.get("SERVER_PORT", 443 if tls else 80)
    base = ("https://" if tls else "http://") + host
    if port not in (80, 443):
        base += ":%d" % port
    return base, key


def fetch(base, key, since, limit):
    q = "since=%d&limit=%d" % (since, limit) if since else "limit=%d" % limit
    req = urllib.request.Request(base + "/api/robot/log?" + q, headers={"X-Robot-Key": key, "User-Agent": "peekok-log"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode("utf-8")).get("lines", [])
    except urllib.error.HTTPError as e:
        sys.exit("서버 오류 %d — 401/403 이면 config.py 의 ROBOT_KEY 가 서버 값과 달라요" % e.code)


def show(lines):
    for l in lines:
        t = time.strftime("%m-%d %H:%M:%S", time.localtime(l["at"] / 1000))
        print("%s [%s] %s" % (t, l.get("body") or "?", l["line"]))


def main():
    args = sys.argv[1:]
    follow = "-f" in args
    nums = [a for a in args if a.isdigit()]
    limit = int(nums[0]) if nums else 200
    base, key = config()
    lines = fetch(base, key, 0, limit)
    show(lines)
    if not lines:
        print("(기록 없음 — 로봇이 아직 서버에 붙지 않았어요)")
    last = lines[-1]["id"] if lines else 0
    while follow:
        time.sleep(3)
        new = fetch(base, key, last, 1000)
        show(new)
        if new:
            last = new[-1]["id"]


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
