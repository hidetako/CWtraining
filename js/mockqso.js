// 模擬交信（自由に打つ）の相手局
//
// 台本を読み上げる相手ではなく、こちらが実際に打った内容に反応する相手局。
// 打った文を解析して「何が伝わったか」を判断し、足りなければ聞き返し、
// 足りていれば次へ進む。模範解答は毎回出すが、そのとおりに打たなくても
// 流れに合わせて受け答えする。
//
// 画面や音は持たない。receive() に打った文を渡すと、相手局の送信文と、
// こちらの送信の評価（何が伝わって何が抜けたか）を返す。音を鳴らすのは
// 呼び出し側の仕事。

import {
  GLAD_PHRASES, SOLID_COPY, greetingForHour, makeCallsign, pick, pickInt,
} from './data.js';
import { makeStation } from './qso.js';
import { PHASES } from './qsoguide.js';
import { normalizeTyped } from './morse.js';
import { matchCall } from './contest.js';

const CALLSIGN_RE = /^[A-Z0-9]{1,3}[0-9][A-Z]{1,4}(?:\/[A-Z0-9]{1,3})?$/;
const RST_RE = /^(?:[1-5][1-9N][1-9N]|5NN)$/;

/** BK 調に直す対象の送信。締め（<SK>）と呼び出し・QRZ? は型のまま。 */
const BK_KINDS = new Set(['ex1', 'ex2', 'ack', 'rstQuery', 'nameQuery', 'agn', 'correct']);

function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 相手局の速度の範囲（WPM）。 */
export const DX_WPM_RANGE = { min: 8, max: 35 };

/** パイルアップの選択肢。呼んでくる局の数。 */
export const PILEUP_OPTIONS = {
  none: { label: 'なし（1 局だけ）', callers: 1 },
  small: { label: '小さめ（2 局）', callers: 2 },
  big: { label: '大きめ（4 局）', callers: 4 },
};

/** 相手のゆらぎ。 */
export const FREE_REACTIONS = {
  random: 'おまかせ（毎回変わる）',
  normal: '型どおり',
  nameQuery: '名前を聞き返される',
  agn: 'もう一度頼まれる',
  qrs: 'ゆっくり頼まれる',
};

/**
 * こちらの送信を読み解く。相手局が「何を受け取ったか」を決める材料。
 * 空白なし・小文字・全角で打たれていても読めるよう、まず正規化する。
 */
export function parseSend(text, { myCall = '', dxCalls = [] } = {}) {
  const raw = normalizeTyped(text).toUpperCase().replace(/\s+/g, ' ').trim();
  // <BT> は = と同じ。読みやすさのため = にそろえる
  const t = raw.replaceAll('<BT>', '=');
  const words = t.split(' ').filter(Boolean);
  const has = (re) => re.test(` ${t} `);

  // 相手のコール。呼んでいる相手を、知っている局の中から探す（部分一致も）
  // matchCall は yes / almost / no を返す。コールサインらしい語（数字を含む）
  // だけを候補にして、TNX や NAME のような語を「惜しい」と取り違えない
  // 「惜しい」局が複数いるときは、いちばん近い（編集距離の小さい）局を取る。
  // パイルアップで似たコールが並ぶと、先に見つかった別の局が訂正に出てしまう
  let calledCall = '';
  let calledMatch = 'none';
  let bestDist = Infinity;
  for (const w of words) {
    if (w === 'DE' || w === myCall || !/[0-9]/.test(w)) continue;
    const typed = w.replace(/\?$/, '');
    for (const c of dxCalls) {
      const m = matchCall(typed, c);
      if (m === 'yes') { calledCall = c; calledMatch = 'exact'; break; }
      if (m === 'almost') {
        const d = editDistance(typed, c);
        if (d < bestDist) { bestDist = d; calledCall = c; calledMatch = 'partial'; }
      }
    }
    if (calledMatch === 'exact') break;
  }

  // 自分のコールを名乗っているか（DE の後ろ、または文中）
  const deIdx = words.indexOf('DE');
  const saidMyCall = !!myCall && words.includes(myCall);
  const afterDe = deIdx >= 0 ? words.slice(deIdx + 1).find((w) => CALLSIGN_RE.test(w)) : '';

  // RST。UR / RST の後ろの 599 / 5NN
  let rst = '';
  for (let i = 0; i < words.length; i++) {
    if (RST_RE.test(words[i]) && /(UR|RST)/.test(words.slice(Math.max(0, i - 3), i).join(' '))) {
      rst = words[i].replaceAll('N', '9');
      break;
    }
  }
  const nameM = t.match(/(?:NAME|OP)\s+(?:HR\s+|IS\s+)?([A-Z]{2,})/);
  const qthM = t.match(/QTH\s+(?:HR\s+|IS\s+)?([A-Z]{3,})/);

  return {
    text: t,
    words,
    cq: has(/ CQ /),
    calledCall, calledMatch,
    saidMyCall, de: deIdx >= 0, afterDe: afterDe || '',
    rst,
    name: nameM ? nameM[1] : '',
    qth: qthM ? qthM[1] : '',
    rig: has(/ RIG /), ant: has(/ ANT /), pwr: has(/ PWR /), wx: has(/ WX /),
    hw: has(/ HW\?? /),
    roger: has(/ R R | R FB | RR /) || /^R\b/.test(t),
    endsK: /(^| )(K|KN|BK)$/.test(t),
    bk: /(^| )BK$/.test(t),
    seventyThree: has(/ 73 /),
    sk: has(/ (<SK>|SK) /),
    // 聞き返し。HW?（いかがですか）や QRL?/QRZ? は聞き返しではないので、
    // 語で見る: AGN / AGN? / RPT / 単独の ? / RST? NAME? QTH? CALL? NR?
    agn: words.some((w) => /^(AGN\??|RPT|\?|(RST|NAME|QTH|CALL|NR|PSE)\?)$/.test(w)),
    qrs: has(/ QRS /),
    qrz: has(/ QRZ\?? /),
    qrl: has(/ QRL\?? /),
    tnx: has(/ TNX | TKS | TU /),
  };
}

