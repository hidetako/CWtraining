// コンテスト運用シミュレーター（Morse Runner を参考にした構成）
//
// CQ を出すと複数局が同時に呼んでくる。各局は音程・速度・信号強度・
// 呼び出し始めのタイミングがばらばらなので、耳で分離して 1 局ずつ処理する。
// ファンクションキーの定型文で応答し、コールサインと交換内容を取れたら得点。

import { makeCallsign, pick, pickInt } from './data.js';

export const EXCHANGE_TYPES = {
  serial: { label: 'RST + シリアル番号', help: '一般的なコンテスト。599 + 通し番号を交換します。' },
  jarl: { label: 'RST + 都府県支庁ナンバー', help: 'JARL 系コンテスト。599 + 地域番号を交換します。' },
  wpx: { label: 'RST + シリアル（WPX）', help: 'プリフィックスがマルチになる形式です。' },
};

/** JARL コンテストの都府県支庁ナンバー（抜粋）。 */
const JARL_NUMBERS = [
  '01H', '02H', '03H', '04H', '05H', '06H', '07H', '08H', '09H', '10H',
  '11H', '12H', '13H', '14H', '15H', '16H', '17H', '18H', '19H', '20H',
  '100', '101', '102', '103', '104', '105', '106', '107', '108', '109',
];

/** 呼んでくる局 1 局分の状態。 */
class Caller {
  constructor(myWpm, conditions) {
    this.callsign = makeCallsign();
    this.serial = String(pickInt(1, 400)).padStart(3, '0');
    this.jarlNumber = pick(JARL_NUMBERS);
    this.rst = pick(['599', '599', '599', '579', '559', '5NN']);

    // 相手ごとに音程・速度・強さを散らして、耳で分離できるようにする
    this.offset = pickInt(-380, 380);
    this.wpm = Math.max(12, myWpm + pickInt(-6, 8));
    this.level = 0.35 + Math.random() * 0.65;
    this.fading = conditions.qsb ? Math.random() * conditions.qsb : 0;
    this.flutter = conditions.flutter && Math.random() < 0.25 ? 0.6 : 0;

    // 呼び始めのずれ。全員が同時だと現実味がない
    this.delay = Math.random() * 0.9;

    this.state = 'calling';  // calling → answering → confirming → done
    this.repeats = 0;
    this.voice = null;
  }

  exchangeFor(type) {
    if (type === 'jarl') return `${this.rst} ${this.jarlNumber}`;
    return `${this.rst} ${this.serial}`;
  }

  exchangeValue(type) {
    return type === 'jarl' ? this.jarlNumber : this.serial;
  }

  stop() {
    this.voice?.stop();
    this.voice = null;
  }
}

export class ContestRunner extends EventTarget {
  /**
   * @param {import('./audio.js').CWPlayer} player
   */
  constructor(player) {
    super();
    this.player = player;
    this.reset();
  }

  reset() {
    this.running = false;
    this.callers = [];
    this.current = null;      // 交信中の局
    this.serial = 1;          // 自局が送る通し番号
    this.log = [];            // { call, exchange, ok, reason }
    this.startedAt = 0;
    this.stoppedAt = 0;
    this.endsAt = 0;
    this.txBusyUntil = 0;     // 自局が送信中の間は相手は待つ
    this._tick = null;
    this._myVoice = null;
  }

  /** 運用開始からの経過秒。終了後も、終了時点までの長さを返す。 */
  get elapsed() {
    if (!this.startedAt) return 0;
    const until = this.running ? Date.now() : (this.stoppedAt || this.startedAt);
    return Math.max(0, (until - this.startedAt) / 1000);
  }

  get remaining() {
    return this.running ? Math.max(0, (this.endsAt - Date.now()) / 1000) : 0;
  }

  get score() {
    const valid = this.log.filter((q) => q.ok).length;
    // 開始直後は分母が小さすぎて毎時ペースが跳ね上がるため、1 分経つまでは出さない
    const rate = this.elapsed >= 60
      ? Math.round((valid / (this.elapsed / 3600)))
      : null;

    return {
      raw: this.log.length,
      valid,
      errors: this.log.length - valid,
      accuracy: this.log.length ? valid / this.log.length : 0,
      rate,
    };
  }

