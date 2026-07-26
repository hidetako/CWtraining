// Web Audio API によるモールス音の生成
// 信号系統: osc -> keyGain -> qsbGain -> master -> 出力
//           noise -> bandpass -> noiseGain -> master   （QRN 空電）
//           qrmOsc -> qrmKeyGain -> qrmGain -> master  （QRM 混信）

import { tokenize, computeTiming } from './morse.js';

const RAMP_MAX = 0.005; // キークリック防止のための立上り/立下り時間（秒）

export class CWPlayer {
  constructor() {
    this.ctx = null;
    this.settings = {
      charWpm: 20,   // 各文字を打つ速度
      effWpm: 15,    // 実効速度（ファーンズワース）
      freq: 700,     // 受信側音の周波数 Hz
      keyerFreq: 700, // 打鍵（送信）側音の周波数 Hz
      volume: 0.5,
      qrn: 0,        // 空電ノイズ 0..1
      qsb: 0,        // フェージング 0..1
      qrm: 0,        // 混信 0..1
      bandwidth: 500, // 受信帯域幅 Hz
      rit: 0,        // RIT 同調ずれ Hz
      qsk: true,     // セミブレークイン（送信中も受信音を聞く）
      wave: 'sine',  // 側音の波形 sine | triangle | square
      ramp: 0.005,   // キーイングの立ち上がり時間 秒
    };
    this._playId = 0;
    this._timers = [];
    this._active = null;
  }

  /** AudioContext を用意する。ユーザー操作のハンドラ内から呼ぶこと。 */
  async resume() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error('このブラウザは Web Audio API に対応していません');
      this.ctx = new Ctor();
      this._buildGraph();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.settings.volume;
    this.master.connect(ctx.destination);

    // フェージング（QSB）: 低周波発振器で振幅を揺らす
    this.qsbGain = ctx.createGain();
    this.qsbGain.gain.value = 1;
    this.qsbGain.connect(this.master);

    this.qsbDepth = ctx.createGain();
    this.qsbDepth.gain.value = 0;
    this.qsbLfo = ctx.createOscillator();
    this.qsbLfo.type = 'sine';
    this.qsbLfo.frequency.value = 0.13;
    this.qsbLfo.connect(this.qsbDepth);
    this.qsbDepth.connect(this.qsbGain.gain);
    this.qsbLfo.start();

    // ── 受信系 ──
    // 受信音（相手局・空電）は受信帯域フィルタを通す。自局の側音は通さない。
    // これにより、帯域を絞ると帯域外の局が減衰し、RIT で各局の音程が動く。
    this.rxGain = ctx.createGain();   // QSK オフのとき送信中にここを絞る
    this.rxGain.gain.value = 1;
    this.rxGain.connect(this.master);

    // 単段では肩が緩いので、バンドパスを 2 段重ねて CW フィルタらしい切れにする
    this.rxFilters = [ctx.createBiquadFilter(), ctx.createBiquadFilter()];
    this.rxFilters.forEach((f) => { f.type = 'bandpass'; });
    this.rxFilters[0].connect(this.rxFilters[1]);
    this.rxFilters[1].connect(this.rxGain);

    this.rxBus = ctx.createGain();
    this.rxBus.gain.value = 1;
    this.rxBus.connect(this.rxFilters[0]);

    // 自局側音のバス。受信フィルタも RIT も影響しない
    this.txBus = ctx.createGain();
    this.txBus.gain.value = 1;
    this.txBus.connect(this.master);

    // 空電（QRN）: ホワイトノイズも受信フィルタを通す
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noiseGain.connect(this.rxBus);

