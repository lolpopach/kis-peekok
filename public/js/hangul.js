/* 화면 키보드용 한글 조합 (두벌식) + 초성 검색 도우미 */
window.KIS = window.KIS || {};

KIS.Hangul = (function () {
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  const JUNG_COMB = { 'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ' };
  const JONG_COMB = { 'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ' };
  const split = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [v, [k[0], k[1]]]));
  const JUNG_SPLIT = split(JUNG_COMB), JONG_SPLIT = split(JONG_COMB);

  const isVowel = (c) => JUNG.includes(c);
  const isCons = (c) => CHO.includes(c);

  function compose(cur) {
    if (cur.cho && cur.jung) {
      return String.fromCharCode(0xac00 + (CHO.indexOf(cur.cho) * 21 + JUNG.indexOf(cur.jung)) * 28 + JONG.indexOf(cur.jong || ''));
    }
    return (cur.cho || '') + (cur.jung || '');
  }

  class Composer {
    constructor() { this.clear(); }
    clear() { this.text = ''; this.cur = {}; }
    commit() { this.text += compose(this.cur); this.cur = {}; }
    value() { return this.text + compose(this.cur); }
    input(ch) {
      const c = this.cur;
      if (isCons(ch)) {
        if (!c.cho && !c.jung) c.cho = ch;
        else if (!c.jung || !c.cho) { this.commit(); this.cur.cho = ch; }
        else if (!c.jong) { if (JONG.includes(ch)) c.jong = ch; else { this.commit(); this.cur.cho = ch; } }
        else if (JONG_COMB[c.jong + ch]) c.jong = JONG_COMB[c.jong + ch];
        else { this.commit(); this.cur.cho = ch; }
      } else if (isVowel(ch)) {
        if (!c.cho && !c.jung) c.jung = ch;
        else if (c.cho && !c.jung) c.jung = ch;
        else if (!c.jong) {
          if (JUNG_COMB[c.jung + ch]) c.jung = JUNG_COMB[c.jung + ch];
          else { this.commit(); this.cur.jung = ch; }
        } else {
          let nextCho;
          if (JONG_SPLIT[c.jong]) { const [a, b] = JONG_SPLIT[c.jong]; c.jong = a; nextCho = b; }
          else { nextCho = c.jong; c.jong = ''; }
          this.commit();
          this.cur = { cho: nextCho, jung: ch };
        }
      } else {
        this.commit();
        this.text += ch;
      }
    }
    backspace() {
      const c = this.cur;
      if (c.jong) c.jong = JONG_SPLIT[c.jong] ? JONG_SPLIT[c.jong][0] : '';
      else if (c.jung) { c.jung = JUNG_SPLIT[c.jung] ? JUNG_SPLIT[c.jung][0] : ''; if (!c.jung && !c.cho) this.cur = {}; }
      else if (c.cho) this.cur = {};
      else this.text = this.text.slice(0, -1);
    }
  }

  function choseong(str) {
    return Array.from(str).map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) return CHO[Math.floor((code - 0xac00) / 588)];
      return ch;
    }).join('');
  }

  // 입력 중인 글자까지 고려한 부분 일치: "보ㄱ", "보거", "ㅂㄱㅅ" 모두 "보건실"과 맞음
  function charMatch(q, n, isLastQ) {
    if (q === n) return true;
    const qc = q.charCodeAt(0), nc = n.charCodeAt(0);
    const nSyl = nc >= 0xac00 && nc <= 0xd7a3;
    if (isCons(q)) return nSyl && CHO[Math.floor((nc - 0xac00) / 588)] === q;
    if (isLastQ && nSyl && qc >= 0xac00 && qc <= 0xd7a3) {
      const qj = (qc - 0xac00) % 28;
      return qj === 0 && Math.floor((qc - 0xac00) / 28) === Math.floor((nc - 0xac00) / 28);
    }
    return false;
  }
  function fuzzyIndex(name, query) {
    const n = Array.from(name), q = Array.from(query);
    for (let i = 0; i + q.length <= n.length; i++) {
      let ok = true;
      for (let j = 0; j < q.length; j++) {
        if (!charMatch(q[j], n[i + j], j === q.length - 1)) { ok = false; break; }
      }
      if (ok) return i;
    }
    return -1;
  }

  return { Composer, choseong, fuzzyIndex, isCons, isVowel };
})();
