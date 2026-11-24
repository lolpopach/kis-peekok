// 로봇 몸체 기록(로그) — 로봇 전용(X-Robot-Key)
//   POST /api/robot/log   본문: 글자(한 줄 = 기록 한 줄, 최대 60줄) 또는 JSON { lines: [...] }
//                         mBot2 는 무선 시리얼이 없어서 멈춰 있을 때 모아 둔 기록을 여기로 보낸다.
//                         ?fmt=text 를 붙이면 drive 와 같은 글자 형식으로 답한다(몸체 연결 시각도 갱신).
//   GET  /api/robot/log?since=<id>&limit=<n>   최근 기록 (오래된 것부터). 클라우드에서는 D1 의 robot_log 표를 바로 본다.
import {
  getDb, getRobot, json, handle, requireRobot, driveText, markBodySeen, bodyKindOf, HttpError, LOG_KEEP,
} from '../../../lib/shared.js';

const MAX_LINES = 60;
const MAX_LINE = 300;

export const onRequestPost = handle(async ({ request, env }) => {
  requireRobot(request, env);
  const db = await getDb(env);
  const raw = await request.text();
  if (raw.length > 32000) throw new HttpError(413, '기록이 너무 커요');
  let lines;
  try {
    const j = JSON.parse(raw);
    lines = Array.isArray(j && j.lines) ? j.lines : [];
  } catch (e) {
    lines = raw.split('\n');
  }
  lines = lines.map((l) => String(l).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trimEnd().slice(0, MAX_LINE))
    .filter((l) => l.trim()).slice(-MAX_LINES);
  const t = Date.now();
  const body = bodyKindOf(request);
  if (lines.length) {
    await db.batch([
      ...lines.map((l) => db.prepare('INSERT INTO robot_log (at, body, line) VALUES (?, ?, ?)').bind(t, body, l)),
      db.prepare('DELETE FROM robot_log WHERE id <= (SELECT MAX(id) FROM robot_log) - ?').bind(LOG_KEEP),
    ]);
  }
  if (new URL(request.url).searchParams.get('fmt') === 'text') {
    await markBodySeen(db, request);
    return driveText(await getRobot(db));
  }
  return json({ ok: true, saved: lines.length });
});

export const onRequestGet = handle(async ({ request, env }) => {
  requireRobot(request, env);
  const db = await getDb(env);
  const q = new URL(request.url).searchParams;
  const since = Number(q.get('since')) || 0;
  const limit = Math.min(Math.max(Number(q.get('limit')) || 200, 1), 1000);
  const { results } = since
    ? await db.prepare('SELECT id, at, body, line FROM robot_log WHERE id > ? ORDER BY id LIMIT ?').bind(since, limit).all()
    : await db.prepare('SELECT * FROM (SELECT id, at, body, line FROM robot_log ORDER BY id DESC LIMIT ?) ORDER BY id').bind(limit).all();
  return json({ ok: true, lines: results || [] });
});
