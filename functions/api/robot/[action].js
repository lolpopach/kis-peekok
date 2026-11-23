/* POST /api/robot/:action — 로봇 전용(X-Robot-Key)
 *
 *  accept    { id, target }            기다리는 호출을 맡고 부른 곳으로 출발      idle|returning → to_caller
 *  walkup    { from_room, from_label, caller? }  로봇 앞에서 바로 배달 시작      idle|returning → loading
 *  guide     { to_room, to_label, target }  길 안내: 사람을 목적지까지 데려다주기   idle|returning → guiding
 *  arrived   { position? }             지금 목적지에 도착                       to_caller → loading
 *                                                                             delivering → at_recipient
 *                                                                             guiding → guided
 *                                                                             returning → idle
 *  depart    { to_room, to_label, recipient?, memo?, caller?, target }  물건 싣고 출발   loading → delivering
 *  delivered {}                        받는 사람이 받음                          at_recipient|delivering → returning
 *  target    { target }                지금 모드의 목적지 경로만 바꾸기 (예: 돌아갈 경로)
 *  progress  { passed, next, speed? }  라인 트레이스: 노드를 지날 때마다 보고
 *  position  { floor, x, y, label? }   로봇 위치를 직접 지정 (관리자)
 *  cancel    { reason? }               지금 호출 취소 → 제자리로 (데려다주기를 마칠 때도)
 *  reset     {}                        로봇을 대기 상태로 초기화 (관리자)
 *
 *  target = { room, label, floor, x, y, plan }  — plan 은 라인 트레이스용 노드 경로 (js/router.js 의 robotPlan)
 *
 *  ?fmt=text 를 붙이면 (ESP8266 같은 로봇 몸체용) GET /api/robot/drive 와 같은 짧은 글자 형식으로 답한다.
 */
import {
  getDb, getRobot, setRobot, json, handle, readBody, requireRobot, text, roomId, newId,
  jsonField, HttpError, driveText, ROBOT_ID,
} from '../../../lib/shared.js';
import { robotState } from '../../../lib/robot.js';

// 새 목적지를 받을 때마다 받은 시각을 넣어 둔다 → 같은 길이라도 계획 번호(rev)가 새로 바뀜
// (로봇 몸체는 끝냈거나 실패한 rev 를 다시 출발하지 않으므로, 새 호출은 늘 새 rev 여야 함)
const targetField = (t) => jsonField(t && typeof t === 'object' ? Object.assign({}, t, { issuedAt: Date.now() }) : t);

const MISSION = ['to_caller', 'loading', 'delivering', 'at_recipient', 'guiding', 'guided'];

function need(robot, modes, what) {
  if (!modes.includes(robot.mode)) throw new HttpError(409, `지금 로봇 상태(${robot.mode})에서는 ${what}을(를) 할 수 없어요`);
}
const endOf = (target) => (target ? { floor: target.floor, x: target.x, y: target.y, label: target.label || null } : null);

