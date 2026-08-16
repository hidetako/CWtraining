// CW 交信サポート
//
// デコーダーが起こした文字列から相手の情報（コール・RST・名前・QTH）を
// 拾い、交信のどの段階かを追って、次に送る文の候補を出す。
// 送った内容・受けた内容は交信記録として貯め、そのままログ帳へ渡せる。

const CALLSIGN_RE = /^[A-Z0-9]{1,3}[0-9][A-Z]{1,4}(?:\/\d)?$/;
const RST_RE = /^(?:[1-5][1-9NnAa][1-9NnAa]|5NN)$/;

/** 5NN → 599 のような略記をレポートの数字に直す。 */
const normalizeRst = (s) => s.toUpperCase().replaceAll('N', '9').replaceAll('A', '1');

export class SupportSession extends EventTarget {
  /**
   * @param {{ myCall: string, myName?: string, myQth?: string }} me
   */
  constructor(me = {}) {
    super();
    this.me = {
      call: (me.myCall || '').toUpperCase(),
      name: (me.myName || '').toUpperCase(),
      qth: (me.myQth || '').toUpperCase(),
    };
    this.reset();
  }

  reset() {
    this.fields = { dxCall: '', rstR: '', rstS: '', name: '', qth: '' };
    this.phase = 'listen';   // listen → heard-cq / called-me → exchange → closing
    this.transcript = [];
    this._recent = '';       // 解析用の受信ストリーム（直近の語をつないだもの）
    this._lastRxMs = 0;
    this._emit('update');
  }

  _now() {
    return new Date().toISOString().slice(11, 19);
  }

  /**
   * デコードされた受信文字列を流し込む。1 語ずつでも 1 文まとめてでもよい。
   * デコーダーは語単位でしか区切れないので、解析は直近の語をつないだ
   * ストリームに対して行う（DE の次の語、のような文脈が語をまたぐため）。
   */
  feedRx(text) {
    const t = String(text || '').toUpperCase().trim();
    if (!t) return;

    // 記録は読みやすいよう、続けて届いた受信は 1 行にまとめる
    const last = this.transcript.at(-1);
    const now = Date.now();
    if (last?.dir === 'rx' && now - this._lastRxMs < 10000) last.text += ` ${t}`;
    else this.transcript.push({ at: this._now(), dir: 'rx', text: t });
    this._lastRxMs = now;

    this._recent = `${this._recent} ${t}`.split(/\s+/).filter(Boolean).slice(-40).join(' ');
    this._parse(this._recent);
    this._emit('update');
  }

  /** 自分が送った内容。記録し、送った RST を拾う。 */
  noteTx(text) {
    const t = String(text || '').toUpperCase().trim();
    if (!t) return;
    this.transcript.push({ at: this._now(), dir: 'tx', text: t });
    const words = t.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      if (RST_RE.test(words[i]) && /UR|RST/.test(words.slice(0, i).join(' '))) {
        this.fields.rstS = normalizeRst(words[i]);
        break;
      }
    }
    if (/(^|\s)(73|<SK>)(\s|$)/.test(t)) this.phase = 'closing';
    this._emit('update');
  }

  _parse(t) {
    const words = t.split(/\s+/).filter(Boolean);

    // DE の直後がコールサイン。相手のコールはここから取るのが確実
    for (let i = 0; i < words.length; i++) {
      if (words[i] === 'DE' && words[i + 1] && CALLSIGN_RE.test(words[i + 1])
          && words[i + 1] !== this.me.call) {
        this.fields.dxCall = words[i + 1];
      }
    }
    // DE が取れていないときは、自分宛て（<自分> …）の前後から拾う
    if (!this.fields.dxCall) {
      const hit = words.find((w) => CALLSIGN_RE.test(w) && w !== this.me.call && w.length >= 4);
      if (hit && (t.includes(this.me.call) || /^CQ/.test(t))) this.fields.dxCall = hit;
    }

    // RST。UR や RST の後の 599 / 5NN が自分への レポート
    for (let i = 0; i < words.length; i++) {
      if (RST_RE.test(words[i]) && /(UR|RST)/.test(words.slice(Math.max(0, i - 3), i).join(' '))) {
        this.fields.rstR = normalizeRst(words[i]);
      }
    }

    // 名前・QTH・OP
    for (let i = 0; i < words.length - 1; i++) {
      if ((words[i] === 'NAME' || words[i] === 'OP') && /^[A-Z]{2,}$/.test(words[i + 1])
          && words[i + 1] !== 'HR' && words[i + 1] !== 'IS') {
        this.fields.name = words[i + 2] && words[i + 1] === 'HR' ? words[i + 2] : words[i + 1];
      }
      if (words[i] === 'QTH' && /^[A-Z]{3,}$/.test(words[i + 1]) && words[i + 1] !== 'IS') {
        this.fields.qth = words[i + 1];
      }
    }
    // NAME HR TARO の形
    const hr = t.match(/(?:NAME|OP)\s+(?:HR\s+|IS\s+)?([A-Z]{2,})/);
    if (hr && hr[1] !== 'HR') this.fields.name = hr[1];

    // 段階の更新
    if (words.includes('CQ')) this.phase = 'heard-cq';
    if (this.me.call && t.includes(`${this.me.call} DE`)) this.phase = 'called-me';
    if (this.me.call && t.includes(this.me.call) && this.fields.rstR) this.phase = 'exchange';
    if (/(^|\s)(73|<SK>|GB|CUAGN)(\s|$)/.test(t) && this.phase !== 'listen') this.phase = 'closing';
  }

  /**
   * 今の段階に合った返答の候補。先頭がいちばん自然な選択肢。
   * @returns {{ label: string, text: string }[]}
   */
  suggestions() {
    const me = this.me.call || 'MYCALL';
    const dx = this.fields.dxCall || '？？？';
    const name = this.me.name || 'OP';
    const qth = this.me.qth || 'QTH';
    const out = [];

    if (this.phase === 'heard-cq' && this.fields.dxCall) {
      out.push({ label: 'CQ に応答する', text: `${dx} DE ${me} ${me} K` });
    }
    if (this.phase === 'called-me' || this.phase === 'exchange') {
      out.push({
        label: 'レポートと自己紹介を送る',
        text: `${dx} DE ${me} = GM TNX FER CALL UR RST 599 599 = NAME ${name} ${name} QTH ${qth} ${qth} = HW? ${dx} DE ${me} K`,
      });
      out.push({ label: 'レポートだけ送る', text: `${dx} DE ${me} UR RST 599 599 BK` });
    }
    if (this.phase === 'exchange' || this.phase === 'closing') {
      out.push({
        label: '締めの挨拶（73）',
        text: `${dx} DE ${me} = R FB TNX QSO ES 73 GL ${dx} DE ${me} <SK> TU E E`,
      });
    }
    if (this.phase === 'listen') {
      out.push({ label: 'CQ を出す', text: `CQ CQ CQ DE ${me} ${me} ${me} K` });
    }
    out.push({ label: 'もう一度頼む', text: `${this.fields.dxCall ? dx + ' ' : ''}DE ${me} PSE AGN K` });
    return out;
  }

  /** ログ帳へ渡す形。周波数は画面の入力から受け取る。 */
  toLogFields(freq = '') {
    return {
      call: this.fields.dxCall,
      freq,
      rstS: this.fields.rstS || '599',
      rstR: this.fields.rstR,
      name: this.fields.name,
      qth: this.fields.qth,
      notes: '交信サポートで記録',
      source: 'support',
      transcript: [...this.transcript],
    };
  }

  _emit(type) {
    this.dispatchEvent(new CustomEvent(type));
  }
}

