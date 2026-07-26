// コンテスト運用シミュレーター
//
// Morse Runner（VE3NEA）の構成に倣った実装。
//   Station.pas  → DxStation（送信するメッセージの種類と組み立て）
//   DxOper.pas   → DxOperator（相手オペレーターの状態機械と忍耐度、LID 動作）
//   Contest.pas  → ContestRunner（局の生成とイベント配信）
//   Log.pas      → contestlog.js
//
// 相手局は「コールサインを打つ機械」ではなく、こちらの送信を解釈して
// 状態を進めるオペレーターとして動く。取り違えれば訂正を求め、
// 待たされ続ければ諦めて去る。

import { makeCallsign, pick, pickInt } from './data.js';
import { ContestLog, QSO_ERROR, normalizeNumber } from './contestlog.js';

/** 運用モード。Morse Runner の TRunMode に対応する。 */
export const RUN_MODES = {
  pileup: {
    label: 'パイルアップ',
    help: 'CQ を出すと複数局が同時に呼んできます。取る力を鍛える基本モードです。',
  },
  single: {
    label: 'シングルコール',
    help: '1 交信につき 1 局だけが呼んできます。入力操作に慣れるためのモードです。',
  },
  wpx: {
    label: 'WPX コンテスト',
    help: 'バンドコンディションと時間を固定した競技形式。プリフィックスがマルチになります。',
  },
  hst: {
    label: 'HST 競技',
    help: 'IARU 高速電信競技の形式。混信や妨害は無く、純粋な速度と正確さを競います。',
  },
};

/** 交換内容の形式。 */
export const EXCHANGE_TYPES = {
  serial: { label: 'RST + シリアル番号', help: '一般的なコンテスト。599 + 通し番号を交換します。' },
  jarl: { label: 'RST + 都府県支庁ナンバー', help: 'JARL 系コンテスト。599 + 地域番号を交換します。' },
};

/** 相手オペレーターの状態。DxOper.pas の TOperatorState。 */
export const OP_STATE = {
  NEED_PREV_END: 'osNeedPrevEnd', // 前の交信が終わるのを待っている
  NEED_QSO: 'osNeedQso',          // 呼びたい
  NEED_NR: 'osNeedNr',            // こちらのナンバー待ち
  NEED_CALL: 'osNeedCall',        // 自分のコールを確認してほしい
  NEED_CALL_NR: 'osNeedCallNr',   // コールもナンバーも欲しい
  NEED_END: 'osNeedEnd',          // TU 待ち
  DONE: 'osDone',
  FAILED: 'osFailed',
};

/** 相手局が送るメッセージ。Station.pas の TStationMessage。 */
export const MSG = {
  CQ: 'msgCQ',
  MY_CALL: 'msgMyCall',
  DE_MY_CALL: 'msgDeMyCall',
  DE_MY_CALL_NR: 'msgDeMyCallNr',
  NR: 'msgNR',
  R_NR: 'msgR_NR',
  NR_QM: 'msgNrQm',
  QM: 'msgQm',
  B4: 'msgB4',
  TU: 'msgTU',
  GARBAGE: 'msgGarbage',
  NIL: 'msgNil',
};

const FULL_PATIENCE = 5;

const JARL_NUMBERS = [
  '01H', '02H', '03H', '04H', '05H', '06H', '07H', '08H', '09H', '10H',
  '11H', '12H', '13H', '14H', '15H', '16H', '17H', '18H', '19H', '20H',
  '100', '101', '102', '103', '104', '105', '106', '107', '108', '109',
];

// ═══════════════════════════════════════════ 相手局

class DxStation {
  constructor(opts) {
    const { myWpm, conditions, exchange, lidsEnabled, hst } = opts;

    this.callsign = opts.callsign || makeCallsign();
    this.nr = opts.nr ?? pickInt(1, 999);
    this.jarlNumber = pick(JARL_NUMBERS);
    this.exchangeType = exchange;

    // 局ごとに音程・速度・強さを散らし、耳で分離できるようにする
    this.offset = hst ? 0 : pickInt(-450, 450);
    this.wpm = Math.max(12, myWpm + (hst ? 0 : pickInt(-5, 8)));
    this.amplitude = hst ? 1 : 0.35 + Math.random() * 0.65;
    this.qsb = conditions.qsb && !hst ? Math.random() * 0.8 : 0;
    this.flutter = conditions.flutter && !hst && Math.random() < 0.2 ? 0.6 : 0;

    // 技量。低いほど反応が遅く、こちらの符号を取りこぼしやすい
    this.skills = pickInt(1, 3);
    this.patience = FULL_PATIENCE;
    this.repeatCount = !hst && Math.random() < 0.1 ? 2 : 1;

    this.state = OP_STATE.NEED_QSO;
    this.busyUntil = 0;
    this.voice = null;
    this.sentRst = '599';

    this.lid = lidsEnabled && !hst && Math.random() < 0.18;
    this.quirks = this.lid ? this._makeQuirks() : {};
  }