/** 模擬交信の相手局。 */
export class MockQso extends EventTarget {
  /**
   * @param {object} opts
   *   me        自局 { callsign, name, qth, rig, pwr, ant, wx }
   *   mode      'cq'（自分から CQ）| 'answer'（相手の CQ に応答）
   *   dxWpm     相手の速度
   *   pileup    PILEUP_OPTIONS のキー
   *   reaction  FREE_REACTIONS のキー
   */
  constructor(opts = {}) {
    super();
    this.me = {
      callsign: String(opts.me?.callsign || 'JA1ABC').toUpperCase(),
      name: String(opts.me?.name || 'OP').toUpperCase(),
      qth: String(opts.me?.qth || 'TOKYO').toUpperCase(),
      rig: String(opts.me?.rig || 'IC-7300').toUpperCase(),
      pwr: String(opts.me?.pwr || '50W').toUpperCase(),
      ant: String(opts.me?.ant || 'DP').toUpperCase(),
      wx: String(opts.me?.wx || 'FINE').toUpperCase(),
    };
    this.mode = opts.mode === 'answer' ? 'answer' : 'cq';
    this.dxWpm = clampWpm(opts.dxWpm ?? 18);
    this.pileup = PILEUP_OPTIONS[opts.pileup] ? opts.pileup : 'none';
    const r = opts.reaction && FREE_REACTIONS[opts.reaction] ? opts.reaction : 'random';
    this.reaction = r === 'random' ? pick(['normal', 'normal', 'nameQuery', 'agn', 'qrs']) : r;
    this.greet = greetingForHour(opts.hour ?? new Date().getHours());

    // 呼んでくる局。パイルアップなら複数。音程・速度・強さを散らす
    const n = PILEUP_OPTIONS[this.pileup].callers;
    this.callers = [];
    for (let i = 0; i < n; i++) {
      const st = makeStation({ callsign: makeCallsign() });
      st.offset = n === 1 ? 0 : pickInt(-250, 250);
      st.wpm = clampWpm(this.dxWpm + (n === 1 ? 0 : pickInt(-3, 3)));
      st.level = n === 1 ? 1 : 0.5 + Math.random() * 0.5;
      this.callers.push(st);
    }
    this.dx = this.mode === 'answer' ? this.callers[0] : null;   // 交信相手（決まったら）
    this.dxCallsSent = 0;
    this.reactionUsed = false;
    // 相手が受け取った内容
    this.heard = { rst: '', name: '', qth: '', rig: false, ant: false };
    this.transcript = [];      // { dir: 'tx'|'rx', text, station?, wpm? }
    this.lastDx = [];          // 直前の相手の送信（AGN? で繰り返す）
    this.done = false;
    this.turns = 0;

    // 段階: cq を出す側 … myCq → pickup(相手が呼んでくる) → ex1 → ex2 → close → done
    //       応答する側 … dxCq(相手の CQ) → call → ex1(相手から) → ex2 → close → done
    this.phase = this.mode === 'cq' ? 'myCq' : 'call';
    this.pendingDx = [];      // 次に鳴らす相手の送信
    // ブレークイン。こちらが BK で締めたら、相手も前置きなしで要点だけを
    // 返して BK で締める。識別が抜けないよう、数往復に 1 回はコールを付ける
    this.bkMode = false;
    this.bkTurns = 0;
  }

