/* 배달 호출 저장소 (Cloudflare Pages Functions 공용)
 *
 * KV 바인딩 CALLS 에 키 하나('calls')로 호출 목록 전체를 JSON 으로 저장합니다.
 * 호출 수가 적어서(동시에 수십 건 이하) 키 하나로 충분하고, 무료 KV 의 list 한도(하루 1,000회)를 쓰지 않습니다.
 *
 * 비밀값(선택, Cloudflare 대시보드 → Pages → kis-peekok → Settings → Variables and Secrets):
 *   ROBOT_KEY  로봇 기기 키. 넣으면 호출 목록 보기·상태 바꾸기에 이 키가 필요합니다.
 *   CALL_PIN   호출할 때 묻는 학교 코드. 넣지 않으면 PIN 없이 호출합니다.
 */

const KEY = 'calls';
const MAX_OPEN = 20;            // 동시에 열려 있는 호출 최대 수
const KEEP_FINISHED_MS = 60 * 60 * 1000;   // 끝난 호출은 1시간 보관
const KEEP_ANY_MS = 12 * 60 * 60 * 1000;   // 모든 호출은 12시간 뒤 정리

export const STATUSES = ['waiting', 'accepted', 'arrived', 'done', 'canceled'];
export const OPEN = ['waiting', 'accepted', 'arrived'];

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}
export const fail = (status, error) => json({ error }, status);

export function storeOf(env) {
  if (!env || !env.CALLS) return null;
  return env.CALLS;
}
export const noStore = () => fail(503, '호출 저장소(KV)가 아직 연결되지 않았어요. 관리자에게 알려 주세요.');

export async function load(kv) {
  let list = [];
  try { list = JSON.parse((await kv.get(KEY)) || '[]'); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  const now = Date.now();
  return list.filter((c) => now - c.createdAt < KEEP_ANY_MS && (OPEN.includes(c.status) || now - c.updatedAt < KEEP_FINISHED_MS));
}
export async function save(kv, list) {
  await kv.put(KEY, JSON.stringify(list.slice(-100)));
}

export function isRobot(request, env) {
  if (!env.ROBOT_KEY) return true;
  return request.headers.get('x-robot-key') === env.ROBOT_KEY;
}

const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

export function newCall(body) {
  const place = clip(body.place, 40);
  if (!place) return { error: '호출할 장소를 골라 주세요.' };
  const floor = Number(body.floor);
  const now = Date.now();
  return {
    call: {
      id: crypto.randomUUID().slice(0, 8),
      token: crypto.randomUUID(),
      roomId: clip(body.roomId, 60) || null,
      place,
      floor: Number.isInteger(floor) && floor >= 1 && floor <= 9 ? floor : null,
      note: clip(body.note, 120),
      name: clip(body.name, 20),
      status: 'waiting',
      createdAt: now,
      updatedAt: now,
    },
  };
}

// 호출한 사람에게 보여 주는 정보 (토큰 제외 + 앞에 기다리는 호출 수)
export function publicView(call, list) {
  const { token, ...rest } = call;
  const ahead = call.status === 'waiting'
    ? list.filter((c) => OPEN.includes(c.status) && c.createdAt < call.createdAt).length
    : 0;
  return { ...rest, ahead };
}
// 로봇 화면용 (토큰 제외)
export const robotView = (call) => { const { token, ...rest } = call; return rest; };

export async function readJson(request) {
  try { return await request.json(); } catch (e) { return null; }
}

export { MAX_OPEN };