  /**
   * LID（下手なオペレーター）の癖。Morse Runner の Lids 設定に対応する。
   * ひとつの局が全部の癖を持つことはない。
   */
  _makeQuirks() {
    const all = [
      'wrongRst',      // 明らかにおかしい RST を送ってくる
      'callsDuringQso', // 他局の交信中に割り込んで呼ぶ
      'garbage',       // 符号を打ち間違える
      'rejectsCorrect', // 正しく取ったのに訂正を求めてくる
      'acceptsWrong',  // 取り違えたまま話を進めてしまう
      'tailEnds',      // こちらが打ち終わる前にかぶせてくる
      'repeatsExcessively', // 何度も同じことを繰り返す
    ];
    const quirks = {};
    const count = pickInt(1, 2);
    for (let i = 0; i < count; i++) quirks[pick(all)] = true;
    return quirks;
  }

  get exchangeValue() {
    return this.exchangeType === 'jarl' ? this.jarlNumber : String(this.nr).padStart(3, '0');
  }

  get rstValue() {
    // LID は 599 以外のありえないレポートを送ってくることがある
    if (this.quirks.wrongRst) return pick(['339', '229', '119', '449']);
    return '599';
  }

  /** メッセージ種別を実際の送信文に変換する。 */
  render(msg, myCall) {
    const call = this.callsign;
    const nr = this.exchangeValue;
    const rst = this.sentRst;

    let text;
    switch (msg) {
      case MSG.CQ:            text = `CQ TEST DE ${call} ${call} TEST`; break;
      case MSG.MY_CALL:       text = this.repeatCount > 1 ? `${call} ${call}` : call; break;
      case MSG.DE_MY_CALL:    text = `DE ${call}`; break;
      case MSG.DE_MY_CALL_NR: text = `DE ${call} ${call} ${rst} ${nr}`; break;
      case MSG.NR:            text = `${rst} ${nr}`; break;
      case MSG.R_NR:          text = `R ${rst} ${nr}`; break;
      case MSG.NR_QM:         text = 'NR?'; break;
      case MSG.QM:            text = '?'; break;
      case MSG.B4:            text = `${myCall} QSO B4`; break;
      case MSG.TU:            text = 'TU'; break;
      case MSG.NIL:           text = 'NIL'; break;
      case MSG.GARBAGE:       text = this._garbage(); break;
      default:                text = '';
    }

    // 符号を打ち間違える癖
    if (this.quirks.garbage && msg !== MSG.GARBAGE && Math.random() < 0.25) {
      text = corrupt(text);
    }
    return text;
  }

