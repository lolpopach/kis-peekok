// GET /api/status — 누구나: 로봇이 지금 무엇을 하는지, 기다리는 호출이 몇 건인지
import { getDb, getRobot, json, handle, expireOld, isOnline } from '../../lib/shared.js';

export const onRequestGet = handle(async ({ env }) => {
  const db = await getDb(env);
  await expireOld(db);
  const robot = await getRobot(db);
  const w = await db.prepare("SELECT COUNT(*) AS n FROM calls WHERE status = 'waiting'").first();
  return json({
    ok: true,
    robot: { mode: robot.mode, online: isOnline(robot), position: robot.position, progress: robot.progress, target: robot.target },
    waiting: w ? w.n : 0,
    now: Date.now(),
  });
});
