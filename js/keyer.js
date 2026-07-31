// エレクトロニックキーヤー
//
// パドルをマウスの左右クリックに変換して入力する環境を想定している。
// 左ボタン = 短点側、右ボタン = 長点側（設定で入れ替え可能）。
//
// 要素の音は AudioContext の時計に対して前もって予約し、状態遷移だけを
// setTimeout で駆動する。判定は要素の終わり LOOKAHEAD 秒前に行うので、
// setTimeout のばらつきが符号のリズムに乗らない。

import { codeUnits, decodePattern } from './morse.js';

const LOOKAHEAD = 0.008; // 秒。次要素を決める前倒し量

/** 送信速度の下限・上限（WPM）。画面のつまみと保存値の両方をこれで抑える。 */
export const KEYER_WPM_MIN = 5;
export const KEYER_WPM_MAX = 28;
export const clampKeyerWpm = (wpm) =>
  Math.max(KEYER_WPM_MIN, Math.min(KEYER_WPM_MAX, Number(wpm) || KEYER_WPM_MIN));

export const KEYER_MODES = {
  iambicB: { label: 'アイアンビック B（一般的）', help: '両方を離した後にもう 1 要素送出します。多くの市販キーヤーの既定値です。' },
  iambicA: { label: 'アイアンビック A', help: '両方を離した時点で、送出中の要素を最後に停止します。' },
  ultimatic: { label: 'ウルティマチック', help: '両押しでは後から押した側が優先され、その要素を連続送出します。' },
  straight: { label: '縦振り電鍵（左ボタンのみ）', help: '押した長さで短点・長点を判定します。パドルではなく縦振り用です。' },
};

export class ElectronicKeyer extends EventTarget {
  /**
   * @param {import('./audio.js').CWPlayer} player
   */
  constructor(player) {
    super();
    this.player = player;
    this.mode = 'iambicB';
    this.wpm = 20;
    this.weight = 50;   // % 35〜65。マーク／スペース比
    this.swap = false;  // true で左ボタンが長点になる

    this.ditDown = false;
    this.dahDown = false;
    this.ditMemory = false;
    this.dahMemory = false;
    this.lastElement = null;
    this.bPending = false;   // アイアンビック B の追加要素フラグ
    this.squeezed = false;   // 両方を同時に押した状態を経たか

    this.sending = false;
    this.clock = 0;
    this.timer = null;
    this.charTimer = null;
    this.wordTimer = null;

    this.buffer = '';   // 組み立て中の 1 文字分のパターン
    this.text = '';     // 解読済みの文字列

    this._straightStart = 0;
  }

  get dit() {
    return 1.2 / this.wpm;
  }

  setParams({ mode, wpm, weight, swap } = {}) {
    if (mode) this.mode = mode;
    if (wpm) this.wpm = clampKeyerWpm(wpm);
    if (weight != null) this.weight = Math.max(30, Math.min(70, weight));
    if (swap != null) this.swap = !!swap;
  }

  async start() {
    await this.player.openKeyLine();
    this.reset();
  }

  stop() {
    this._clearTimers();
    this.sending = false;
    this.ditDown = this.dahDown = false;
    this.ditMemory = this.dahMemory = false;
    this.player.flushKeyLine();
  }

  reset() {
    this.stop();
    this.buffer = '';
    this.text = '';
    this.lastElement = null;
    this.bPending = false;
    this.squeezed = false;
    this._emit('update');
  }

  _clearTimers() {
    clearTimeout(this.timer);
    clearTimeout(this.charTimer);
    clearTimeout(this.wordTimer);
    this.timer = this.charTimer = this.wordTimer = null;
  }

  // ───────── パドル入力 ─────────

  /** which は 'dit' か 'dah'。swap 設定はここで解決済みであること。 */
  paddleDown(which) {
    if (this.mode === 'straight') return this._straightDown();

    if (which === 'dit') {
      if (this.ditDown) return;
      this.ditDown = true;
      this.ditMemory = true;
    } else {
      if (this.dahDown) return;
      this.dahDown = true;
      this.dahMemory = true;
    }

    if (this.ditDown && this.dahDown) this.squeezed = true;
    if (this.mode === 'ultimatic') this._lastPressed = which;
    if (!this.sending) this._begin();
  }

