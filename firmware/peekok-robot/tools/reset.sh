#!/usr/bin/env bash
# 피콕을 제자리(12-5반 앞 출발점)에 다시 놓았을 때: reset
#   1) 로봇 멈춤(x) + "출발점에서 세로 선 쪽(동쪽)을 보고 있음"(H)  — WiFi(peekok-robot.local:2323, ROBOT_HOST 로 바꿀 수 있음)
#   2) 실제 웹 서버: 대기(idle)로 + 진행·대기 중인 호출 모두 취소 + 로봇 위치 = 12-5반 앞 (public/js/config.js robotLocation 과 같은 값)
# 로봇 키는 config.h 에서 읽고 화면에 출력하지 않음
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$DIR/config.h"
KEY=$(perl -ne 'print $1 if /^#define\s+ROBOT_KEY\s+"(.*)"/' "$CFG")
HOST_WEB=$(perl -ne 'print $1 if /^#define\s+SERVER_HOST\s+"(.*)"/' "$CFG")
BASE="https://${HOST_WEB:-kis-peekok.pages.dev}"
ROBOT="${ROBOT_HOST:-peekok-robot.local}"
HOME_POS='{"floor":4,"x":70,"y":564.5,"label":"12-5반 앞"}'

# 1) 로봇
perl -MIO::Socket::INET -e '
  my $s = IO::Socket::INET->new(PeerAddr => $ARGV[0], PeerPort => 2323, Timeout => 4)
    or do { print "[로봇] WiFi 로 연결 못 함 ($ARGV[0]) — 로봇이 켜져 있고 Mac 과 같은 WiFi 인지 확인\n"; exit 1 };
  select undef, undef, undef, 0.4; print $s "x"; select undef, undef, undef, 0.6; print $s "H";
  select undef, undef, undef, 1.0; $s->blocking(0); my $b = ""; sysread($s, $b, 8192);
  print $b =~ /(\[제자리\][^\n]*)/ ? "[로봇] 멈춤 · $1\n" : "[로봇] 멈춤·제자리 보냄 (응답 확인 못 함)\n";' "$ROBOT"
R1=$?

# 2) 웹 서버
post() { curl -s -m 10 -X POST -H "X-Robot-Key: $KEY" -H "content-type: application/json" -d "$2" "$BASE/api/robot/$1"; }
if post reset '{"all":true}' >/dev/null && post position "$HOME_POS" | grep -q '"position"'; then
  echo "[서버] 대기 상태 · 호출 모두 취소 · 로봇 위치 = 12-5반 앞 ($BASE) — 로봇 화면은 몇 초 안에 처음 화면으로"
else
  echo "[서버] 설정 실패 — 인터넷 연결이나 로봇 키를 확인"; exit 1
fi
exit $R1