const actions = {
  async accept(db, b, robot, t) {
    need(robot, ['idle', 'returning'], '호출 받기');
    const id = text(b.id, 20);
    const c = id && await db.prepare('SELECT * FROM calls WHERE id = ?').bind(id).first();
    if (!c || c.status !== 'waiting') throw new HttpError(409, '기다리는 호출이 아니에요');
    await db.prepare("UPDATE calls SET status = 'coming', coming_at = ?, updated_at = ? WHERE id = ?").bind(t, t, id).run();
    await setRobot(db, { mode: 'to_caller', call_id: id, target: targetField(b.target), progress: null });
  },

  async walkup(db, b, robot, t) {
    need(robot, ['idle', 'returning'], '바로 배달');
    const id = newId(8);
    await db.prepare(
      `INSERT INTO calls (id, token, status, kind, from_room, from_label, caller, created_at, updated_at, loading_at)
       VALUES (?, ?, 'loading', 'walkup', ?, ?, ?, ?, ?, ?)`,
    ).bind(id, newId(24), roomId(b.from_room), text(b.from_label, 60), text(b.caller, 30), t, t, t).run();
    await setRobot(db, { mode: 'loading', call_id: id, target: null, progress: null });
  },

  // 데려다주기: 호출 기록 없이 로봇만 목적지로. 도착하면 guided, 마치면 cancel 로 제자리에
  async guide(db, b, robot) {
    need(robot, ['idle', 'returning'], '길 안내');
    if (!b.target || !b.target.plan) throw new HttpError(400, '목적지 경로(target.plan)가 필요해요');
    await setRobot(db, { mode: 'guiding', call_id: null, target: targetField(b.target), progress: null });
  },

  async arrived(db, b, robot, t) {
    const pos = b.position ? jsonField(b.position, 2000) : jsonField(endOf(robot.target), 2000);
    if (robot.mode === 'to_caller') {
      await db.prepare("UPDATE calls SET status = 'loading', loading_at = ?, updated_at = ? WHERE id = ?").bind(t, t, robot.callId).run();
      await setRobot(db, { mode: 'loading', position: pos, progress: null });
    } else if (robot.mode === 'delivering') {
      await db.prepare("UPDATE calls SET status = 'at_recipient', arrived_at = ?, updated_at = ? WHERE id = ?").bind(t, t, robot.callId).run();
      await setRobot(db, { mode: 'at_recipient', position: pos, progress: null });
    } else if (robot.mode === 'guiding') {
      await setRobot(db, { mode: 'guided', position: pos, progress: null });
    } else if (robot.mode === 'returning') {
      await setRobot(db, { mode: 'idle', call_id: null, target: null, position: pos, progress: null });
    } else {
      throw new HttpError(409, '지금은 도착할 곳이 없어요');
    }
  },

  async depart(db, b, robot, t) {
    need(robot, ['loading'], '배달 출발');
    const toRoom = roomId(b.to_room);
    await db.prepare(
      `UPDATE calls SET status = 'delivering', to_room = ?, to_label = ?, recipient = ?, memo = ?,
         caller = COALESCE(?, caller), departed_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(toRoom, text(b.to_label, 60), text(b.recipient, 30), text(b.memo, 120), text(b.caller, 30), t, t, robot.callId).run();
    await setRobot(db, { mode: 'delivering', target: targetField(b.target), progress: null });
  },

  async delivered(db, b, robot, t) {
    need(robot, ['at_recipient', 'delivering'], '배달 완료');
    await db.prepare("UPDATE calls SET status = 'delivered', ended_at = ?, updated_at = ? WHERE id = ?").bind(t, t, robot.callId).run();
    await setRobot(db, { mode: 'returning', call_id: null, target: null, progress: null });
  },

  async target(db, b, robot) {
    if (robot.mode === 'idle') throw new HttpError(409, '대기 중에는 목적지를 정할 수 없어요');
    await setRobot(db, { target: targetField(b.target), progress: null });
  },

  async progress(db, b, robot, t) {
    const passed = text(b.passed, 40);
    if (!passed) throw new HttpError(400, 'passed(지난 노드)가 필요해요');
    const speed = Number(b.speed);
    await setRobot(db, {
      progress: jsonField({ passed, next: text(b.next, 40), at: t, speed: Number.isFinite(speed) && speed > 0 ? speed : null }, 1000),
    });
  },

  async position(db, b) {
    const floor = Number(b.floor), x = Number(b.x), y = Number(b.y);
    if (![floor, x, y].every(Number.isFinite)) throw new HttpError(400, '위치가 올바르지 않아요');
    await setRobot(db, { position: jsonField({ floor, x, y, label: text(b.label, 60) }, 1000) });
  },

  async cancel(db, b, robot, t) {
    if (robot.callId) {
      await db.prepare("UPDATE calls SET status = 'canceled', ended_at = ?, updated_at = ? WHERE id = ?")
        .bind(t, t, robot.callId).run();
    }
    const away = MISSION.includes(robot.mode) || robot.mode === 'returning';
    await setRobot(db, { mode: away ? 'returning' : 'idle', call_id: null, target: null, progress: null });
  },

  async reset(db, b, robot, t) {
    if (robot.callId) {
      await db.prepare("UPDATE calls SET status = 'canceled', ended_at = ?, updated_at = ? WHERE id = ? AND status NOT IN ('delivered','canceled','expired')")
        .bind(t, t, robot.callId).run();
    }
    if (b && b.all) {   // 터미널 reset: 기다리는 호출까지 모두 취소 (초기화 뒤 로봇 화면이 바로 다음 호출을 받아 출발하지 않게)
      await db.prepare("UPDATE calls SET status = 'canceled', ended_at = ?, updated_at = ? WHERE status NOT IN ('delivered','canceled','expired')")
        .bind(t, t).run();
    }
    await setRobot(db, { mode: 'idle', call_id: null, target: null, progress: null });
  },
};

export const onRequestPost = handle(async ({ request, env, params }) => {
  requireRobot(request, env);
  const fn = actions[params.action];
  if (!fn) throw new HttpError(404, '없는 동작이에요');
  const db = await getDb(env);
  const robot = await getRobot(db);
  await fn(db, await readBody(request), robot, Date.now());
  if (new URL(request.url).searchParams.get('fmt') === 'text') {
    await db.prepare('UPDATE robot SET body_seen_at = ? WHERE id = ?').bind(Date.now(), ROBOT_ID).run();
    return driveText(await getRobot(db));
  }
  return json(await robotState(db));
});
