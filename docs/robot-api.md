# 피콕 로봇 연결 안내 (라인 트레이스 주행용)

로봇 몸체(주행 제어 프로그램)가 배달 시스템과 주고받는 방법입니다.
참고 구현: `tools/robot-sim.js` — 실제 로봇이 해야 할 일을 그대로 흉내 내는 시뮬레이터입니다.

## 전체 구조

```
휴대폰(index.html) ──호출──▶  서버(/api, Cloudflare)  ◀──상태 확인·버튼── 로봇 얼굴 태블릿(robot.html)
                                      ▲
                                      │ 목적지 계획 받기 / 노드 통과 보고 / 도착 보고
                               로봇 주행 제어 프로그램 (라인 트레이스)
```

- 태블릿(로봇 얼굴)이 호출을 받고, 목적지까지의 **주행 계획(plan)** 을 계산해 서버에 올립니다.
- 주행 제어 프로그램은 서버에서 계획을 받아 라인을 따라 달리고, **노드를 지날 때마다 보고**합니다.
- 보고가 들어오면 태블릿과 부른 사람 휴대폰 지도에 로봇 위치가 실시간으로 보입니다.
  노드 사이는 등속도로 달린다고 보고 `지난 시간 × 속도` 로 위치를 계산합니다.

## 인증

모든 로봇 API 요청에 헤더를 붙입니다.

```
X-Robot-Key: <로봇 키>
```

로봇 키는 Cloudflare Pages 프로젝트의 비밀값 `ROBOT_KEY` 입니다. 태블릿 설정 링크(`/robot#key=...`)와 같은 값입니다.

## 1. 상태 확인 — `GET /api/robot` (1초마다)

```json
{
  "robot": {
    "mode": "to_caller",
    "target": {
      "room": "f2-5-1", "label": "5학년 1반", "floor": 2, "x": 358.5, "y": 651.2,
      "plan": {
        "v": 1, "mode": "elevator", "total_m": 276.9,
        "nodes": [
          { "key": "START", "floor": 1, "x": 325,  "y": 391,   "action": "start",    "heading": "N", "next_m": 2.06 },
          { "key": "1:b2",  "floor": 1, "x": 325,  "y": 382.4, "action": "right",    "heading": "E", "next_m": 24.24 },
          { "key": "1:eL",  "floor": 1, "x": 413,  "y": 119,   "action": "elevator", "toFloor": 2, "next_m": 0 },
          { "key": "2:eL",  "floor": 2, "x": 413,  "y": 489,   "action": "exit",     "heading": "S", "next_m": 4.25 },
          { "key": "END",   "floor": 2, "x": 358.5,"y": 651.2, "action": "stop" }
        ]
      }
    },
    "progress": { "passed": "1:b2", "next": "1:b3", "at": 1794987643556, "speed": 0.5 },
    "online": true
  },
  "call": { "id": "ta2zdbf2", "status": "coming", "from_label": "5-1반", "caller": "김민지", "...": "..." },
  "queue": [],
  "now": 1794987645000
}
```

### `mode` — 로봇이 지금 할 일

| mode | 뜻 | 주행 프로그램이 할 일 |
| --- | --- | --- |
| `idle` | 대기 | 제자리에서 멈춤 |
| `to_caller` | 부른 곳으로 가는 중 | `target.plan` 을 따라 주행 → 끝나면 `arrived` |
| `loading` | 부른 곳에서 물건 싣는 중 | 멈춤 (받는 곳은 휴대폰에서 미리 정함 — 사람이 물건을 넣고 로봇 화면을 누르면 출발) |
| `delivering` | 받는 곳으로 가는 중 | `target.plan` 을 따라 주행 → 끝나면 `arrived` |
| `at_recipient` | 받는 곳 도착, 꺼내 가길 기다림 | 멈춤 |
| `returning` | 제자리로 돌아가는 중 | `target.plan` 을 따라 주행 → 끝나면 `arrived` |
| `guiding` | 길 안내: 사람을 목적지까지 데려다주는 중 (뒤에 사람이 따라옴) | `target.plan` 을 따라 주행 → 끝나면 `arrived` |
| `guided` | 길 안내 목적지 도착, 사람에게 마지막 안내 중 | 멈춤 (곧 `returning` 으로 바뀜) |

`target.plan` 이 바뀌면(취소, 새 목적지) 하던 주행을 멈추고 새 계획을 따릅니다.

### `plan.nodes` — 노드 하나하나

