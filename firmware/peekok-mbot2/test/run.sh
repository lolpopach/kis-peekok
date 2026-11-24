#!/usr/bin/env bash
# mBot2 펌웨어 컴퓨터 시험 (진짜 펌웨어 peekok_mbot2.py 를 가짜 mBot2·가짜 바닥 위에서)
#   bash firmware/peekok-mbot2/test/run.sh                      서버 없이 (해석·판단·엘리베이터 + 코스 왕복, 몸·바닥이 달라도)
#   bash firmware/peekok-mbot2/test/run.sh http://127.0.0.1:8788 local-test-key
#                                                               + 로컬 서버와 데려다주기·배달·계획 바뀜·원격 기록
#   (서버: npx wrangler pages dev public --port 8788, .dev.vars 에 ROBOT_KEY=local-test-key)
set -euo pipefail
cd "$(dirname "$0")"
export QUIET=1
python3 sim.py unit
python3 sim.py course
if [ $# -ge 2 ]; then python3 sim.py server "$1" "$2"; fi
