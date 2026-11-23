#!/usr/bin/env bash
# 피콕 로봇 펌웨어 올리기: USB 로 꽂혀 있으면 USB, 아니면 WiFi(무선 업로드, peekok-robot.local)
#   upload        자동으로 고름
#   upload w      USB 가 있어도 WiFi 로
# 무선 업로드 비밀번호는 config.h 의 OTA_PASS (없으면 ROBOT_KEY) — 화면에 출력하지 않음
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
FQBN="esp32:esp32:esp32:UploadSpeed=115200"
BUILD="${TMPDIR:-/tmp}/peekok-robot-build"

PORT=""
if [ "${1:-}" != "w" ]; then
  n=$(ls /dev/ | grep -E '^cu\.(usbserial|wchusbserial|SLAB)' | head -1 || true)
  [ -n "$n" ] && PORT="/dev/$n"
fi

echo "[컴파일 중…]"
S=$(date +%s)
arduino-cli compile --fqbn "$FQBN" --output-dir "$BUILD" "$DIR" > "$BUILD.log" 2>&1 || { grep -a " error" "$BUILD.log" | grep -vE 'WIFI_|ROBOT_KEY|OTA_PASS' | head -5; echo "[컴파일 실패]"; exit 1; }
echo "[컴파일 끝 · $(( $(date +%s) - S ))초]"

if [ -n "$PORT" ]; then
  echo "[USB 로 올리는 중: $PORT]"
  arduino-cli upload --fqbn "$FQBN" -p "$PORT" --input-dir "$BUILD" "$DIR" > "$BUILD.up.log" 2>&1 || { tail -3 "$BUILD.up.log"; echo "[USB 업로드 실패]"; exit 1; }
else
  HOST="${ROBOT_HOST:-peekok-robot.local}"
  # espota 는 .local 이름을 못 찾을 때가 있어 IP 로 바꿔 넘김
  IP=$(perl -MSocket -e '$a = inet_aton($ARGV[0]); print inet_ntoa($a) if $a' "$HOST" 2>/dev/null || true)
  [ -n "$IP" ] && HOST="$IP"
  ESPOTA=$(ls ~/Library/Arduino15/packages/esp32/hardware/esp32/*/tools/espota.py | tail -1)
  PASS=$(perl -ne '$o = $1 if /^#define\s+OTA_PASS\s+"(.*)"/; $k = $1 if /^#define\s+ROBOT_KEY\s+"(.*)"/; END { print defined $o ? $o : $k }' "$DIR/config.h")
  echo "[WiFi 로 올리는 중: $HOST]"
  python3 "$ESPOTA" -i "$HOST" -p 3232 -a "$PASS" -f "$BUILD/peekok-robot.ino.bin" > "$BUILD.up.log" 2>&1 || { grep -vF -- "$PASS" "$BUILD.up.log" | tail -3; echo "[무선 업로드 실패 — 로봇과 Mac 이 같은 WiFi 인지, 로봇이 켜져 있는지 확인]"; exit 1; }
fi
echo "[올리기 끝 · 모두 $(( $(date +%s) - S ))초]"