// ───────── 無線機のキーイング（Web Serial） ─────────

/**
 * シリアルポートの DTR / RTS を上げ下げして、キーイング回路ごしに
 * 無線機の電鍵端子を叩く。昔からある「COM ポートキーイング」と同じ方式。
 *
 * ブラウザの setTimeout で刻むので、数 ms のゆらぎは避けられない。
 * 20 WPM（短点 60ms）程度までが実用の目安。
 */
export class SerialKeyer {
  constructor() {
    this.port = null;
    this.line = 'dtr';   // dtr | rts
    this.sending = false;
  }

  static get supported() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  async connect() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 9600 });
    await this._set(false);
  }

  async close() {
    await this._set(false).catch(() => {});
    await this.port?.close().catch(() => {});
    this.port = null;
  }

  get connected() { return !!this.port; }

  async _set(on) {
    if (!this.port) return;
    await this.port.setSignals(this.line === 'rts'
      ? { requestToSend: on }
      : { dataTerminalReady: on });
  }

  /**
   * on/off の時系列（秒）でキーを叩く。ずれが積もらないよう、
   * 開始時刻からの絶対時刻に合わせて眠る。
   * @param {{ at: number, on: boolean }[]} timeline
   */
  async playTimeline(timeline) {
    if (!this.port || this.sending) return;
    this.sending = true;
    const t0 = performance.now();
    try {
      for (const step of timeline) {
        if (!this.sending) break;   // 中断
        const wait = t0 + step.at * 1000 - performance.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        await this._set(step.on);
      }
    } finally {
      await this._set(false).catch(() => {});
      this.sending = false;
    }
  }

  stop() { this.sending = false; }
}

/**
 * 文章を on/off の時系列にする。SerialKeyer.playTimeline に渡す形。
 * timing は morse.js の computeTiming() の戻り値。
 * @param {ReturnType<import('./morse.js').tokenize>} tokens
 * @param {{ dit: number, dah: number, elementGap: number, charGap: number, wordGap: number }} timing
 */
export function keyTimeline(tokens, timing) {
  const out = [];
  let t = 0;
  let prevWasSpace = true;
  for (const token of tokens) {
    if (token.type === 'space') { t += timing.wordGap; prevWasSpace = true; continue; }
    if (!prevWasSpace) t += timing.charGap;
    prevWasSpace = false;
    for (let i = 0; i < token.pattern.length; i++) {
      out.push({ at: t, on: true });
      t += token.pattern[i] === '.' ? timing.dit : timing.dah;
      out.push({ at: t, on: false });
      t += timing.elementGap;
    }
  }
  return out;
}