  paddleUp(which) {
    if (this.mode === 'straight') return this._straightUp();

    if (which === 'dit') this.ditDown = false;
    else this.dahDown = false;
    if (this.ditDown || this.dahDown) return;

    // アイアンビック B: 両方を握った状態から離したときだけ、
    // 逆側の要素を 1 つ余分に送る。片側だけの操作では追加しない。
    if (this.mode === 'iambicB' && this.sending && this.squeezed) {
      this.bPending = true;
    }
    this.squeezed = false;
  }

  _straightDown() {
    this._straightStart = performance.now();
    this.player.keyOn();
    this._clearTimers();
  }

  _straightUp() {
    if (!this._straightStart) return;
    const heldMs = performance.now() - this._straightStart;
    this._straightStart = 0;
    this.player.keyOff();

    // 短点 1.8 個分より長く押していれば長点とみなす
    const element = heldMs > this.dit * 1800 ? '-' : '.';
    this.buffer += element;
    this._emit('element', { element });
    this._armDecodeTimers();
  }

  // ───────── 送出ループ ─────────

  _begin() {
    this.sending = true;
    const now = this.player.currentTime;
    this.clock = Math.max(now + 0.006, this.clock);
    this._clearTimers();
    this._step();
  }

  _decideNext() {
    if (this.mode === 'ultimatic') {
      if (this.ditDown && this.dahDown) return this._lastPressed === 'dah' ? '-' : '.';
      if (this.ditDown) return '.';
      if (this.dahDown) return '-';
      if (this.ditMemory) return '.';
      if (this.dahMemory) return '-';
      return null;
    }

    // アイアンビック: 直前と逆の要素を優先し、スクイーズで交互に出す
    if (this.lastElement === '.') {
      if (this.dahDown || this.dahMemory) return '-';
      if (this.ditDown) return '.';
    } else if (this.lastElement === '-') {
      if (this.ditDown || this.ditMemory) return '.';
      if (this.dahDown) return '-';
    } else {
      if (this.ditDown || this.ditMemory) return '.';
      if (this.dahDown || this.dahMemory) return '-';
    }

    if (this.bPending) {
      this.bPending = false;
      return this.lastElement === '.' ? '-' : '.';
    }
    return null;
  }

  _step() {
    const next = this._decideNext();

    if (!next) {
      this.sending = false;
      this.bPending = false;
      this._armDecodeTimers();
      return;
    }

    const w = this.weight / 50;             // 1.0 で標準
    const markUnit = this.dit * w;
    const spaceUnit = this.dit * (2 - w);   // 短点 1 個分の全長は常に 2 dit
    const tone = next === '.' ? markUnit : markUnit + 2 * this.dit;

    this.player.scheduleKey(this.clock, tone);

    if (next === '.') { this.ditMemory = false; } else { this.dahMemory = false; }
    this.lastElement = next;
    this.buffer += next;
    this._emit('element', { element: next });

    const elementEnd = this.clock + tone + spaceUnit;
    this.clock = elementEnd;

    const delayMs = (elementEnd - this.player.currentTime - LOOKAHEAD) * 1000;
    this.timer = setTimeout(() => this._step(), Math.max(0, delayMs));
  }

  // ───────── 解読 ─────────

  /**
   * 送出が止まったら、文字間・語間の長さを待って解読を確定する。
   * 実運用に合わせ、文字間は 3 短点・語間は 7 短点よりやや手前で切る。
   */
  _armDecodeTimers() {
    clearTimeout(this.charTimer);
    clearTimeout(this.wordTimer);
    if (!this.buffer && !this.text) return;

    this.charTimer = setTimeout(() => this._flushChar(), this.dit * 1000 * 2.4);
    this.wordTimer = setTimeout(() => this._flushWord(), this.dit * 1000 * 6);
  }

  _flushChar() {
    if (!this.buffer) return;
    const pattern = this.buffer;
    this.buffer = '';
    const ch = decodePattern(pattern);
    this.text += ch ?? '＊'; // 解読できない符号は ＊ で示す
    this._emit('char', { pattern, char: ch });
    this._emit('update');
  }