  /**
   * @param {object} opts
   *   { minutes, activity(1-9), exchange, myCall, myWpm, conditions:{qsb,flutter} }
   */
  start(opts) {
    this.reset();
    this.opts = {
      minutes: opts.minutes ?? 10,
      activity: opts.activity ?? 3,
      exchange: opts.exchange ?? 'serial',
      myCall: (opts.myCall || 'JA1ABC').toUpperCase(),
      myNumber: (opts.myNumber || '13H').toUpperCase(),
      myWpm: opts.myWpm ?? 22,
      conditions: opts.conditions ?? { qsb: 0, flutter: false },
    };

    this.running = true;
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + this.opts.minutes * 60000;

    this._tick = setInterval(() => this._update(), 120);
    this._emit('state');
  }

  stopSession() {
    if (!this.running) return;
    this.stoppedAt = Date.now();
    this.running = false;
    clearInterval(this._tick);
    this._tick = null;
    this._clearCallers();
    this._myVoice?.stop();
    this._emit('end', { score: this.score });
    this._emit('state');
  }

  _clearCallers() {
    this.callers.forEach((c) => c.stop());
    this.callers = [];
    this.current = null;
  }

  _update() {
    if (!this.running) return;
    if (Date.now() >= this.endsAt) {
      this.stopSession();
      return;
    }

    const now = this.player.currentTime;

    // 自局が送信中は相手は黙って待つ
    if (now < this.txBusyUntil) { this._emit('tick'); return; }

    for (const caller of this.callers) {
      if (caller.voice && now < caller.voice.endsAt) continue;

      if (caller.state === 'calling') {
        // 返事がなければ、間を置いてもう一度呼んでくる
        if (caller.nextCallAt == null) caller.nextCallAt = now + caller.delay;
        if (now >= caller.nextCallAt) {
          this._transmit(caller, caller.callsign);
          caller.repeats += 1;
          caller.nextCallAt = null;
          // 何度も無視された局は諦めて消える
          if (caller.repeats > 4) caller.state = 'gone';
        }
      } else if (caller.state === 'gone' && !caller.voice) {
        this.callers = this.callers.filter((c) => c !== caller);
      }
    }

    this._emit('tick');
  }

  /** 相手局に 1 送信させる。 */
  _transmit(caller, text, gapBefore = 0.25) {
    const startAt = Math.max(this.player.currentTime + gapBefore, this.txBusyUntil + gapBefore);
    this.player.voice(text, {
      freq: this.player.settings.freq + caller.offset,
      charWpm: caller.wpm,
      level: caller.level,
      fading: caller.fading,
      flutter: caller.flutter,
      startAt,
    }).then((voice) => { caller.voice = voice; });
    this._emit('rx', { caller, text });
  }

  /** 自局の送信。送信中は相手が黙るように txBusyUntil を進める。 */
  async _send(text) {
    this._myVoice?.stop();
    const voice = await this.player.voice(text, {
      charWpm: this.opts.myWpm,
      effWpm: this.opts.myWpm,
      level: 1,
      freq: this.player.settings.freq,
    });
    this._myVoice = voice;
    this.txBusyUntil = voice.endsAt;
    this._emit('tx', { text });
    return voice;
  }

  // ───────── オペレーターの操作（F キー相当） ─────────

  /** F1: CQ を出す。呼んでくる局を新たに生成する。 */
  async cq() {
    if (!this.running) return;
    this._clearCallers();
    await this._send(`CQ TEST DE ${this.opts.myCall} ${this.opts.myCall} TEST`);

    // アクティビティが高いほど多くの局が同時に呼んでくる
    const activity = this.opts.activity;
    const count = Math.max(1, Math.round((activity / 9) * 4 + Math.random() * 1.5));
    for (let i = 0; i < count; i++) {
      this.callers.push(new Caller(this.opts.myWpm, this.opts.conditions));
    }
    this._emit('state');
  }