  /** 交信を始める。応答モードなら相手の CQ が流れる。 */
  start() {
    if (this.mode === 'answer') {
      const dx = this.dx;
      this._dxSend(dx, `CQ CQ CQ DE ${dx.callsign} ${dx.callsign} ${dx.callsign} PSE K`, 'cq');
    }
    this._emit('phase');
    return this.pendingDx;
  }

  /** いまの段階の見出し・説明。 */
  get phaseInfo() {
    const map = {
      myCq: PHASES.cq, call: PHASES.call, pickup: PHASES.pickup,
      ex1: PHASES.exchange1, ex2: PHASES.exchange2, close: PHASES.close,
      done: { title: '交信終了', purpose: '', tip: '' },
    };
    return map[this.phase] || PHASES.cq;
  }

  /** 相手のコール（決まっていれば）。 */
  get dxCall() { return this.dx?.callsign || ''; }

  /**
   * 模範解答。いまの段階でこちらが送るべき文。
   * 相手のコールが決まっていなければ「？？？」を置く。
   * @returns {{ label: string, text: string, why: string }}
   */
  expected() {
    const full = this._expectedFull();
    if (!this.bkMode || !this.dx || !full.text || this.phase === 'close' || this.phase === 'done') return full;
    // BK で来ているので、こちらも前置きなしの要点だけ。3 往復に 1 回は識別を入れる
    const me = this.me.callsign;
    const dx = this.dx.callsign;
    let t = full.text
      .replace(new RegExp(`^${esc(dx)} DE ${esc(me)}(?: ${esc(me)})?\\s*=?\\s*`), '')
      .replace(new RegExp(`\\s*=?\\s*(?:HW\\?\\s*)?${esc(dx)} DE ${esc(me)}\\s*K$`), '')
      .replace(/\s*(?:HW\?)?\s*K$/, '')
      .trim();
    const identify = this.bkTurns % 3 === 0;
    if (identify) t = `${dx} DE ${me} ${t}`;
    return {
      label: `${full.label}（BK 調）`,
      text: `${t} BK`,
      why: `相手が BK で返してきたので、前置きなしで要点だけを送り、BK で締めます。${
        identify ? 'この回は識別（相手 DE 自局）を頭に入れます。' : ''}通常の型に戻すなら K で締めます。`,
    };
  }

  _expectedFull() {
    const me = this.me;
    const dx = this.dxCall || '？？？';
    switch (this.phase) {
      case 'myCq':
        return {
          label: 'CQ を出す',
          text: `CQ CQ CQ DE ${me.callsign} ${me.callsign} ${me.callsign} PSE K`,
          why: 'CQ を 3 回、自分のコールを 3 回。最後は K で相手に渡します。',
        };
      case 'call':
        return {
          label: '相手を呼ぶ',
          text: `${dx} DE ${me.callsign} ${me.callsign} K`,
          why: '相手のコール → DE → 自分のコール 2 回。中身はまだ送りません。',
        };
      case 'pickup':
        return {
          label: '呼んできた局を取って、レポートを送る',
          text: this._ex1Text(dx),
          why: '取ったコールを頭に付けて呼び返し、レポート・名前・QTH を送ります。'
            + '自信が無ければ「？？？ DE 自局 AGN?」で聞き直して構いません。',
        };
      case 'ex1':
        return {
          label: 'レポートと自己紹介を送る',
          text: this._ex1Text(dx),
          why: 'UR RST → NAME → QTH の順が定番。大事な語は 2 回。最後に HW? で相手に返します。',
        };
      case 'ex2':
        return {
          label: '了解と設備を送る',
          text: this._ex2Text(dx),
          why: 'R R で受け取ったことを示し、相手の名前を呼び、設備を伝えて 73 に向かいます。',
        };
      case 'close':
        return {
          label: '締めの挨拶',
          text: `${dx} DE ${me.callsign} R TU 73 ES ${pick(['CUAGN', 'BCNU', 'CUAGN SN'])} <SK>`,
          why: '73 と再会の言葉。最後は <SK> で交信を閉じます。',
        };
      default:
        return { label: '交信は終わっています', text: '', why: '' };
    }
  }