    this.noiseSource = ctx.createBufferSource();
    this.noiseSource.buffer = this._makeNoiseBuffer();
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.noiseGain);
    this.noiseSource.start();

    // 混信（QRM）: 側音から少しずれた周波数の別信号
    this.qrmGain = ctx.createGain();
    this.qrmGain.gain.value = 0;
    this.qrmGain.connect(this.master);

    this._applySettings();
  }

  _makeNoiseBuffer() {
    const ctx = this.ctx;
    const length = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setSettings(patch) {
    Object.assign(this.settings, patch);
    if (this.ctx) this._applySettings();
  }

  _applySettings() {
    const s = this.settings;
    const now = this.ctx.currentTime;

    this.master.gain.setTargetAtTime(s.volume, now, 0.02);
    this.noiseGain.gain.setTargetAtTime(s.qrn * 0.5, now, 0.05);
    this.qrmGain.gain.setTargetAtTime(s.qrm * 0.22, now, 0.05);

    // バンドパスの Q は 中心周波数 / 帯域幅。帯域を絞るほど Q が上がる
    const bw = Math.max(50, s.bandwidth);
    const q = Math.max(0.3, s.freq / bw);
    this.rxFilters.forEach((f) => {
      f.frequency.setTargetAtTime(s.freq, now, 0.02);
      f.Q.setTargetAtTime(q, now, 0.02);
    });

    // 打鍵側音のラインが開いていれば、高さの変更を即時反映する
    if (this._keyLine) {
      this._keyLine.osc.frequency.setTargetAtTime(s.keyerFreq, now, 0.02);
    }

    // 深さ d のとき振幅は (1 - 2d)〜1 の範囲で揺れる
    const depth = s.qsb * 0.45;
    this.qsbGain.gain.setTargetAtTime(1 - depth, now, 0.05);
    this.qsbDepth.gain.setTargetAtTime(depth, now, 0.05);
  }

  /**
   * text をモールス音で再生する。
   * opts.onToken(token, index) は各文字の送出開始時に呼ばれる。
   * 再生完了時に解決する Promise を返す（stop() された場合は false で解決）。
   */
  async play(text, opts = {}) {
    await this.resume();
    this.stop();

    const id = ++this._playId;
    const ctx = this.ctx;
    const tokens = tokenize(text);
    if (!tokens.length) return true;

    const charWpm = opts.charWpm ?? this.settings.charWpm;
    const effWpm = opts.effWpm ?? this.settings.effWpm;
    const timing = computeTiming(charWpm, effWpm);

    const osc = ctx.createOscillator();
    osc.type = this.settings.wave;
    osc.frequency.value = opts.freq ?? this.settings.freq;

    const keyGain = ctx.createGain();
    keyGain.gain.value = 0;
    osc.connect(keyGain);
    keyGain.connect(this.qsbGain);

    const start = ctx.currentTime + 0.12;
    let t = start;
    let prevWasSpace = true;

    tokens.forEach((token, index) => {
      if (token.type === 'space') {
        t += timing.wordGap;
        prevWasSpace = true;
        return;
      }
      if (!prevWasSpace) t += timing.charGap;

      if (opts.onToken) {
        this._schedule(id, (t - ctx.currentTime) * 1000, () => opts.onToken(token, index));
      }

      for (let i = 0; i < token.pattern.length; i++) {
        const len = token.pattern[i] === '-' ? timing.dah : timing.dit;
        this._keyDown(keyGain, t, t + len, timing.dit);
        t += len;
        if (i < token.pattern.length - 1) t += timing.elementGap;
      }
      prevWasSpace = false;
    });

    const end = t;
    osc.start(start - 0.05);
    osc.stop(end + 0.15);
    this._active = { id, osc, keyGain, qrm: null };

    if (this.settings.qrm > 0) this._active.qrm = this._startQrm(start, end, charWpm);

    return new Promise((resolve) => {
      this._schedule(id, (end - ctx.currentTime) * 1000 + 120, () => {
        if (this._playId === id) this._active = null;
        resolve(true);
      });
      this._onCancel = () => resolve(false);
    });
  }

  /** 指定区間だけ側音を鳴らす。両端にランプを付けてクリック音を防ぐ。 */
  _keyDown(gainNode, on, off, dit) {
    const ramp = Math.min(this.settings.ramp ?? RAMP_MAX, dit * 0.3);
    // 矩形波・三角波は同振幅だと耳に大きく届くため、聴感をそろえる
    const peak = this.settings.wave === 'square' ? 0.55
      : this.settings.wave === 'triangle' ? 0.85 : 1;
    const g = gainNode.gain;
    g.setValueAtTime(0, on);
    g.linearRampToValueAtTime(peak, on + ramp);
    g.setValueAtTime(peak, Math.max(on + ramp, off - ramp));
    g.linearRampToValueAtTime(0, off);
  }

  /** 妨害信号として、ずれた周波数でランダムな文字を流し続ける。 */
  _startQrm(start, end, charWpm) {
    const ctx = this.ctx;
    const offset = 180 + Math.random() * 400;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = this.settings.freq + offset;

    const keyGain = ctx.createGain();
    keyGain.gain.value = 0;
    osc.connect(keyGain);
    keyGain.connect(this.qrmGain);

    const timing = computeTiming(charWpm * (0.8 + Math.random() * 0.6), charWpm);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    let t = start;
    let guard = 0;
    while (t < end && guard++ < 2000) {
      const ch = alphabet[Math.floor(Math.random() * alphabet.length)];
      const [token] = tokenize(ch);
      if (!token) continue;
      for (let i = 0; i < token.pattern.length; i++) {
        const len = token.pattern[i] === '-' ? timing.dah : timing.dit;
        this._keyDown(keyGain, t, t + len, timing.dit);
        t += len;
        if (i < token.pattern.length - 1) t += timing.elementGap;
      }
      // ときどき長めに間を空けて、断続的な混信らしくする
      t += Math.random() < 0.2 ? timing.wordGap * 2 : timing.charGap;
    }

    osc.start(start - 0.05);
    osc.stop(end + 0.15);
    return { osc, keyGain };
  }

  _schedule(id, delayMs, fn) {
    const timer = setTimeout(() => {
      if (this._playId === id) fn();
    }, Math.max(0, delayMs));
    this._timers.push(timer);
  }

  /** 再生中の音とコールバックをすべて止める。 */
  stop() {
    this._playId += 1;
    this._timers.forEach(clearTimeout);
    this._timers = [];

    if (this._active) {
      const now = this.ctx.currentTime;
      for (const node of [this._active, this._active.qrm]) {
        if (!node) continue;
        try {
          node.keyGain.gain.cancelScheduledValues(now);
          node.keyGain.gain.setTargetAtTime(0, now, 0.005);
          node.osc.stop(now + 0.05);
        } catch {
          // 既に停止済みのノードは無視する
        }
      }
      this._active = null;
    }

    if (this._onCancel) {
      const cancel = this._onCancel;
      this._onCancel = null;
      cancel();
    }
  }

  get isPlaying() {
    return this._active !== null;
  }

  // ───────── 独立ボイス（パイルアップ用） ─────────
  // play() は 1 本しか鳴らせないが、コンテストでは複数局が同時に呼んでくる。
  // voice() は他と干渉しない発振器を 1 本立てて予約だけを行い、
  // 個別に停止できるハンドルを返す。

  async voice(text, opts = {}) {
    await this.resume();
    const ctx = this.ctx;
    const tokens = tokenize(text);
    if (!tokens.length) return { stop() {}, duration: 0, endsAt: ctx.currentTime };

    const charWpm = opts.charWpm ?? this.settings.charWpm;
    const effWpm = Math.min(opts.effWpm ?? charWpm, charWpm);
    const timing = computeTiming(charWpm, effWpm);
    const freq = opts.freq ?? this.settings.freq;

    const osc = ctx.createOscillator();
    osc.type = this.settings.wave;
    osc.frequency.value = freq;

    const keyGain = ctx.createGain();
    keyGain.gain.value = 0;

    const levelGain = ctx.createGain();
    levelGain.gain.value = opts.level ?? 1;

    osc.connect(keyGain);
    keyGain.connect(levelGain);
    // 相手局は受信フィルタ経由、自局の側音は素通し
    levelGain.connect(opts.bus === 'tx' ? this.txBus : this.rxBus);

    // フラッター（極域伝搬などのざらついた信号）
    if (opts.flutter) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 40 + Math.random() * 40;
      const depth = ctx.createGain();
      depth.gain.value = opts.flutter * 0.45;
      lfo.connect(depth);
      depth.connect(levelGain.gain);
      lfo.start();
    }

    // 局ごとに独立したフェージングを持たせる
    if (opts.fading) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.08 + Math.random() * 0.25;
      const depth = ctx.createGain();
      depth.gain.value = (opts.level ?? 1) * opts.fading * 0.5;
      lfo.connect(depth);
      depth.connect(levelGain.gain);
      lfo.start();
    }

    const start = Math.max(ctx.currentTime + 0.05, opts.startAt ?? 0);
    let t = start;
    let prevWasSpace = true;

    for (const token of tokens) {
      if (token.type === 'space') {
        t += timing.wordGap;
        prevWasSpace = true;
        continue;
      }
      if (!prevWasSpace) t += timing.charGap;
      for (let i = 0; i < token.pattern.length; i++) {
        const len = token.pattern[i] === '-' ? timing.dah : timing.dit;
        this._keyDown(keyGain, t, t + len, timing.dit);
        t += len;
        if (i < token.pattern.length - 1) t += timing.elementGap;
      }
      prevWasSpace = false;
    }

    osc.start(start - 0.03);
    osc.stop(t + 0.12);

    let stopped = false;
    return {
      startsAt: start,
      endsAt: t,
      duration: t - start,
      stop: () => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        try {
          keyGain.gain.cancelScheduledValues(now);
          keyGain.gain.setTargetAtTime(0, now, 0.005);
          osc.stop(now + 0.05);
        } catch {
          // 既に停止済み
        }
      },
    };
  }

  /**
   * QSK オフのとき、自局の送信中は受信音を絞る（フルブレークインではない状態）。
   * QSK オンならそのまま聞こえ続ける。
   */
  duckRx(fromTime, untilTime) {
    if (!this.rxGain || this.settings.qsk) return;
    const g = this.rxGain.gain;
    g.cancelScheduledValues(fromTime);
    g.setValueAtTime(1, Math.max(this.ctx.currentTime, fromTime - 0.01));
    g.linearRampToValueAtTime(0.06, fromTime);
    g.setValueAtTime(0.06, untilTime);
    g.linearRampToValueAtTime(1, untilTime + 0.03);
  }

  /** 受信音の減衰を解除する（運用終了時など）。 */
  releaseRx() {
    if (!this.rxGain) return;
    const now = this.ctx.currentTime;
    this.rxGain.gain.cancelScheduledValues(now);
    this.rxGain.gain.setTargetAtTime(1, now, 0.02);
  }

  // ───────── 運用の録音 ─────────

  /** 出力をそのまま録音し始める。停止時に Blob を返す。 */
  async startRecording() {
    await this.resume();
    if (this._recorder) return false;

    const dest = this.ctx.createMediaStreamDestination();
    this.master.connect(dest);

    // 対応する形式を選ぶ。多くのブラウザでは WebM/Opus になる
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mimeType = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
    if (!window.MediaRecorder || !mimeType) {
      this.master.disconnect(dest);
      return false;
    }

    const chunks = [];
    const recorder = new MediaRecorder(dest.stream, { mimeType });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.start();
    this._recorder = { recorder, chunks, dest, mimeType };
    return true;
  }

  /** 録音を止めて Blob を返す。録音していなければ null。 */
  stopRecording() {
    const rec = this._recorder;
    if (!rec) return Promise.resolve(null);
    this._recorder = null;

    return new Promise((resolve) => {
      rec.recorder.onstop = () => {
        try { this.master.disconnect(rec.dest); } catch { /* 既に切断済み */ }
        resolve(new Blob(rec.chunks, { type: rec.mimeType }));
      };
      rec.recorder.stop();
    });
  }

  get isRecording() {
    return !!this._recorder;
  }

  // ───────── キーヤー用の常時接続ライン ─────────
  // エレクトロニックキーヤーは要素ごとに発振器を作ると時間がずれるため、
  // 鳴りっぱなしの発振器にゲインの包絡線だけを予約していく。

  async openKeyLine() {
    await this.resume();
    if (this._keyLine) {
      this._keyLine.osc.frequency.setValueAtTime(this.settings.keyerFreq, this.ctx.currentTime);
      return this._keyLine;
    }
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = this.settings.wave;
    osc.frequency.value = this.settings.keyerFreq;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(this.qsbGain);
    osc.start();
    this._keyLine = { osc, gain };
    return this._keyLine;
  }

  /** AudioContext の時刻 when から duration 秒だけ側音を鳴らす予約を入れる。 */
  scheduleKey(when, duration) {
    if (!this._keyLine) return;
    const dit = 1.2 / this.settings.charWpm;
    this._keyDown(this._keyLine.gain, when, when + duration, dit);
  }

  closeKeyLine() {
    if (!this._keyLine) return;
    const { osc, gain } = this._keyLine;
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0, now, 0.005);
    osc.stop(now + 0.1);
    this._keyLine = null;
  }

  /** 予約済みのキーヤー音を取り消す（ゲイン 0 に戻す）。 */
  flushKeyLine() {
    if (!this._keyLine) return;
    const now = this.ctx.currentTime;
    this._keyLine.gain.gain.cancelScheduledValues(now);
    this._keyLine.gain.gain.setTargetAtTime(0, now, 0.004);
  }

  get currentTime() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** 縦振り電鍵の練習用: 押している間だけ側音を鳴らす。 */
  async keyOn() {
    await this.resume();
    if (this._manual) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = this.settings.wave;
    osc.frequency.value = this.settings.keyerFreq;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(this.qsbGain);
    osc.start();
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.005);
    this._manual = { osc, gain };
  }

  keyOff() {
    if (!this._manual) return;
    const { osc, gain } = this._manual;
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.005);
    osc.stop(now + 0.05);
    this._manual = null;
  }
}