  _flushWord() {
    this._flushChar();
    if (this.text && !this.text.endsWith(' ')) {
      this.text += ' ';
      this._emit('update');
    }
  }

  /** 未確定の符号を強制的に確定させる。採点の直前に呼ぶ。 */
  flush() {
    this._flushChar();
    return this.text.trim();
  }

  _emit(name, detail = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

/**
 * マウス／キーボードの入力をキーヤーに接続する。
 * 返り値の detach() で解除できる。
 *
 * @param {ElectronicKeyer} keyer
 * @param {HTMLElement} pad  入力を受け付ける要素
 * @param {object} opts { global: 画面全体でパドル入力を拾うか,
 *                       mouse: false でマウス／タッチを取らずキーボードだけにする,
 *                       keyboard: false でキーボードを取らない, onState }
 */
export function attachPaddleInput(keyer, pad, opts = {}) {
  const target = opts.global ? document : pad;
  const state = { left: false, right: false };

  const notify = () => opts.onState?.({ ...state });

  // マウスのボタン番号を短点／長点に割り当てる
  const sideOf = (button) => {
    if (button === 0) return keyer.swap ? 'dah' : 'dit';
    if (button === 2) return keyer.swap ? 'dit' : 'dah';
    if (button === 1) return 'dah'; // 中ボタンも長点として扱う
    return null;
  };

  const onDown = (e) => {
    const side = sideOf(e.button);
    if (!side) return;
    // 全画面モードでも、操作ボタンやフォームの上では通常のクリックを優先する
    if (opts.global && e.target.closest('button, input, select, textarea, a, label')) return;
    e.preventDefault();
    if (e.button === 0) state.left = true; else if (e.button === 2) state.right = true;
    notify();
    keyer.paddleDown(side);
  };

  const onUp = (e) => {
    const side = sideOf(e.button);
    if (!side) return;
    if (e.button === 0) state.left = false; else if (e.button === 2) state.right = false;
    notify();
    keyer.paddleUp(side);
  };

  // 右ボタンを押した時点でコンテキストメニューが出ないようにする
  const onContextMenu = (e) => { e.preventDefault(); };

  // キーボードでも練習できるようにしておく（Z / X、または ← / →）
  const keyOf = (code) => {
    if (code === 'KeyZ' || code === 'ArrowLeft') return keyer.swap ? 'dah' : 'dit';
    if (code === 'KeyX' || code === 'ArrowRight') return keyer.swap ? 'dit' : 'dah';
    return null;
  };

  const onKeyDown = (e) => {
    if (e.repeat) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const side = keyOf(e.code);
    if (!side) return;
    e.preventDefault();
    if (side === 'dit') state.left = true; else state.right = true;
    notify();
    keyer.paddleDown(side);
  };

  const onKeyUp = (e) => {
    const side = keyOf(e.code);
    if (!side) return;
    if (side === 'dit') state.left = false; else state.right = false;
    notify();
    keyer.paddleUp(side);
  };

  // タッチ操作用に、パッドを左右半分に割って短点／長点に対応させる
  const onTouchStart = (e) => {
    e.preventDefault();
    const rect = pad.getBoundingClientRect();
    for (const touch of e.changedTouches) {
      const side = (touch.clientX - rect.left) < rect.width / 2 ? 'dit' : 'dah';
      const mapped = keyer.swap ? (side === 'dit' ? 'dah' : 'dit') : side;
      if (side === 'dit') state.left = true; else state.right = true;
      notify();
      keyer.paddleDown(mapped);
    }
  };

  const onTouchEnd = (e) => {
    e.preventDefault();
    const rect = pad.getBoundingClientRect();
    for (const touch of e.changedTouches) {
      const side = (touch.clientX - rect.left) < rect.width / 2 ? 'dit' : 'dah';
      const mapped = keyer.swap ? (side === 'dit' ? 'dah' : 'dit') : side;
      if (side === 'dit') state.left = false; else state.right = false;
      notify();
      keyer.paddleUp(mapped);
    }
  };

  // 打面を持たず、キーボードだけ受け付けたいときは opts.mouse === false を渡す
  if (opts.mouse !== false) {
    target.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);      // パッド外で離しても取りこぼさない
    target.addEventListener('contextmenu', onContextMenu);
    pad.addEventListener('touchstart', onTouchStart, { passive: false });
    pad.addEventListener('touchend', onTouchEnd, { passive: false });
    pad.addEventListener('touchcancel', onTouchEnd, { passive: false });
  }
  // 常時表示ウィジェットなど、複数箇所から接続するときに
  // キーボードの二重発火を避けられるよう、opts.keyboard === false で無効化できる
  if (opts.keyboard !== false) {
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
  }

  return function detach() {
    if (opts.mouse !== false) {
      target.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      target.removeEventListener('contextmenu', onContextMenu);
      pad.removeEventListener('touchstart', onTouchStart);
      pad.removeEventListener('touchend', onTouchEnd);
      pad.removeEventListener('touchcancel', onTouchEnd);
    }
    if (opts.keyboard !== false) {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    }
  };
}

/**
 * 打った文字列と手本を比べる。文字単位で照合し、余分／欠落も見えるようにする。
 */
export function compareSending(target, sent) {
  // 文字の見た目ではなく、符号そのもので突き合わせる。
  // 表記が違っても符号が同じものは打てば区別が付かないので、
  // 同じものとして数えなければならない（= と <BT> はどちらも －・・・－）
  const a = codeUnits(target);
  const b = codeUnits(sent);

  // 空白は照合に使わない。打鍵の解読では手が一瞬止まっただけで語間が入るため、
  // 空白まで採点すると符号そのものの正誤が見えなくなる。
  // さらに悪いことに、空白どうしが一致すると対応付けがそこに引っ張られ、
  // 同じ語が繰り返される手本（JA1ABC JA1ABC …）では、打った 1 文字が
  // 離れた繰り返しの側に対応づけられて、読めない差分になっていた。
  const at = [];                        // { ch, key, at: 手本の中での位置 }
  a.forEach((u, k) => { if (!u.space) at.push({ ch: u.text, key: u.key, at: k }); });
  const bt = b.filter((u) => !u.space);

  const dp = Array.from({ length: at.length + 1 }, () => new Uint32Array(bt.length + 1));
  for (let i = at.length - 1; i >= 0; i--) {
    for (let j = bt.length - 1; j >= 0; j--) {
      dp[i][j] = at[i].key === bt[j].key
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  let correct = 0;

  while (i < at.length && j < bt.length) {
    if (at[i].key === bt[j].key) {
      // 一致した文字は手本側の表記で見せる。打った側が <BT>、手本が = のように
      // 表記だけ違う場合に、手本と並べて読めるようにするため
      ops.push({ type: 'ok', char: at[i].ch, pos: at[i].at });
      correct += 1;
      i += 1; j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'missing', char: at[i].ch, pos: at[i].at });
      i += 1;
    } else {
      ops.push({ type: 'extra', char: bt[j].text });
      j += 1;
    }
  }
  while (i < at.length) { ops.push({ type: 'missing', char: at[i].ch, pos: at[i].at }); i += 1; }
  while (j < bt.length) { ops.push({ type: 'extra', char: bt[j].text }); j += 1; }

  // 表示は手本の語の切れ目が分かるほうが読みやすいので、
  // 採点には使わない空白を type:'space' として差し戻す
  const marks = [];
  let cursor = 0;
  const fillSpaces = (upto) => {
    while (cursor < upto) {
      if (a[cursor]?.space) marks.push({ type: 'space', char: ' ' });
      cursor += 1;
    }
  };
  for (const op of ops) {
    if (op.pos != null) { fillSpaces(op.pos); cursor = op.pos + 1; }
    marks.push({ type: op.type, char: op.char });
  }
  fillSpaces(a.length);

  // 余分に打った分も分母に入れる。そうしないと、手本の文字さえ含まれていれば
  // どれだけ余計に打っても 100% になってしまう
  const extra = ops.filter((m) => m.type === 'extra').length;
  const total = at.length;
  const denominator = total + extra;
  return {
    marks,
    correct,
    extra,
    total,
    accuracy: denominator ? correct / denominator : 0,
  };
}