  /** F2: 入力欄のコールサインに向けて交換内容を送る。 */
  async exchange(typedCall) {
    if (!this.running) return;
    const call = String(typedCall || '').toUpperCase().trim();
    if (!call) return;

    // 自局が送るナンバー。シリアル形式なら通し番号、JARL 形式なら固定の地域番号
    const myNumber = this.opts.exchange === 'jarl'
      ? this.opts.myNumber
      : String(this.serial).padStart(3, '0');

    await this._send(`${call} 5NN ${myNumber}`);

    // 呼んでいる局のうち、打ったコールに最も近い局が応答する
    const target = this._matchCaller(call);
    if (!target) {
      // 誰にも当たらなければ、呼んでいた局が痺れを切らして再度呼ぶ
      this.callers.forEach((c) => { c.state = 'calling'; c.nextCallAt = null; });
      this._emit('state');
      return;
    }

    this.current = target;
    this.callers.forEach((c) => { if (c !== target) c.state = 'waiting'; });

    if (target.callsign === call) {
      // 正しく取れていれば交換内容を返してくる
      target.state = 'confirming';
      this._transmit(target, `R ${target.exchangeFor(this.opts.exchange)}`);
    } else {
      // 取り違えていれば、自分のコールサインを打ち直してくる
      target.state = 'answering';
      this._transmit(target, `DE ${target.callsign} ${target.callsign} ${target.exchangeFor(this.opts.exchange)}`);
    }
    this._emit('state');
  }

  /** F3: TU を送って交信を確定し、ログに記録する。 */
  async confirm(typedCall, typedExchange) {
    if (!this.running) return null;
    const call = String(typedCall || '').toUpperCase().trim();
    const exchange = String(typedExchange || '').toUpperCase().trim();
    if (!call) return null;

    await this._send(`TU ${this.opts.myCall}`);

    const target = this.current || this._matchCaller(call);
    const expectedExchange = target ? target.exchangeValue(this.opts.exchange) : null;

    const callOk = !!target && target.callsign === call;
    const exchangeOk = !!expectedExchange
      && normalizeExchange(exchange) === normalizeExchange(expectedExchange);

    const entry = {
      call,
      exchange,
      ok: callOk && exchangeOk,
      truthCall: target?.callsign ?? null,
      truthExchange: expectedExchange,
      reason: !target ? '該当局なし' : !callOk ? 'コールサイン違い' : !exchangeOk ? 'ナンバー違い' : '',
      at: Date.now(),
    };

    this.log.unshift(entry);
    this.serial += 1;

    target?.stop();
    this.callers = this.callers.filter((c) => c !== target);
    this.current = null;

    this._emit('qso', entry);
    this._emit('state');
    return entry;
  }

  /** F4: 自局のコールサインだけを送る。 */
  async myCall() {
    if (this.running) await this._send(this.opts.myCall);
  }

  /** F5: 相手のコールサインだけを送る。 */
  async hisCall(typedCall) {
    if (this.running && typedCall) await this._send(String(typedCall).toUpperCase());
  }

  /** F7: 「?」を送る。呼んでいた局がもう一度呼んでくる。 */
  async question() {
    if (!this.running) return;
    await this._send('?');
    this.callers.forEach((c) => { c.state = 'calling'; c.nextCallAt = null; c.repeats = 0; });
    this._emit('state');
  }

  /** F8: AGN? を送る。交信中の局が交換内容を繰り返す。 */
  async again() {
    if (!this.running) return;
    await this._send('AGN?');
    if (this.current) {
      this._transmit(this.current, `${this.current.callsign} ${this.current.exchangeFor(this.opts.exchange)}`);
    } else {
      this.callers.forEach((c) => { c.state = 'calling'; c.nextCallAt = null; });
    }
    this._emit('state');
  }

  /**
   * 打ち込まれたコールサインに最も近い局を選ぶ。
   * 完全一致が最優先。次に部分一致（尻取り・頭 3 文字など）を見る。
   */
  _matchCaller(call) {
    const live = this.callers.filter((c) => c.state !== 'gone');
    if (!live.length) return null;

    const exact = live.find((c) => c.callsign === call);
    if (exact) return exact;

    // 部分文字列としてただ 1 局だけに当たるなら、その局が応答する
    const partial = live.filter((c) => c.callsign.includes(call) || call.includes(c.callsign));
    if (partial.length === 1) return partial[0];

    // それ以外は文字の一致数が最も多い局。半分も合っていなければ無反応
    let best = null;
    let bestScore = 0;
    for (const c of live) {
      const score = commonPrefixLen(c.callsign, call) + commonSuffixLen(c.callsign, call);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return bestScore >= Math.ceil(call.length / 2) ? best : null;
  }

  _emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

function normalizeExchange(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/^5NN/, '599')
    .replace(/N/g, '9')   // カットナンバー N = 9
    .replace(/T/g, '0')   // カットナンバー T = 0
    .replace(/^599/, '');  // RST 部分は採点対象から外す
}

function commonPrefixLen(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

function commonSuffixLen(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}
