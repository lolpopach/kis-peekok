// GET /api/robot/drive — 로봇 몸체(ESP8266) 전용: 지금 모드와 주행 계획을 짧은 글자 형식으로
// (형식은 lib/shared.js 의 driveText 참고). 부를 때마다 '로봇 몸체 연결됨' 시각이 갱신된다.
import { getDb, getRobot, handle, requireRobot, driveText, ROBOT_ID } from '../../../lib/shared.js';

export const onRequestGet = handle(async ({ request, env }) => {
  requireRobot(request, env);
  const db = await getDb(env);
  await db.prepare('INSERT OR IGNORE INTO robot (id, mode, updated_at) VALUES (?, ?, ?)').bind(ROBOT_ID, 'idle', Date.now()).run();
  await db.prepare('UPDATE robot SET body_seen_at = ? WHERE id = ?').bind(Date.now(), ROBOT_ID).run();
  return driveText(await getRobot(db));
});
