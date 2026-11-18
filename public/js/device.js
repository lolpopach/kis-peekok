/* 이 기기가 로봇(얼굴 화면)인지 구분하기
 *
 * 로봇 태블릿에서 한 번만 이 주소를 엽니다:   https://kis-peekok.pages.dev/?robot=<로봇 기기 키>
 *   - 키는 Cloudflare 비밀값 ROBOT_KEY 와 같은 값. ROBOT_KEY 를 쓰지 않으면 아무 값이나(?robot=1) 됩니다.
 *   - 이 기기의 브라우저에 저장되어 다음부터는 그냥 주소로 열어도 로봇 화면이 나옵니다.
 *   - 등록 해제: ?robot=off
 * 로봇으로 등록되지 않은 기기가 첫 화면(index.html)에 들어오면 배달 호출 화면(call.html)으로 넘어갑니다.
 * 내 컴퓨터에서 미리보기(localhost, 파일로 열기)는 로봇으로 봅니다.
 */
window.KIS = window.KIS || {};

KIS.Device = (function () {
  const SKEY = 'kis-robot-device';
  const read = () => { try { return localStorage.getItem(SKEY); } catch (e) { return null; } };
  const write = (v) => { try { v == null ? localStorage.removeItem(SKEY) : localStorage.setItem(SKEY, v); } catch (e) { /* 저장 불가 */ } };

  const q = new URLSearchParams(location.search);
  const p = q.get('robot');
  if (p !== null) {
    if (p === 'off' || p === '0') write(null);
    else write(p || '1');
  }
  const key = read();
  const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const isRobot = !!key || (local && p !== 'off' && p !== '0');

  return {
    isRobot,
    registered: !!key,
    key: key && key !== '1' ? key : '',
    unregister() { write(null); },
    apiHeaders() { return key && key !== '1' ? { 'x-robot-key': key } : {}; },
  };
})();

// 첫 화면에서만: 로봇이 아니면 호출 화면으로
if (document.documentElement.dataset.page === 'robot' && !KIS.Device.isRobot) {
  location.replace('call.html');
}
