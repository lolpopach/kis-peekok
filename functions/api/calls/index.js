// POST /api/calls — 누구나: 로봇 부르기
//   body: { from_room, from_label, caller?, note?, client? }
//   돌려줌: { id, token }  (token 은 부른 사람 기기에만 저장 — 상태 보기·취소에 필요)
import {
  getDb, json, handle, readBody, text, roomId, newId, expireOld, HttpError, ACTIVE_SQL,
} from '../../../lib/shared.js';

export const onRequestPost = handle(async ({ request, env }) => {
  const db = await getDb(env);
  await expireOld(db);
  const b = await readBody(request);
  const fromRoom = roomId(b.from_room);
  const fromLabel = text(b.from_label, 60);
  const caller = text(b.caller, 30);
  const note = text(b.note, 80);
  const client = text(b.client, 40);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const t = Date.now();

  if (client) {
    const mine = await db.prepare(`SELECT id FROM calls WHERE client = ? AND status IN (${ACTIVE_SQL})`).bind(client).first();
    if (mine) throw new HttpError(409, '이미 부른 호출이 있어요. 그 호출을 기다리거나 먼저 취소해 주세요.');
  }
  if (ip) {
    const recent = await db.prepare('SELECT COUNT(*) AS n FROM calls WHERE ip = ? AND created_at > ?').bind(ip, t - 10 * 60 * 1000).first();
    if (recent && recent.n >= 6) throw new HttpError(429, '너무 자주 불렀어요. 잠시 후에 다시 불러 주세요.');
  }
  const waiting = await db.prepare("SELECT COUNT(*) AS n FROM calls WHERE status = 'waiting'").first();
  if (waiting && waiting.n >= 15) throw new HttpError(503, '지금 기다리는 호출이 많아요. 조금 뒤에 다시 불러 주세요.');

  const id = newId(8);
  const token = newId(24);
  await db.prepare(
    `INSERT INTO calls (id, token, status, kind, from_room, from_label, caller, caller_note, client, ip, created_at, updated_at)
     VALUES (?, ?, 'waiting', 'call', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, token, fromRoom, fromLabel, caller, note, client, ip, t, t).run();
  return json({ ok: true, id, token }, 201);
});