  _ex1Text(dx) {
    const me = this.me;
    const rst = this.dx?.rstGot || '599';
    const thanks = this.mode === 'cq' ? 'TNX FER CALL' : 'TNX FER CQ';
    const glad = pick(GLAD_PHRASES);
    return `${dx} DE ${me.callsign} = ${this.greet} DR OM ${thanks} = ${glad} `
      + `= UR RST ${rst} ${rst} = NAME ${me.name} ${me.name} = QTH ${me.qth} ${me.qth} `
      + `= HW? ${dx} DE ${me.callsign} K`;
  }

  _ex2Text(dx) {
    const me = this.me;
    const name = this.dx?.name || 'OM';
    // 応答する側は、ここで初めてレポート・名前・QTH を送る。まだ伝えていない分だけ入れる
    const rst = this.dx?.rstGot || '599';
    const intro = this.mode === 'answer'
      ? [!this.heard.rst && `= UR RST ${rst} ${rst} `, !this.heard.name && `= NAME ${me.name} ${me.name} `,
        !this.heard.qth && `= QTH ${me.qth} ${me.qth} `].filter(Boolean).join('')
      : '';
    return `${dx} DE ${me.callsign} = R R FB ${name} ${pick(SOLID_COPY)} ${intro}`
      + `= RIG HR ${me.rig} ES PWR ${me.pwr} = ANT ${me.ant} `
      + `= ${pick(['TNX FER NICE QSO ES 73', 'MNI TNX FER FB QSO ES 73', 'NW QRU SA 73'])} `
      + `= ${dx} DE ${me.callsign} K`;
  }

  /**
   * こちらの送信を受け取る。相手局の返事を組み立てて pendingDx に積む。
   * @returns {{ feedback: object, dx: Array<{ text, station, wpm, kind }> }}
   */
  receive(text) {
    if (this.done) return { feedback: { notes: ['交信は終わっています。'] }, dx: [] };
    const known = this.dx ? [this.dx.callsign] : this.callers.map((c) => c.callsign);
    const p = parseSend(text, { myCall: this.me.callsign, dxCalls: known });
    this.transcript.push({ dir: 'tx', text: p.text });
    this.pendingDx = [];
    this.turns += 1;
    const fb = { phase: this.phase, got: [], missing: [], notes: [] };

    // BK で締めれば相手も BK 調に、K で締め直せば通常の型に戻る。
    // 相手がまだ決まっていない（呼んできた局を取る）送信でも受け付ける。
    // 型に直すのは相手の送信を組み立てるときなので、その時点では決まっている
    if (p.bk) {
      if (!this.bkMode) fb.notes.push('BK で締めたので、相手も前置きなしの短いやり取り（BK 調）で返します。数往復に 1 回は識別が入ります。');
      this.bkMode = true;
    } else if (p.endsK || p.sk) {
      if (this.bkMode) fb.notes.push('K で締めたので、通常の型（コール付き）に戻ります。');
      this.bkMode = false;
      this.bkTurns = 0;
    }

    // どの段階でも効く、こちらからの頼みごと
    if (p.qrs && this.dx) {
      this.dxWpm = clampWpm(this.dxWpm - 4);
      this.dx.wpm = this.dxWpm;
      fb.notes.push(`QRS を送ったので、相手は ${this.dxWpm} WPM に落としました。`);
      this._repeatLast(fb);
      return this._finish(fb);
    }
    if (p.agn && !p.rst && !p.cq && this.lastDx.length && this.phase !== 'myCq' && this.phase !== 'call') {
      fb.notes.push('もう一度頼んだので、相手は直前の内容を繰り返します。');
      this._repeatLast(fb);
      return this._finish(fb);
    }
    if (p.qrz && this.phase === 'pickup') {
      fb.notes.push('QRZ? を送ったので、呼んでいる局がもう一度コールを打ちます。');
      this._callersCall();
      return this._finish(fb);
    }
    // 早めの 73 / SK。相手も締めに合わせる。
    // 第 2 交換の型には 73 が入っている（… TNX FER QSO ES 73 …）ので、
    // 「早め」と見るのは交換が終わる前（呼び出し〜第 1 交換）だけ
    const closing = (p.seventyThree || p.sk) && this.dx && !['close', 'done'].includes(this.phase);
    const hasContent = p.rst || p.name || p.qth || p.rig || p.ant || p.pwr;
    if (closing && (!hasContent || ['call', 'pickup', 'ex1'].includes(this.phase))) {
      if (this.phase === 'ex1') this._absorb(p, fb);
      fb.notes.push('73 を送ったので、相手も締めに入ります。まだ交換していない内容はそのままです。');
      this._dxClose(fb, { short: true });
      return this._finish(fb);
    }

    switch (this.phase) {
      case 'myCq': this._onMyCq(p, fb); break;
      case 'call': this._onCall(p, fb); break;
      case 'pickup': this._onPickup(p, fb); break;
      case 'ex1': this._onEx1(p, fb); break;
      case 'ex2': this._onEx2(p, fb); break;
      case 'close': this._onClose(p, fb); break;
      default: break;
    }
    return this._finish(fb);
  }

