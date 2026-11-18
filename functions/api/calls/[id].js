// GET /api/calls/:id?t=<token> — 부른 사람: 내 호출 상태, 앞에 기다리는 호출 수, 로봇 위치
import {
  getDb, getRobot, json, handle, expireOld, publicCall, isOnline, safeEqual, HttpError,
} from '../../../lib/shared.js';

export const onRequestGet = handle(async ({ request, env, params }) => {
  const db = await getDb(env);
  await expireOld(db);
  const token = new URL(request.url).searchParams.get('t');
  const c = await db.prepare('SELECT * FROM calls WHERE id = ?').bind(String(params.id)).first();
  if (!c || !safeEqual(token, c.token)) throw new HttpError(404, '호출을 찾지 못했어요');

  let ahead = 0;
  if (c.status === 'waiting') {
    const r = await db.prepare("SELECT COUNT(*) AS n FROM calls WHERE status = 'waiting' AND created_at < ?").bind(c.created_at).first();
    ahead = r ? r.n : 0;
  }
  const robot = await getRobot(db);
  const mine = robot.callId === c.id;
  return json({
    ok: true,
    call: publicCall(c),
    ahead,
    robot: {
      mode: robot.mode,
      online: isOnline(robot),
      mine,
      busy: robot.mode !== 'idle' && !mine,
      target: robot.target,
      progress: robot.progress,
      position: robot.position,
    },
    now: Date.now(),
  });
});
