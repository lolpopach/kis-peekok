#!/usr/bin/env python3
"""배달 API 점검 (로컬 서버 또는 배포된 사이트)

  python3 tools/api-test.py http://127.0.0.1:8788 local-test-key

전체 흐름: 호출 → 로봇 수락 → 노드 통과 보고 → 도착(싣기) → 출발 → 받는 곳 도착 → 배달 완료 → 복귀
주의: 배포된 사이트에 돌리면 실제 로봇 상태가 바뀝니다. 끝나면 로봇을 대기 상태로 되돌립니다.
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://127.0.0.1:8788'
KEY = sys.argv[2] if len(sys.argv) > 2 else 'local-test-key'
ok_count = 0


def req(method, path, body=None, robot=False):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header('content-type', 'application/json')
    r.add_header('user-agent', 'kis-peekok-api-test/1.0')  # 기본 Python-urllib 은 Cloudflare 가 막을 수 있음
    if robot:
        r.add_header('x-robot-key', KEY)

    def parse(raw):
        try:
            return json.loads(raw or b'{}')
        except ValueError:
            return {'error': raw[:200].decode('utf-8', 'replace')}
    try:
        with urllib.request.urlopen(r) as res:
            return res.status, parse(res.read())
    except urllib.error.HTTPError as e:
        return e.code, parse(e.read())


def check(name, cond, extra=''):
    global ok_count
    print(('  OK  ' if cond else '  ✗✗  ') + name + (f'  ({extra})' if extra else ''))
    if not cond:
        sys.exit(1)
    ok_count += 1


TARGET = {'room': 'f2-5-1', 'label': '5-1반', 'floor': 2, 'x': 358, 'y': 646.8,
          'plan': {'nodes': [{'key': '1:L'}, {'key': '1:b2'}]}}

print(f'API 점검: {BASE}')
req('POST', '/api/robot/reset', {}, robot=True)

s, r = req('GET', '/api/robot')
check('로봇 API 는 키 없이 막힘', s == 401, s)

s, r = req('POST', '/api/calls', {'from_room': 'f2-5-1', 'from_label': '5-1반', 'caller': '김민지', 'note': '서류', 'client': 'test-client-1'})
check('호출 만들기', s == 201 and r.get('id'), r)
cid, tok = r['id'], r['token']
s, r = req('POST', '/api/calls', {'from_room': 'f2-5-1', 'client': 'test-client-1'})
check('같은 기기의 중복 호출은 막힘', s == 409, r.get('error'))
s, r = req('POST', '/api/calls', {'from_room': 'nowhere'})
check('잘못된 장소는 막힘', s == 400, r.get('error'))

s, r = req('GET', f'/api/calls/{cid}?t={tok}')
check('부른 사람이 상태 보기 (대기)', s == 200 and r['call']['status'] == 'waiting', r['call']['status'])
s, r = req('GET', f'/api/calls/{cid}?t=wrong')
check('토큰이 틀리면 못 봄', s == 404)

s, r = req('GET', '/api/robot', robot=True)
check('로봇이 기다리는 호출을 봄', s == 200 and any(q['id'] == cid for q in r['queue']), len(r['queue']))
check('로봇 연결됨 표시', r['robot']['online'] is True)

s, r = req('POST', '/api/robot/accept', {'id': cid, 'target': TARGET}, robot=True)
check('로봇이 호출을 받음 → 부른 곳으로', s == 200 and r['robot']['mode'] == 'to_caller' and r['call']['status'] == 'coming', r['robot']['mode'])

s, r = req('POST', '/api/robot/progress', {'passed': '1:L', 'next': '1:b2', 'speed': 0.5}, robot=True)
check('라인 트레이스 노드 통과 보고', s == 200 and r['robot']['progress']['passed'] == '1:L', r['robot']['progress'])
s, r = req('GET', f'/api/calls/{cid}?t={tok}')
check('부른 사람 휴대폰에 로봇 위치가 보임', r['robot']['mine'] and r['robot']['progress']['next'] == '1:b2')

s, r = req('POST', '/api/robot/arrived', {}, robot=True)
check('부른 곳 도착 → 물건 싣기', r['robot']['mode'] == 'loading' and r['call']['status'] == 'loading')
s, r = req('POST', f'/api/calls/{cid}/cancel?t={tok}')
check('도착한 뒤에는 부른 사람이 취소 못 함', s == 409)

s, r = req('POST', '/api/robot/depart', {'to_room': 'f1-보건실', 'to_label': '보건실', 'recipient': '보건 선생님',
                                         'memo': '약 봉투예요', 'target': {**TARGET, 'room': 'f1-보건실'}}, robot=True)
check('받는 곳·받는 사람·메모 적고 출발', r['robot']['mode'] == 'delivering' and r['call']['recipient'] == '보건 선생님'
      and r['call']['memo'] == '약 봉투예요', r['call']['status'])
s, r = req('POST', '/api/robot/arrived', {}, robot=True)
check('받는 곳 도착', r['robot']['mode'] == 'at_recipient' and r['call']['status'] == 'at_recipient')
s, r = req('POST', '/api/robot/delivered', {}, robot=True)
check('받았어요 → 제자리로 돌아가기', r['robot']['mode'] == 'returning' and r['call'] is None)
s, r = req('GET', f'/api/calls/{cid}?t={tok}')
check('부른 사람에게 배달 완료 표시', r['call']['status'] == 'delivered' and r['call']['to_label'] == '보건실')
s, r = req('POST', '/api/robot/arrived', {}, robot=True)
check('제자리 도착 → 대기', r['robot']['mode'] == 'idle')

s, r = req('POST', '/api/robot/walkup', {'from_room': 'f1-현관', 'from_label': '1층 현관 로비'}, robot=True)
check('로봇 앞에서 바로 보내기', r['robot']['mode'] == 'loading' and r['call']['kind'] == 'walkup')
s, r = req('POST', '/api/robot/cancel', {}, robot=True)
check('로봇 화면에서 취소 → 돌아가기', r['robot']['mode'] == 'returning')

s, r = req('POST', '/api/calls', {'from_room': 'f3-7-1', 'client': 'test-client-2'})
c2, t2 = r['id'], r['token']
s, r = req('POST', f'/api/calls/{c2}/cancel?t={t2}')
check('기다리는 호출은 부른 사람이 취소', s == 200 and r['call']['status'] == 'canceled')

s, r = req('POST', '/api/robot/reset', {}, robot=True)
check('로봇 초기화 → 대기', r['robot']['mode'] == 'idle')
s, r = req('GET', '/api/status')
check('공개 상태 보기', s == 200 and r['robot']['mode'] == 'idle', r['waiting'])
print(f'\n모두 통과 ({ok_count}개)')