  _finish(fb) {
    this._emit('phase');
    return { feedback: fb, dx: this.pendingDx };
  }

  // ───────── 段階ごとの反応 ─────────

  _onMyCq(p, fb) {
    if (!p.cq) {
      fb.notes.push('CQ が入っていないので、誰も呼んできません。CQ CQ CQ DE 自局コール … K の形で出します。');
      return;
    }
    fb.got.push('CQ');
    if (!p.saidMyCall) {
      fb.missing.push('自局のコールサイン');
      fb.notes.push('自分のコールが無いと、誰が呼んでいるのか分からず応答がありません。');
      return;
    }
    fb.got.push('自局のコール');
    if (!p.endsK) fb.notes.push('最後は K（どうぞ）で締めると、相手が応答しやすくなります。');
    this.phase = 'pickup';
    this._callersCall();
  }

  _onCall(p, fb) {
    const dx = this.dx;
    if (!p.saidMyCall && !p.afterDe) {
      fb.missing.push('自局のコールサイン');
      fb.notes.push('自分のコールが入っていません。相手は誰に呼ばれたか分からず、QRZ? を返します。');
      this._dxSend(dx, `QRZ? DE ${dx.callsign} K`, 'qrz');
      return;
    }
    fb.got.push('自局のコール');
    if (p.calledMatch !== 'exact') {
      fb.notes.push(p.calledMatch === 'partial'
        ? '相手のコールが少し違います。相手は自分のコールを打ち直して訂正します。'
        : '相手のコールが入っていませんが、自局のコールは伝わったので相手は応答します。');
    } else fb.got.push('相手のコール');

    // パイルアップ: 他局にかぶせられて、最初は取ってもらえない
    if (this.callers.length > 1 && this.dxCallsSent === 0) {
      this.dxCallsSent += 1;
      const partial = this.me.callsign.slice(0, 3);
      this._dxSend(dx, `${partial}? DE ${dx.callsign} AGN K`, 'partial');
      fb.notes.push('他の局もいっしょに呼んでいて、相手はコールの一部しか取れていません。もう一度呼びます。');
      this._emit('pileup', { others: this.callers.slice(1) });
      return;
    }
    // ゆらぎ: ゆっくり頼まれる
    if (this.reaction === 'qrs' && !this.reactionUsed) {
      this.reactionUsed = true;
      this._dxSend(dx, `${this.me.callsign} DE ${dx.callsign} QRS PSE QRS K`, 'qrs');
      fb.notes.push('相手はゆっくり打ってほしいと言っています。パドル欄の送信速度を落として、もう一度呼びます。');
      this.phase = 'call';
      return;
    }
    this.phase = 'ex2';    // 相手からレポートが来るので、次にこちらは第 2 交換
    this._dxEx1();
  }