| 항목 | 설명 |
| --- | --- |
| `key` | 노드 이름 `층:id` — `public/js/data.js` 의 `nodes` 와 같습니다. 처음은 `START`, 마지막은 `END` (복도 중간 지점) |
| `action` | 이 노드에서 할 일: `start` 출발 · `straight` 직진(교차로 통과) · `left` 좌회전 · `right` 우회전 · `uturn` 유턴 · `elevator` 엘리베이터 타기(`toFloor` 층으로) · `exit` 엘리베이터에서 내리기 · `stop` 정지 |
| `heading` | 노드를 떠날 때 향하는 도면 방향 (`N` 위 · `S` 아래 · `E` 오른쪽 · `W` 왼쪽) |
| `next_m` | 다음 노드까지 직선 거리(m). 도면 1단위 = 0.24m |
| `x`, `y`, `floor` | 도면 좌표 (지도 표시용) |

라인 트레이스에서는 **교차로(노드)를 만날 때마다** 다음 노드의 `action` 을 보고 직진·좌회전·우회전을 정하면 됩니다.
`straight` 도 교차로를 지나는 것이므로 노드 수를 세는 데 씁니다.
`END` 는 마지막 노드에서 `next_m` 만큼 직진한 곳(방 문 앞)입니다.

## 2. 노드 통과 보고 — `POST /api/robot/progress`

노드(교차로)를 지날 때마다 보냅니다. 위치 표시가 이 보고를 기준으로 움직입니다.

```json
{ "passed": "1:b2", "next": "1:b3", "speed": 0.5 }
```

- `passed`: 방금 지난 노드 `key`, `next`: 향하는 다음 노드 `key`
- `speed`: 지금 속도(m/s). 빼면 화면은 `js/config.js` 의 `robotSpeed`(0.5) 로 계산합니다.

## 3. 도착 보고 — `POST /api/robot/arrived`

`END` 에 닿으면 보냅니다. 본문은 `{}` (또는 `{ "position": { "floor": 2, "x": 358.5, "y": 651.2 } }`).

- `to_caller` → `loading` : 태블릿에 "물건을 넣어 주세요" 화면이 뜹니다.
- `delivering` → `at_recipient` : 태블릿에 받는 사람·메모 화면이 뜹니다.
- `guiding` → `guided` : 태블릿에 "도착했어요" 화면이 뜨고, 잠시 뒤(또는 "고마워요") `returning` 으로 바뀝니다.
- `returning` → `idle`

로봇 몸체가 아직 연결되지 않았을 때는 태블릿의 "제가 불렀어요 / 제가 받는 사람이에요 / 제자리에 도착했어요" 버튼이 같은 일을 합니다.
제자리로 돌아갈 때 주행 보고가 하나도 없으면 예상 시간이 지난 뒤 자동으로 도착 처리합니다.

## 로봇 몸체 규약 v1: 짧은 글자 형식 (ESP32·ESP8266·mBot2)

로봇 몸체는 모두 이 글자 형식으로 말합니다. 서버·웹은 어떤 몸체가 달리는지 모르고 같은 계획을 주고 같은 보고를 받으므로,
몸체를 바꿔도 웹은 그대로입니다. 몸체 둘은 같은 로봇 키를 쓰니 **한 번에 하나만** 켭니다.

| 몸체 | 펌웨어 | 요청 머리 `X-Robot-Body` |
| --- | --- | --- |
| ESP32·ESP8266 (Arduino) | `firmware/peekok-robot/` | 없음 → 서버가 `arduino` 로 기록 |
| Makeblock mBot2 (CyberPi MicroPython) | `firmware/peekok-mbot2/` | `mbot2` |

서버는 몸체 요청마다 `robot.body_seen_at`·`robot.body_kind` 를 기록하고, `GET /api/robot` 의 `robot.bodyKind` 로 로봇 화면에
"로봇 몸체(mBot2) 연결됨" 처럼 보여 줍니다.

`GET /api/robot/drive` (헤더 `X-Robot-Key`) — 부를 때마다 로봇 화면에 "로봇 몸체 연결됨" 이 표시됩니다.

```
ok
mode to_caller
rev 40bae05a
passed -
nodes 17
START start N 2.06 0
1:b2 right E 24.24 0
1:b3 left N 7.82 0
1:eL elevator - 0.00 2
2:eL exit S 4.25 0
...
END stop - 0.00 0
end
```

