// GET /api/robot — 로봇 전용(X-Robot-Key): 로봇 상태, 지금 맡은 호출, 기다리는 호출 목록
// 로봇 화면과 로봇 제어 프로그램이 몇 초마다 부른다. 부를 때마다 '로봇 연결됨' 시각이 갱신된다.
import { getDb, handle, json, requireRobot, expireOld, ROBOT_ID } from '../../../lib/shared.js';
import { robotState } from '../../../lib/robot.js';

export const onRequestGet = handle(async ({ request, env }) => {
  requireRobot(request, env);
  const db = await getDb(env);
  await expireOld(db);
  await db.prepare('INSERT OR IGNORE INTO robot (id, mode, updated_at) VALUES (?, ?, ?)').bind(ROBOT_ID, 'idle', Date.now()).run();
  await db.prepare('UPDATE robot SET seen_at = ? WHERE id = ?').bind(Date.now(), ROBOT_ID).run();
  return json(await robotState(db));
});