  _onPickup(p, fb) {
    // 呼んできた局のコールを取って呼び返す。相手が決まったら第 1 交換へ
    if (p.calledMatch === 'none') {
      fb.missing.push('呼んできた局のコールサイン');
      fb.notes.push(this.callers.length > 1
        ? 'どの局のコールも取れていません。呼んでいる局がもう一度打ちます。QRZ? で聞き直しても構いません。'
        : '相手のコールが取れていません。相手がもう一度コールを打ちます。');
      this._callersCall();
      return;
    }
    const st = this.callers.find((c) => c.callsign === p.calledCall);
    if (p.calledMatch === 'partial') {
      fb.notes.push(`${st.callsign} を取り違えています。その局が自分のコールを打ち直して訂正します。`);
      this._dxSend(st, `DE ${st.callsign} ${st.callsign} K`, 'correct');
      return;
    }
    this.dx = st;
    fb.got.push(`相手のコール ${st.callsign}`);
    // 同じ送信にレポートまで入っていれば第 1 交換も済んだことにする
    if (p.rst || p.name) {
      this._takeEx1(p, fb);
      return;
    }
    fb.notes.push('コールは取れました。続けてレポート・名前・QTH を送ります。');
    this.phase = 'ex1';
    this._dxSend(st, `${this.me.callsign} DE ${st.callsign} ${st.callsign} K`, 'ack');
  }

  _onEx1(p, fb) { this._takeEx1(p, fb); }

  /** こちらの第 1 交換（レポート・名前・QTH）を相手が受け取る。 */
  _takeEx1(p, fb) {
    const dx = this.dx;
    // 聞き返しに答えて名前だけ送り直す、というやり取りがあるので、
    // 今回の送信だけでなく、これまでに受け取った内容と合わせて判断する
    this._absorb(p, fb);
    if (!p.saidMyCall) fb.notes.push('自局のコールが入っていません。相手は覚えているので進みますが、識別のため入れるのが決まりです。');

    if (!this.heard.rst) {
      fb.notes.push('レポートが無いので、相手は RST を聞き返します。');
      this._dxSend(dx, `${this.me.callsign} DE ${dx.callsign} UR RST AGN? PSE RPT RST K`, 'rstQuery');
      this.phase = 'ex1';
      return;
    }
    if (!this.heard.name && this.reaction !== 'normal') {
      // 名前を聞き返すのは 1 回で十分。ゆらぎの「名前を聞き返される」もこれで使い切る
      this.reactionUsed = true;
      fb.notes.push('名前が無いので、相手は名前だけを聞き返します。');
      this._dxSend(dx, `${this.me.callsign} DE ${dx.callsign} R UR RST ${dx.rstGiven} ${dx.rstGiven} = NAME AGN? PSE NAME K`, 'nameQuery');
      this.phase = 'ex1';
      this.heard.rstDelivered = true;
      return;
    }
    // ゆらぎ: 取れていても名前を聞き返す
    if (this.reaction === 'nameQuery' && !this.reactionUsed && p.name) {
      this.reactionUsed = true;
      fb.notes.push('相手は名前だけ取れなかったようです。名前だけ 2〜3 回繰り返せば十分です。');
      this._dxSend(dx, `${this.me.callsign} DE ${dx.callsign} R R = NAME AGN? NAME AGN? K`, 'nameQuery');
      this.phase = 'ex1';
      return;
    }
    if (this.reaction === 'agn' && !this.reactionUsed) {
      this.reactionUsed = true;
      fb.notes.push('相手は取りこぼしたようで、もう一度頼んでいます。同じ内容を、大事な語を 2 回ずつで送り直します。');
      this._dxSend(dx, `${this.me.callsign} DE ${dx.callsign} SRI QRM PSE AGN AGN K`, 'agn');
      this.phase = 'ex1';
      return;
    }
    this.phase = this.mode === 'cq' ? 'ex2' : 'close';
    if (this.mode === 'cq') this._dxEx2(fb);
    else this._dxClose(fb, {});
  }

  /** 今回の送信から RST・名前・QTH を受け取り、既に受け取っている分と合わせる。 */
  _absorb(p, fb) {
    const h = this.heard;
    if (p.rst) { h.rst = p.rst; fb.got.push(`RST ${p.rst}`); } else if (!h.rst) fb.missing.push('RST');
    if (p.name) { h.name = p.name; fb.got.push(`NAME ${p.name}`); } else if (!h.name) fb.missing.push('NAME');
    if (p.qth) { h.qth = p.qth; fb.got.push(`QTH ${p.qth}`); } else if (!h.qth) fb.missing.push('QTH');
  }

