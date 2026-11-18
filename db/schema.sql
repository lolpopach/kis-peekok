-- 피콕 배달 시스템 데이터베이스 (Cloudflare D1: kis-peekok)
-- 서버 코드(lib/shared.js)가 처음 요청 때 같은 내용을 자동으로 만들기 때문에, 직접 실행할 필요는 없습니다.

-- 배달 호출 한 건
--   status: waiting(대기) → coming(로봇이 가는 중) → loading(도착, 물건 싣는 중)
--           → delivering(배달 가는 중) → at_recipient(받는 곳 도착) → delivered(완료)
--           중간에 canceled(취소) / expired(오래 기다려 만료)
CREATE TABLE IF NOT EXISTS calls (
  id           TEXT PRIMARY KEY,
  token        TEXT NOT NULL,          -- 부른 사람 휴대폰만 상태를 보고 취소할 수 있게 하는 비밀값
  status       TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'call',   -- call(휴대폰 호출) | walkup(로봇 앞에서 바로 보내기)
  from_room    TEXT NOT NULL,          -- 로봇이 가야 할 곳 (data.js 의 방 id)
  from_label   TEXT,
  caller       TEXT,                   -- 보내는 사람 이름 (선택)
  caller_note  TEXT,                   -- 무엇을 보내는지 (선택)
  to_room      TEXT,                   -- 받는 곳
  to_label     TEXT,
  recipient    TEXT,                   -- 받는 사람
  memo         TEXT,                   -- 메모
  client       TEXT,                   -- 부른 기기 식별값 (중복 호출 제한)
  ip           TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  coming_at    INTEGER,
  loading_at   INTEGER,
  departed_at  INTEGER,
  arrived_at   INTEGER,
  ended_at     INTEGER
);
CREATE INDEX IF NOT EXISTS calls_status ON calls(status, created_at);
CREATE INDEX IF NOT EXISTS calls_client ON calls(client, status);

-- 로봇 상태 (한 대: id = 'peekok')
--   mode: idle(대기) | to_caller(부른 곳으로 가는 중) | loading(물건 싣는 중)
--         | delivering(배달 가는 중) | at_recipient(받는 곳 도착) | returning(제자리로 돌아가는 중)
CREATE TABLE IF NOT EXISTS robot (
  id          TEXT PRIMARY KEY,
  mode        TEXT NOT NULL,
  call_id     TEXT,
  target      TEXT,                    -- 지금 가야 할 곳 JSON {room,label,floor,x,y,path}
  position    TEXT,                    -- 마지막으로 도착한 곳 JSON {floor,x,y,label}
  progress    TEXT,                    -- 라인 트레이스 주행 보고 JSON {passed,next,at,speed} (노드를 지날 때마다)
  seen_at     INTEGER,                 -- 로봇 화면이 마지막으로 서버에 접속한 시각
  updated_at  INTEGER
);