  _garbage() {
    const len = pickInt(2, 5);
    let s = '';
    for (let i = 0; i < len; i++) s += pick('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''));
    return s;
  }

  stop() {
    this.voice?.stop();
    this.voice = null;
  }
}

/** 文字をいくつか入れ替えて、打ち間違いを作る。 */
function corrupt(text) {
  const chars = text.split('');
  const i = Math.floor(Math.random() * chars.length);
  if (/[A-Z0-9]/.test(chars[i])) {
    chars[i] = pick('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''));
  }
  return chars.join('');
}

// ═══════════════════════════════════════════ 運用本体

export class ContestRunner extends EventTarget {
  constructor(player) {
    super();
    this.player = player;
    this.log = new ContestLog();
    this.reset();
  }

  reset() {
    this.running = false;
    this.stations = [];
    this.qrmStations = [];
    this.current = null;
    this.serial = 1;
    this.startedAt = 0;
    this.stoppedAt = 0;
    this.endsAt = 0;
    this.txBusyUntil = 0;
    this.lastTxEndedAt = 0;
    this.log.clear();
    clearInterval(this._tick);
    this._tick = null;
    this._myVoice = null;
  }

  get elapsed() {
    if (!this.startedAt) return 0;
    const until = this.running ? Date.now() : (this.stoppedAt || this.startedAt);
    return Math.max(0, (until - this.startedAt) / 1000);
  }

  get remaining() {
    return this.running ? Math.max(0, (this.endsAt - Date.now()) / 1000) : 0;
  }

  get score() {
    const s = this.log.score({ useMultiplier: this.opts?.mode === 'wpx' });
    return {
      ...s,
      rate: this.log.rate(this.running ? Date.now() : this.stoppedAt, this.startedAt),
      callers: this.stations.filter((st) => st.state !== OP_STATE.FAILED).length,
    };
  }

  /**
   * @param {object} opts
   *   { mode, minutes, activity, exchange, myCall, myNumber, myWpm,
   *     conditions: { qrn, qrm, qsb, flutter, lids } }
   */
  start(opts) {
    this.reset();

    const mode = RUN_MODES[opts.mode] ? opts.mode : 'pileup';
    const hst = mode === 'hst';
    const wpx = mode === 'wpx';

    this.opts = {
      mode,
      // 競技モードは条件を固定する
      minutes: wpx ? 30 : hst ? 10 : (opts.minutes ?? 5),
      activity: wpx ? 3 : (opts.activity ?? 3),
      exchange: opts.exchange ?? 'serial',
      myCall: (opts.myCall || 'JA1ABC').toUpperCase(),
      myNumber: (opts.myNumber || '13H').toUpperCase(),
      myWpm: opts.myWpm ?? 25,
      conditions: hst
        ? { qrn: 0, qrm: 0, qsb: 0, flutter: false, lids: false }
        : wpx
          ? { qrn: 0.4, qrm: 0.4, qsb: 0.4, flutter: true, lids: true }
          : (opts.conditions ?? {}),
    };

    this.running = true;
    this.startedAt = Date.now();
    this.endsAt = this.startedAt + this.opts.minutes * 60000;

    if (this.opts.conditions.qrm) this._spawnQrmStations();

    this._tick = setInterval(() => this._update(), 110);
    this._emit('state');
  }

  stopSession() {
    if (!this.running) return;
    this.stoppedAt = Date.now();
    this.running = false;
    clearInterval(this._tick);
    this._tick = null;

    this.stations.forEach((s) => s.stop());
    this.qrmStations.forEach((s) => s.stop());
    this.stations = [];
    this.qrmStations = [];
    this.current = null;
    this._myVoice?.stop();
    this.player.releaseRx();

    this._emit('end', { score: this.score, log: this.log });
    this._emit('state');
  }

  // ───────── 進行 ─────────

  _update() {
    if (!this.running) return;
    if (Date.now() >= this.endsAt) { this.stopSession(); return; }

    const now = this.player.currentTime;

    // 交信中の局に割り込んでくる LID
    for (const st of this.stations) {
      if (st.state === OP_STATE.FAILED || st.voice) continue;
      if (st.quirks.callsDuringQso && this.current && st !== this.current
          && now >= st.busyUntil && Math.random() < 0.02) {
        this._transmit(st, st.render(MSG.MY_CALL, this.opts.myCall));
      }
    }

    // 応答が無いまま待たされた局は諦めて去る
    for (const st of this.stations) {
      if (st.state === OP_STATE.FAILED && !st.voice) {
        this.stations = this.stations.filter((s) => s !== st);
      }
    }

    this._updateQrm(now);
    this._emit('tick');
  }

  /** 別の周波数で延々と CQ を出している局（本物の QRM）。 */
  _spawnQrmStations() {
    const count = pickInt(1, 2);
    for (let i = 0; i < count; i++) {
      const st = new DxStation({
        myWpm: this.opts.myWpm,
        conditions: this.opts.conditions,
        exchange: this.opts.exchange,
        lidsEnabled: false,
        hst: false,
      });
      st.offset = pick([-1, 1]) * pickInt(120, 600);
      st.amplitude = 0.15 + Math.random() * 0.3;
      st.nextAt = 0;
      this.qrmStations.push(st);
    }
  }

  _updateQrm(now) {
    for (const st of this.qrmStations) {
      if (st.voice && now < st.voice.endsAt) continue;
      if (!st.nextAt) st.nextAt = now + Math.random() * 5;
      if (now >= st.nextAt) {
        this._transmit(st, st.render(MSG.CQ, this.opts.myCall), { ignoreTx: true });
        st.nextAt = now + 4 + Math.random() * 8;
      }
    }
  }

  /** 相手局に 1 送信させる。 */
  _transmit(station, text, { ignoreTx = false, gap = 0.25 } = {}) {
    if (!text) return;
    const base = ignoreTx ? this.player.currentTime : Math.max(this.player.currentTime, this.txBusyUntil);
    const startAt = base + gap + Math.random() * 0.35;

    this.player.voice(text, {
      bus: 'rx',
      // RIT を回すと、ずれている局ほど音程が動く
      freq: this.player.settings.freq + station.offset - this.player.settings.rit,
      charWpm: station.wpm,
      level: station.amplitude,
      fading: station.qsb,
      flutter: station.flutter,
      startAt,
    }).then((voice) => {
      station.voice = voice;
      station.busyUntil = voice.endsAt;
    });

    this._emit('rx', { station, text });
  }

  /** 自局の送信。終わったタイミングで各局にイベントを配る。 */
  async _send(text) {
    if (!text) return null;
    this._myVoice?.stop();

    const voice = await this.player.voice(text, {
      bus: 'tx',
      charWpm: this.opts.myWpm,
      effWpm: this.opts.myWpm,
      level: 1,
      freq: this.player.settings.keyerFreq ?? this.player.settings.freq,
    });

    this._myVoice = voice;
    this.txBusyUntil = voice.endsAt;
    this.player.duckRx(voice.startsAt, voice.endsAt);

    this._emit('tx', { text });
    return voice;
  }

  // ───────── オペレーターの操作 ─────────

  /** F1: CQ。呼んでくる局を生成する。 */
  async cq() {
    if (!this.running) return;
    this.stations.forEach((s) => s.stop());
    this.stations = [];
    this.current = null;

    await this._send(`CQ TEST DE ${this.opts.myCall} ${this.opts.myCall} TEST`);
    this._spawnCallers();
    this._emit('state');
  }

  _spawnCallers() {
    const { mode, activity } = this.opts;
    // Morse Runner と同じくポアソン分布で呼び出し局数を決める
    const count = mode === 'single' || mode === 'hst'
      ? 1
      : Math.max(1, rndPoisson(activity / 2) || 1);

    for (let i = 0; i < count; i++) {
      const st = new DxStation({
        myWpm: this.opts.myWpm,
        conditions: this.opts.conditions,
        exchange: this.opts.exchange,
        lidsEnabled: !!this.opts.conditions.lids,
        hst: mode === 'hst',
      });
      st.state = OP_STATE.NEED_QSO;
      this.stations.push(st);
      this._transmit(st, st.render(MSG.MY_CALL, this.opts.myCall));
    }
  }

  /**
   * F2 相当: 打ち込んだコールサインに向けてナンバーを送る。
   * ここで相手オペレーターの状態が進む。
   */
  async exchange(typedCall) {
    if (!this.running) return;
    const call = String(typedCall || '').toUpperCase().trim();
    if (!call) return;

    const myNr = this.opts.exchange === 'jarl'
      ? this.opts.myNumber
      : String(this.serial).padStart(3, '0');

    await this._send(`${call} 5NN ${myNr}`);
    this._dispatchHisCall(call);
  }

  /** こちらがコールサインを打ったときの、各局の反応。 */
  _dispatchHisCall(call) {
    const live = this.stations.filter((s) => s.state !== OP_STATE.FAILED);
    if (!live.length) { this._emit('state'); return; }

    let answered = null;

    for (const st of live) {
      const match = matchCall(call, st.callsign);

      if (match === 'yes') {
        // LID はまれに、正しく取られたのに訂正を求めてくる
        if (st.quirks.rejectsCorrect && Math.random() < 0.25) {
          st.state = OP_STATE.NEED_CALL;
          answered = st;
          this._transmit(st, st.render(MSG.DE_MY_CALL_NR, this.opts.myCall));
          continue;
        }
        st.state = OP_STATE.NEED_END;
        st.sentRst = st.rstValue;
        answered = st;
        this._transmit(st, st.render(MSG.R_NR, this.opts.myCall));
      } else if (match === 'almost') {
        // 惜しいが違う。自分のコールを打ち直して訂正を促す
        st.state = OP_STATE.NEED_CALL;
        st.sentRst = st.rstValue;
        answered = st;
        this._transmit(st, st.render(MSG.DE_MY_CALL_NR, this.opts.myCall));
      } else if (st.quirks.acceptsWrong && Math.random() < 0.06) {
        // 自分宛でないのに応答してしまう LID
        st.state = OP_STATE.NEED_END;
        st.sentRst = st.rstValue;
        answered = st;
        this._transmit(st, st.render(MSG.R_NR, this.opts.myCall));
      } else {
        // 自分宛ではないので黙って待つ。待たされ続ければ諦める
        st.patience -= 1;
        if (st.patience < 1) st.state = OP_STATE.FAILED;
      }
    }

    this.current = answered;
    this._emit('state');
  }

  /** F3 相当: TU を送って交信を確定し、ログに記録する。 */
  async confirm(typedCall, typedNr) {
    if (!this.running) return null;
    const call = String(typedCall || '').toUpperCase().trim();
    if (!call) return null;

    await this._send(`TU ${this.opts.myCall}`);

    // 打ち込んだコールに合致する局を探す。いなければ NIL になる
    const target = this.stations.find((s) => s.callsign === call)
      || (this.current && this.current.callsign === call ? this.current : null);

    const entry = this.log.add({
      call,
      rst: '599',
      nr: typedNr,
      trueCall: target?.callsign ?? '',
      trueRst: target ? target.sentRst : null,
      trueNr: target ? target.exchangeValue : null,
    });

    this.serial += 1;

    if (target) {
      target.state = OP_STATE.DONE;
      target.stop();
      this.stations = this.stations.filter((s) => s !== target);
    }
    this.current = null;

    this._emit('qso', entry);
    this._emit('state');
    return entry;
  }

  /** 運用中に自局の送信速度を増減する（PgUp / PgDn 相当）。 */
  adjustWpm(delta) {
    if (!this.opts) return null;
    this.opts.myWpm = Math.max(10, Math.min(45, this.opts.myWpm + delta));
    this._emit('state');
    return this.opts.myWpm;
  }

  /** F4: 自局コールサイン。 */
  async myCall() {
    if (this.running) await this._send(this.opts.myCall);
  }

  /** F5: 相手コールサイン。 */
  async hisCall(typedCall) {
    if (!this.running || !typedCall) return;
    const call = String(typedCall).toUpperCase().trim();
    await this._send(call);
    this._dispatchHisCall(call);
  }

  /** F6: QSO B4（重複交信の指摘）。 */
  async b4(typedCall) {
    if (!this.running) return;
    const call = String(typedCall || '').toUpperCase().trim();
    await this._send(`${call} QSO B4`);

    // 指摘された局は引き下がり、他の局が呼び直す
    const target = this.stations.find((s) => s.callsign === call);
    if (target) {
      target.state = OP_STATE.FAILED;
      target.stop();
    }
    this.stations
      .filter((s) => s !== target && s.state !== OP_STATE.FAILED)
      .forEach((s) => this._transmit(s, s.render(MSG.MY_CALL, this.opts.myCall)));
    this._emit('state');
  }

  /** F7: 「?」。呼んでいた局がもう一度名乗る。 */
  async question() {
    if (!this.running) return;
    await this._send('?');
    this._repeatAll();
  }

  /** F8: NR?。交信中の局がナンバーを打ち直す。 */
  async again() {
    if (!this.running) return;
    await this._send('NR?');

    if (this.current) {
      this.current.sentRst = this.current.rstValue;
      this._transmit(this.current, this.current.render(MSG.NR, this.opts.myCall));
    } else {
      this._repeatAll();
    }
    this._emit('state');
  }

  _repeatAll() {
    const live = this.stations.filter((s) => s.state !== OP_STATE.FAILED);
    for (const st of live) {
      st.patience -= 1;
      if (st.patience < 1) { st.state = OP_STATE.FAILED; continue; }

      // 何度も繰り返す癖のある局はしつこく名乗る
      const msg = st.quirks.repeatsExcessively ? MSG.DE_MY_CALL_NR : MSG.MY_CALL;
      this._transmit(st, st.render(msg, this.opts.myCall));
    }
    this._emit('state');
  }

  /** 呼んでいる局のコールサインを部分一致で補完する（スペースキー相当）。 */
  autoComplete(partial) {
    const p = String(partial || '').toUpperCase().trim();
    if (p.length < 2) return null;
    const hits = this.stations
      .filter((s) => s.state !== OP_STATE.FAILED && s.callsign.includes(p));
    return hits.length === 1 ? hits[0].callsign : null;
  }

  _emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

// ═══════════════════════════════════════════ 補助

/**
 * 打ち込んだコールサインと実際のコールサインを 3 段階で照合する。
 * Morse Runner の IsMyCall（mcYes / mcAlmost / mcNo）に対応する。
 */
export function matchCall(typed, actual) {
  const a = String(typed || '').toUpperCase().trim();
  const b = String(actual || '').toUpperCase().trim();
  if (!a || !b) return 'no';
  if (a === b) return 'yes';

  // 部分的に取れている（頭または尻が一致し、3 文字以上）
  if (a.length >= 3 && (b.startsWith(a) || b.endsWith(a) || b.includes(a))) return 'almost';

  // 1〜2 文字違い
  const d = levenshtein(a, b);
  if (d <= 2 && Math.abs(a.length - b.length) <= 2) return 'almost';

  return 'no';
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 平均 mean のポアソン分布に従う乱数。呼び出し局数の決定に使う。 */
export function rndPoisson(mean) {
  if (mean <= 0) return 0;
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= Math.random();
  } while (p > limit && k < 50);
  return k - 1;
}

export { QSO_ERROR, normalizeNumber };