  _onEx2(p, fb) {
    const dx = this.dx;
    if (p.roger) fb.got.push('R R（了解）');
    if (this.mode === 'answer') {
      // 応答する側: ここで初めてレポートを送る
      this._absorb(p, fb);
      if (!this.heard.rst) {
        fb.notes.push('こちらからのレポートがまだです。相手は RST を聞き返します。');
        this._dxSend(dx, `${this.me.callsign} DE ${dx.callsign} UR RST AGN? PSE RPT RST K`, 'rstQuery');
        return;
      }
    }
    if (p.rig || p.ant || p.pwr) { this.heard.rig = true; fb.got.push('設備'); } else fb.missing.push('設備（RIG・ANT・PWR）');
    this.phase = 'close';
    this._dxClose(fb, {});
  }

  _onClose(p, fb) {
    if (p.seventyThree) fb.got.push('73'); else fb.missing.push('73');
    if (p.sk) fb.got.push('<SK>'); else fb.notes.push('最後は <SK> で閉じます。K だと相手はまだ続くと受け取ります。');
    this.phase = 'done';
    this.done = true;
    // 相手の最後のひとこと
    this._dxSend(this.dx, pick(['E E', 'TU E E', '73 E E']), 'bye');
    this._emit('done');
  }

  // ───────── 相手局の送信 ─────────

  /** 呼んでくる局（1 局または複数）が、こちらの CQ に応答する。 */
  _callersCall() {
    for (const st of this.callers) {
      const twice = Math.random() < 0.7;
      this._dxSend(st, `${this.me.callsign} DE ${st.callsign}${twice ? ` ${st.callsign}` : ''} K`, 'call', { together: true });
    }
  }

  /** 相手から第 1 交換（応答モードで、こちらが呼んだあと）。 */
  _dxEx1() {
    const dx = this.dx;
    const me = this.me.callsign;
    const text = `${me} DE ${dx.callsign} = ${this.greet} DR OM TNX FER CALL = UR RST ${dx.rstGiven} ${dx.rstGiven} `
      + `= NAME ${dx.name} ${dx.name} = QTH ${dx.qth} ${dx.qth} = HW? ${me} DE ${dx.callsign} K`;
    this._dxSend(dx, text, 'ex1');
  }

  /** 相手から第 2 交換（CQ モードで、こちらのレポートのあと）。 */
  _dxEx2(fb) {
    const dx = this.dx;
    const me = this.me.callsign;
    const name = this.heard.name || 'OM';
    const text = `${me} DE ${dx.callsign} = R R FB ${name} ES TNX FER RPRT = UR RST ${dx.rstGiven} ${dx.rstGiven} `
      + `= NAME ${dx.name} ${dx.name} = QTH ${dx.qth} ${dx.qth} `
      + `= RIG HR ${dx.rig} ES PWR ${dx.pwr} = ANT ${dx.ant} = HW? ${me} DE ${dx.callsign} K`;
    this._dxSend(dx, text, 'ex2');
    fb.notes.push('相手からレポート・名前・QTH・設備が来ます。次は了解（R R）と自局の設備を返します。');
  }

  /** 相手の締め。short なら手短に。 */
  _dxClose(fb, { short }) {
    const dx = this.dx;
    const me = this.me.callsign;
    const name = this.heard.name || 'OM';
    const parts = [`${me} DE ${dx.callsign}`];
    if (this.mode === 'answer' && this.phase !== 'close' && !short) {
      // 応答モードでこちらの第 2 交換のあと: 相手も設備を返して締める
      parts.push(`= R R FB ${name} ${pick(SOLID_COPY)}`, `= RIG HR ${dx.rig} ES PWR ${dx.pwr} = ANT ${dx.ant}`);
    } else {
      parts.push(`= R FB TNX FER FB QSO ${name}`);
    }
    parts.push(`= ${pick(['HPE CUAGN', 'CUAGN SN', 'BCNU', 'I WL CU VY SN'])} = 73 ES GL`, `= ${me} DE ${dx.callsign} <SK>`);
    this._dxSend(dx, parts.join(' '), 'close');
    this.phase = 'close';
    fb.notes.push('相手は 73 を送って締めに入りました。こちらも 73 と <SK> で閉じます。');
  }

  _repeatLast(fb) {
    // BK 調に直す前の文から作り直す。直した文にもう一度かけると崩れるし、
    // 繰り返しも 1 回の送信なので識別の数え方は続ける
    for (const d of this.lastDx) this._dxSend(d.station, d.raw, d.kind, { together: d.together, keep: true });
    if (!this.lastDx.length) fb.notes.push('まだ相手の送信がありません。');
  }

