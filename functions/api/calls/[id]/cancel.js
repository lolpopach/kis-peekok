// POST /api/calls/:id/cancel?t=<token> — 부른 사람: 호출 취소 (로봇이 오는 중일 때까지만)
import {
  getDb, getRobot, setRobot, json, handle, safeEqual, HttpError, publicCall,
} from '../../../../lib/shared.js';

export const onRequestPost = handle(async ({ request, env, params }) => {
  const db = await getDb(env);
  const token = new URL(request.url).searchParams.get('t');
  const c = await db.prepare('SELECT * FROM calls WHERE id = ?').bind(String(params.id)).first();
  if (!c || !safeEqual(token, c.token)) throw new HttpError(404, '호출을 찾지 못했어요');
  if (!['waiting', 'coming'].includes(c.status)) throw new HttpError(409, '로봇이 이미 도착했거나 끝난 호출이라 취소할 수 없어요');

  const t = Date.now();
  await db.prepare("UPDATE calls SET status = 'canceled', ended_at = ?, updated_at = ? WHERE id = ?").bind(t, t, c.id).run();
  const robot = await getRobot(db);
  if (robot.callId === c.id) {
    // 오던 로봇은 제자리로 돌아간다 (돌아갈 경로는 로봇 화면이 다시 계산해서 보낸다)
    await setRobot(db, { mode: 'returning', call_id: null, target: null, progress: null });
  }
  const after = await db.prepare('SELECT * FROM calls WHERE id = ?').bind(c.id).first();
  return json({ ok: true, call: publicCall(after) });
});
