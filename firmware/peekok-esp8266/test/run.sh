#!/usr/bin/env bash
# 펌웨어 호스트 시험: PC 의 g++ 로 Arduino/ESP8266 흉내 헤더(stubs)와 함께 컴파일하고,
# 서버가 실제로 만드는 응답(make-drive.mjs)으로 응답 해석·회전·보고·엘리베이터 재출발을 확인한다.
#   bash firmware/peekok-esp8266/test/run.sh
set -euo pipefail
cd "$(dirname "$0")"
TMP=$(mktemp -d)
node make-drive.mjs "$TMP"
g++ -std=gnu++17 -Wall -Wno-unused-parameter -Wno-cpp -I stubs -x c++ test.cpp -o "$TMP/fwtest"
"$TMP/fwtest" "$TMP"
rm -rf "$TMP"