- 노드 줄: `<key> <action> <heading|-> <next_m> <toFloor|0>` (모두 ASCII)
- `rev`: 계획이 바뀌면 값이 바뀝니다 (취소·새 목적지 감지)
- `passed`: 서버에 기록된 마지막 통과 노드 — 엘리베이터에서 로봇 화면의 "내렸어요" 를 누르면 출구 노드로 바뀝니다
- POST 동작에 `?fmt=text` 를 붙이면 (`/api/robot/progress?fmt=text`, `/api/robot/arrived?fmt=text`) 응답도 이 형식입니다.
  노드 보고 응답만 보고도 계획이 바뀌었는지 알 수 있어 따로 확인할 필요가 없습니다.

### 몸체 기록 — `POST /api/robot/log`

본문은 글자(한 줄 = 기록 한 줄, 한 번에 60줄까지) 또는 `{ "lines": [...] }`. 서버 D1 `robot_log` 표에 최근 2000줄을 남깁니다.
`?fmt=text` 를 붙이면 drive 와 같은 글자 형식으로 답하므로, 기록 보내기와 상태 확인을 한 번에 합니다(mBot2 가 대기 중 이렇게 씀).
`GET /api/robot/log?since=<id>&limit=<n>` (로봇 키) 로 읽습니다.

### 엘리베이터

라인 트레이스 로봇은 엘리베이터를 스스로 탈 수 없으므로 사람의 도움을 받습니다.

1. 로봇이 `elevator` 노드에 닿으면 멈추고 그 노드를 `progress` 로 보고합니다.
2. 로봇 얼굴 화면에 "엘리베이터에 태워 주세요! N층에서 내려 주세요" 가 뜨고 음성으로도 말합니다.
3. 사람이 태워 N층에서 내려, 출구 방향(`exit` 노드의 `heading`)으로 선 위에 놓습니다.
4. 로봇의 **FLASH/BOOT 버튼**(mBot2 는 CyberPi **A 버튼**)을 누르거나, 로봇 화면의 **"N층에서 내렸어요 · 다시 출발"** 을 누르면
   (서버의 `passed` 가 출구 노드로 바뀜) 로봇이 이어서 달립니다.

## 그 밖의 로봇 API (`POST /api/robot/<동작>`)

| 동작 | 본문 | 설명 |
| --- | --- | --- |
| `accept` | `{ id, target }` | 기다리는 호출 받기 (태블릿이 자동으로 함) |
| `walkup` | `{ from_room, from_label }` | 로봇 앞에서 바로 배달 시작 |
| `guide` | `{ to_room, to_label, target }` | 길 안내: 목적지까지 데려다주기 (태블릿이 함) |
| `depart` | `{ to_room, to_label, recipient, memo, caller, target }` | 물건 싣고 출발 |
| `delivered` | `{}` | 받는 사람이 꺼내 감 → 제자리로 |
| `target` | `{ target }` | 지금 목적지만 바꾸기 |
| `position` | `{ floor, x, y, label }` | 로봇 위치 직접 지정 |
| `cancel` | `{}` | 지금 배달·길 안내 취소(마치기) → 제자리로 |
| `reset` | `{}` | 대기 상태로 초기화 |

응답은 모두 `GET /api/robot` 과 같은 모양입니다.

## 시뮬레이터로 시험하기

```bash
node tools/robot-sim.js --base https://kis-peekok.pages.dev --key <로봇 키> --fast 5
```

휴대폰으로 피콕을 부르면 시뮬레이터가 노드를 따라 달리며 보고하고, 휴대폰·태블릿 지도에서 로봇이 움직입니다.
`--fast` 는 시간 배속(시험용), `--speed` 는 속도(m/s)입니다.
`--text` 를 붙이면 로봇 몸체 펌웨어(ESP32·ESP8266)와 똑같이 글자 형식으로 주고받고, 엘리베이터에서는 로봇 화면의 "내렸어요"
(또는 `--elevator <초>` 뒤 버튼을 누른 것으로 보고) 를 기다립니다.

## 노드(라인) 설계 메모

- 노드는 `public/js/data.js` 의 각 층 `nodes`, 이어진 길은 `edges` 입니다. 실제 바닥에 그릴 검정 라인과 교차점에 맞춰 고치면 됩니다.
- 도면 위 지도 확인: 브라우저 주소에 `?debug=1` 을 붙이면 노드 이름과 연결선이 지도에 표시됩니다 (`/robot?debug=1&start=app`).
- 로봇은 계단을 쓰지 않으므로 계획은 항상 엘리베이터 경로입니다. 엘리베이터로 갈 수 없는 곳(현재 5층 대기실)은 배달 목적지로 고를 수 없습니다.