  /**
   * BK 調に直す。頭の「自局 DE 相手」と、尻の「HW? 自局 DE 相手 K」を落として
   * BK で締める。3 往復に 1 回は識別（自局 DE 相手）を頭に残す。
   * 締め（<SK>）と呼び出しの類は対象にしない。
   */
  _bkStyle(text, kind) {
    if (!this.bkMode || !this.dx || !BK_KINDS.has(kind)) return text;
    const me = this.me.callsign;
    const dx = this.dx.callsign;
    let t = text
      .replace(new RegExp(`^${esc(me)} DE ${esc(dx)}(?: ${esc(dx)})?\\s*=?\\s*`), '')
      .replace(new RegExp(`\\s*=?\\s*(?:HW\\?\\s*)?${esc(me)} DE ${esc(dx)}\\s*K$`), '')
      .replace(/\s*(?:HW\?)?\s*K$/, '')
      .trim();
    this.bkTurns += 1;
    if (this.bkTurns % 3 === 0) t = `${me} DE ${dx} ${t}`;   // 3 往復に 1 回は識別
    return `${t} BK`;
  }

  _dxSend(station, text, kind, { together = false, keep = false } = {}) {
    const raw = text;
    text = this._bkStyle(text, kind);
    const entry = { text, raw, station, wpm: station.wpm, kind, together };
    this.pendingDx.push(entry);
    this.transcript.push({ dir: 'rx', text, station: station.callsign });
    if (!keep) {
      // 同時に呼んでくる複数局は、まとめて「直前の送信」にする
      if (together && this.lastDx.length && this.lastDx[0].together && this.lastDx[0].kind === kind
          && this.pendingDx.length > 1) this.lastDx.push(entry);
      else this.lastDx = [entry];
    }
  }

  /**
   * 相談: いまの状況の説明と、次にどう返せばよいか。API を使わない場合の答え。
   * @param {string} [question]
   */
  advise(question = '') {
    const info = this.phaseInfo;
    const exp = this.expected();
    const last = this.lastDx.map((d) => d.text).join(' / ');
    const lines = [];
    lines.push(`いまは「${info.title}」の段階です。${info.purpose}`);
    if (last) lines.push(`相手の直前の送信: ${last}`);
    if (this.dx) {
      const h = this.heard;
      const got = [h.rst && `RST ${h.rst}`, h.name && `NAME ${h.name}`, h.qth && `QTH ${h.qth}`].filter(Boolean);
      lines.push(got.length ? `相手が受け取った内容: ${got.join('・')}` : '相手はまだレポートを受け取っていません。');
    }
    if (this.bkMode) lines.push('BK（ブレークイン）でやり取りしています。相手コールも自局コールも付けず、要点だけを打って BK で締めます。数往復に 1 回は識別を入れ、通常の型に戻すときは K で締めます。');
    if (exp.text) lines.push(`次に送る例: ${exp.text}`, exp.why);
    if (info.tip) lines.push(`コツ: ${info.tip}`);
    const q = String(question || '').trim();
    if (q) {
      if (/取れ|聞き取|わからな|分からな|聞こえ/.test(q)) {
        lines.push('取れなかったときは、その部分だけ聞き直せます: 「相手コール DE 自局 PSE AGN? K」。名前だけなら「NAME AGN?」、レポートだけなら「RST AGN?」。');
      } else if (/速|はや|QRS/i.test(q)) {
        lines.push('速すぎるときは「QRS PSE QRS」を送ります。相手は速度を落として繰り返します。');
      } else if (/終わ|やめ|締め|73/.test(q)) {
        lines.push(`いつでも締めに入れます: 「${this.dxCall || '？？？'} DE ${this.me.callsign} TNX FER QSO 73 <SK>」。相手も締めに合わせます。`);
      } else {
        lines.push('迷ったら、模範解答をそのまま打って構いません。相手はこちらの内容に合わせて返します。');
      }
    }
    return lines;
  }

  /** ログ帳へ渡す形。 */
  toLogFields() {
    return {
      call: this.dxCall,
      rstS: this.heard.rst || '599',
      rstR: this.dx?.rstGiven || '',
      name: this.dx?.name || '',
      qth: this.dx?.qth || '',
      notes: '模擬交信（自由に打つ）',
      source: 'mockqso',
      transcript: this.transcript.map((t) => ({ dir: t.dir, text: t.text })),
    };
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function clampWpm(w) {
  return Math.max(DX_WPM_RANGE.min, Math.min(DX_WPM_RANGE.max, Math.round(w)));
}
