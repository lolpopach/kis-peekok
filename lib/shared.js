/* 배달 API 공통 코드 (Cloudflare Pages Functions)
 * - 데이터베이스: env.DB (D1, wrangler.toml)
 * - 로봇 인증: 요청 헤더 X-Robot-Key 가 비밀값 env.ROBOT_KEY 와 같아야 로봇 전용 API 를 쓸 수 있다.
 */
export const ROBOT_ID = 'peekok';
export const ACTIVE = ['waiting', 'coming', 'loading', 'delivering', 'at_recipient'];
export const ACTIVE_SQL = ACTIVE.map((s) => `'${s}'`).join(',');
export const WAIT_EXPIRE_MS = 30 * 60 * 1000;   // 30분 넘게 기다린 호출은 만료
export const ONLINE_MS = 45 * 1000;             // 로봇 화면이 45초 안에 접속했으면 '연결됨'

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY, token TEXT NOT NULL, status TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'call',
    from_room TEXT NOT NULL, from_label TEXT, caller TEXT, caller_note TEXT,
    to_room TEXT, to_label TEXT, recipient TEXT, memo TEXT, client TEXT, ip TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    coming_at INTEGER, loading_at INTEGER, departed_at INTEGER, arrived_at INTEGER, ended_at INTEGER)`,
  'CREATE INDEX IF NOT EXISTS calls_status ON calls(status, created_at)',
  'CREATE INDEX IF NOT EXISTS calls_client ON calls(client, status)',
  `CREATE TABLE IF NOT EXISTS robot (
    id TEXT PRIMARY KEY, mode TEXT NOT NULL, call_id TEXT, target TEXT, position TEXT, progress TEXT,
    seen_at INTEGER, updated_at INTEGER)`,
];

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let schemaReady = false;
export async function getDb(env) {
  if (!env.DB) throw new HttpError(500, '데이터베이스가 연결되지 않았어요');
  if (!schemaReady) {
    await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
    schemaReady = true;
  }
  return env.DB;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// 핸들러를 감싸서 오류를 JSON 으로 돌려준다
export function handle(fn) {
  return async (ctx) => {
    try {
      return await fn(ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
      console.error(e);
      return json({ ok: false, error: '서버에 문제가 생겼어요. 잠시 후 다시 해 주세요.' }, 500);
    }
  };
}

export async function readBody(request) {
  try { return await request.json(); } catch (e) { return {}; }
}

// 글자 정리: 제어문자 제거, 길이 제한
export function text(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
}

// data.js 의 방 id 형식: f<층>-<이름>
export function roomId(v) {
  const s = text(v, 60);
  if (!s || !/^f[1-5]-\S{1,50}$/.test(s)) throw new HttpError(400, '장소가 올바르지 않아요');
  return s;
}

export function newId(n) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const a = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(a, (b) => abc[b % abc.length]).join('');
}

export function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function requireRobot(request, env) {
  if (!env.ROBOT_KEY) throw new HttpError(500, '로봇 키가 서버에 설정되지 않았어요');
  if (!safeEqual(request.headers.get('x-robot-key'), env.ROBOT_KEY)) throw new HttpError(401, '로봇 키가 맞지 않아요');
}

// 크기 제한이 있는 JSON 저장값
export function jsonField(v, maxBytes = 24000) {
  if (v === undefined || v === null) return null;
  const s = JSON.stringify(v);
  if (s.length > maxBytes) throw new HttpError(413, '보낸 데이터가 너무 커요');
  return s;
}
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };

export async function getRobot(db) {
  let r = await db.prepare('SELECT * FROM robot WHERE id = ?').bind(ROBOT_ID).first();
  if (!r) {
    const t = Date.now();
    await db.prepare('INSERT OR IGNORE INTO robot (id, mode, updated_at) VALUES (?, ?, ?)').bind(ROBOT_ID, 'idle', t).run();
    r = { id: ROBOT_ID, mode: 'idle', updated_at: t };
  }
  return {
    mode: r.mode,
    callId: r.call_id || null,
    target: parse(r.target),
    position: parse(r.position),
    progress: parse(r.progress),
    seenAt: r.seen_at || null,
    updatedAt: r.updated_at || null,
  };
}

export const isOnline = (robot) => !!robot.seenAt && Date.now() - robot.seenAt < ONLINE_MS;

// 부른 사람·로봇 화면에 보여 줄 호출 정보 (비밀값 제외)
export function publicCall(c) {
  if (!c) return null;
  return {
    id: c.id, status: c.status, kind: c.kind,
    from_room: c.from_room, from_label: c.from_label, caller: c.caller, caller_note: c.caller_note,
    to_room: c.to_room, to_label: c.to_label, recipient: c.recipient, memo: c.memo,
    created_at: c.created_at, updated_at: c.updated_at, coming_at: c.coming_at, loading_at: c.loading_at,
    departed_at: c.departed_at, arrived_at: c.arrived_at, ended_at: c.ended_at,
  };
}

export async function expireOld(db) {
  const t = Date.now();
  await db.prepare("UPDATE calls SET status = 'expired', ended_at = ?, updated_at = ? WHERE status = 'waiting' AND created_at < ?")
    .bind(t, t, t - WAIT_EXPIRE_MS).run();
}

export async function waitingQueue(db) {
  const { results } = await db.prepare(
    "SELECT id, from_room, from_label, caller, caller_note, created_at FROM calls WHERE status = 'waiting' ORDER BY created_at LIMIT 20",
  ).all();
  return results || [];
}

export async function setRobot(db, fields) {
  const keys = Object.keys(fields);
  const sql = `UPDATE robot SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
  await db.prepare(sql).bind(...keys.map((k) => fields[k]), Date.now(), ROBOT_ID).run();
}
