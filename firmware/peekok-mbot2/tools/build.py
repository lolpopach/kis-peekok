# -*- coding: utf-8 -*-
"""config.py 의 WiFi·로봇 키를 펌웨어에 넣어 mBlock 에 올릴 한 파일(dist/upload.py)을 만든다.
    python firmware/peekok-mbot2/tools/build.py
비밀값은 화면에 출력하지 않는다. dist/ 는 저장소에 안 올라감(gitignore)."""
import ast
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
src = open(os.path.join(ROOT, "peekok_mbot2.py"), encoding="utf-8").read()
cfg_path = os.path.join(ROOT, "config.py")
if not os.path.exists(cfg_path):
    sys.exit("config.py 가 없어요: config.example.py 를 config.py 로 복사해 WiFi 이름·비밀번호·로봇 키를 채우세요.")
cfg = open(cfg_path, encoding="utf-8").read()
names = {}
for node in ast.parse(cfg).body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        names[node.targets[0].id] = ast.literal_eval(node.value)
problems = []
for k in ("WIFI_SSID", "WIFI_PASS", "ROBOT_KEY"):
    v = str(names.get(k, ""))
    if not v or v in ("WiFi이름", "WiFi비밀번호", "로봇키"):
        problems.append(k)
if problems:
    sys.exit("config.py 에서 아직 안 채운 값: %s" % ", ".join(problems))
known = set()
for node in ast.parse(src).body:
    if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
        known.add(node.targets[0].id)
unknown = [k for k in names if k not in known]
if unknown:
    sys.exit("config.py 에 펌웨어에 없는 설정 이름이 있어요 (오타?): %s" % ", ".join(unknown))
mark = "# ---- 설정 끝 ----"
if mark not in src:
    sys.exit("peekok_mbot2.py 에서 설정 끝 표시를 못 찾았어요")
lines = ["# (config.py 에서 넣음)"] + ["%s = %r" % (k, v) for k, v in names.items()]
out = src.replace(mark, "\n".join(lines) + "\n" + mark, 1)
os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
dst = os.path.join(ROOT, "dist", "upload.py")
open(dst, "w", encoding="utf-8", newline="\n").write(out)
compile(out, dst, "exec")
shown = ", ".join(k + ("=***" if k in ("WIFI_PASS", "ROBOT_KEY") else "=%r" % names[k]) for k in names)
print("만들었어요: %s (%d줄) · 설정 %s" % (dst, out.count("\n"), shown))
print("mBlock(mLink) → CyberPi 연결 → Python 편집기에 이 파일 내용을 붙여 넣고 '업로드'.")
