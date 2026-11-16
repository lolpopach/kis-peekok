#!/usr/bin/env bash
# Cloudflare Pages 도우미 (클라우드 작업 환경용)
# API 토큰은 작업 환경의 네트워크 비밀값으로 저장되어 있고, 프록시가 api.cloudflare.com 요청에 자동으로 넣습니다.
# 그래서 이 스크립트는 토큰을 직접 다루지 않습니다.
#
#   tools/cloudflare.sh check                      토큰·계정 확인
#   tools/cloudflare.sh projects                   Pages 프로젝트 목록
#   tools/cloudflare.sh status [프로젝트]           최근 배포 5개
#   tools/cloudflare.sh wait [프로젝트] [커밋]      해당 커밋 배포가 끝날 때까지 대기 (기본: 현재 HEAD)
#   tools/cloudflare.sh create <프로젝트> <owner/repo> [운영브랜치=main] [출력폴더=public]
#                                                 GitHub 저장소에 연결된 Pages 프로젝트 만들기
set -euo pipefail
API=https://api.cloudflare.com/client/v4
PROJECT_DEFAULT=kis-peekok

account() {
  curl -sS "$API/accounts" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if not d.get("success") or not d.get("result"):
    sys.exit("Cloudflare 계정을 읽지 못했어요: %s" % d.get("errors"))
print(d["result"][0]["id"])'
}

cmd=${1:-check}; shift || true
case "$cmd" in
  check)
    # 계정 소유 토큰은 /user/tokens/verify 가 "Invalid API Token" 을 돌려줄 수 있어서 /accounts 로 확인한다
    curl -sS "$API/accounts" | python3 -c '
import sys, json
d = json.load(sys.stdin)
print("OK" if d.get("success") else "FAIL", [a["name"] for a in (d.get("result") or [])], d.get("errors") or "")'
    ;;
  projects)
    ACC=$(account)
    curl -sS "$API/accounts/$ACC/pages/projects" | python3 -c '
import sys, json
for p in json.load(sys.stdin)["result"]:
    s = p.get("source") or {}; c = s.get("config") or {}
    kind = s.get("type") or "direct-upload"
    repo = "%s/%s" % (c.get("owner", ""), c.get("repo_name", "")) if c else "-"
    print("%-26s %-14s %-28s 운영:%-8s https://%s" % (p["name"], kind, repo, p.get("production_branch"), p.get("subdomain")))'
    ;;
  status)
    ACC=$(account); P=${1:-$PROJECT_DEFAULT}
    curl -sS "$API/accounts/$ACC/pages/projects/$P/deployments" | python3 -c '
import sys, json
for d in json.load(sys.stdin)["result"][:5]:
    m = (d.get("deployment_trigger") or {}).get("metadata") or {}; st = d.get("latest_stage") or {}
    print(d.get("environment"), m.get("branch"), (m.get("commit_hash") or "")[:7], st.get("name"), st.get("status"), d.get("url"))'
    ;;
  wait)
    ACC=$(account); P=${1:-$PROJECT_DEFAULT}; C=${2:-$(git rev-parse --short HEAD)}
    for _ in $(seq 1 30); do
      S=$(curl -sS "$API/accounts/$ACC/pages/projects/$P/deployments" | python3 -c '
import sys, json
c = sys.argv[1]
for d in json.load(sys.stdin)["result"]:
    m = (d.get("deployment_trigger") or {}).get("metadata") or {}
    if (m.get("commit_hash") or "").startswith(c):
        st = d.get("latest_stage") or {}
        print(d.get("environment"), m.get("branch"), st.get("name"), st.get("status")); break
else:
    print("아직 없음")' "$C")
      echo "$C: $S"
      case "$S" in *"deploy success"*) exit 0 ;; *failure*|*canceled*) exit 1 ;; esac
      sleep 10
    done
    echo "시간 초과"; exit 1
    ;;
  create)
    NAME=${1:?프로젝트 이름}; REPO=${2:?owner/repo}; BR=${3:-main}; OUT=${4:-public}
    ACC=$(account)
    python3 - "$NAME" "$REPO" "$BR" "$OUT" > /tmp/cf-project.json <<'PY'
import sys, json
name, repo, br, out = sys.argv[1:5]
owner, rname = repo.split("/")
print(json.dumps({
  "name": name, "production_branch": br,
  "build_config": {"build_command": "", "destination_dir": out, "root_dir": ""},
  "source": {"type": "github", "config": {
    "owner": owner, "repo_name": rname, "production_branch": br,
    "deployments_enabled": True, "production_deployments_enabled": True,
    "preview_deployment_setting": "all", "pr_comments_enabled": True}}}))
PY
    curl -sS -X POST "$API/accounts/$ACC/pages/projects" -H "Content-Type: application/json" --data @/tmp/cf-project.json | python3 -c '
import sys, json
d = json.load(sys.stdin); r = d.get("result") or {}
print("생성" if d.get("success") else "실패", d.get("errors") or "", "https://%s" % r.get("subdomain") if r else "")'
    curl -sS -X POST "$API/accounts/$ACC/pages/projects/$NAME/deployments" -F "branch=$BR" >/dev/null && echo "첫 배포 시작"
    ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
