// CW 音声デコーダー
//
// 無線機の受信音（マイクやライン入力）からモールスを文字に起こす。
//
// 流れ: 入力 → バンドパス（トーン周波数に合わせる）→ AudioWorklet で
// 包絡線を取り、適応しきい値で「鳴っている / 止まっている」の切り替わり
// （エッジ）だけをメインスレッドへ送る → エッジの間隔から短点・長点・
// 文字間・語間を分類して文字にする。
//
// 判定はすべて相手の速度に追従する。短点の長さ（dit）を受信しながら
// 推定し、しきい値はそこから決める。速度を先に教えてもらう必要はない。

import { decodePattern } from './morse.js';

// Worklet は別ファイルにすると配信の手間が増えるので、文字列で持って
// Blob URL から読み込む。中身は包絡線の追跡だけで、判断はメイン側。
const WORKLET_SOURCE = `
class CwDetector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.env = 0;        // バンド内の包絡線（平滑した音量）
    this.raw = 0;        // フィルタ前の包絡線
    this.peak = 1e-4;    // ゆっくり下がるピーク
    this.floor = 1e-4;   // ゆっくり上がる床（雑音レベル）
    this.on = false;
    this.blocks = 0;
  }
  rms(ch) {
    if (!ch) return 0;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    return Math.sqrt(sum / ch.length);
  }
  process(inputs) {
    const band = this.rms(inputs[0] && inputs[0][0]);
    const raw = this.rms(inputs[1] && inputs[1][0]);

    // 立ち上がりは速く、立ち下がりは少し遅く追う。チャタリングを抑える
    this.env = band > this.env ? this.env * 0.4 + band * 0.6 : this.env * 0.75 + band * 0.25;
    this.raw = raw > this.raw ? this.raw * 0.4 + raw * 0.6 : this.raw * 0.75 + raw * 0.25;

    // ピークは 1 ブロック(約 3ms)ごとにわずかに減衰、床はわずかに上昇。
    // 数秒で信号の強さの変化に追いつく
    this.peak = Math.max(this.env, this.peak * 0.9995);
    this.floor = Math.min(this.env + 1e-7, this.floor * 1.001 + 1e-8);

    // しきい値はピークと床の間。鳴っている間は低め（ヒステリシス）
    const th = this.floor + (this.peak - this.floor) * (this.on ? 0.3 : 0.5);
    // バンド内が全体の一定割合を占めていることも要求する。
    // 合わせている周波数から離れたトーンや音声は、フィルタの裾から
    // わずかに漏れてくるが、それを「弱い信号」と取り違えないため。
    //
    // 割合は 1/10（-20 dB）。以前は 0.4 だったが、それだと別のトーンで
    // 3 倍強い局がいるだけで、こちらの局が「帯域外の漏れ」と見なされて
    // 相手のキーイングで刻まれた。複数の局を聞き分けるには、他局の
    // ぶんだけ全体が大きくなっても自局を通す必要がある。
    // 1/10 でも、フィルタが 30 dB 落とす 200 Hz 以上離れたトーンだけの
    // 音は 0.03 程度にしかならず、拾わない。
    const inBand = this.env > this.raw * (this.on ? 0.05 : 0.1);
    const nowOn = this.peak > this.floor * 5 && this.env > th && inBand;
    if (nowOn !== this.on) {
      this.on = nowOn;
      this.port.postMessage({ type: 'edge', on: nowOn, t: currentTime });
    }
    this.blocks += 1;
    if (this.blocks % 16 === 0) {
      this.port.postMessage({ type: 'level', env: this.env, peak: this.peak, on: this.on });
    }
    return true;
  }
}
registerProcessor('cw-detector', CwDetector);
`;

/**
 * Worklet の登録は AudioContext ごとに 1 回でよい。
 * 局ごとにデコーダーを並べると init() が何度も呼ばれるので、同じ
 * コンテキストでは最初の読み込みを使い回す。
 */
const workletLoaded = new WeakMap();
function loadWorklet(ctx) {
  let p = workletLoaded.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
    p = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    workletLoaded.set(ctx, p);
  }
  return p;
}

export class CWDecoder extends EventTarget {
  /** @param {AudioContext} ctx */
  constructor(ctx) {
    super();
    this.ctx = ctx;
    this.input = ctx.createGain();          // ここへ受信音をつなぐ
    this.analyser = ctx.createAnalyser();   // トーンの自動合わせ用
    this.analyser.fftSize = 4096;
    this.input.connect(this.analyser);

    // バンドパス 2 段。トーン以外（音声・雑音）を落とす
    this.bp1 = ctx.createBiquadFilter();
    this.bp2 = ctx.createBiquadFilter();
    for (const f of [this.bp1, this.bp2]) { f.type = 'bandpass'; f.Q.value = 10; }
    this.input.connect(this.bp1);
    this.bp1.connect(this.bp2);

    this.setPitch(700);

    this.node = null;
    this.mic = null;
    this._micSource = null;

    // 分類の状態
    this.dit = 0.06;          // 推定した短点長（秒）。20 WPM 相当から始める
    this._marks = [];         // 直近の鳴っていた長さ。dit の推定に使う
    this._lastEdge = 0;
    this._on = false;
    this.buffer = '';         // 組み立て中のパターン
    this._charTimer = null;
    this._sawAnything = false;
  }

  async init() {
    await loadWorklet(this.ctx);
    this.node = new AudioWorkletNode(this.ctx, 'cw-detector', {
      numberOfInputs: 2, numberOfOutputs: 0,
    });
    this.bp2.connect(this.node, 0, 0);         // 入力 0: バンド内
    this.input.connect(this.node, 0, 1);       // 入力 1: フィルタ前（比較用）
    this.node.port.onmessage = (e) => {
      if (e.data.type === 'edge') this._edge(e.data.on, e.data.t);
      else if (e.data.type === 'level') {
        this._emit('level', e.data);
      }
    };
  }

  /** マイク（ライン入力）を開いてつなぐ。 */
  async attachMic(deviceId) {
    // 音声向けの加工はモールスには邪魔でしかない。全部切る
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      },
    });
    this._micSource = this.ctx.createMediaStreamSource(this.mic);
    this._micSource.connect(this.input);
  }

  detachMic() {
    this._micSource?.disconnect();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this._micSource = null;
  }

  setPitch(hz) {
    this.pitch = hz;
    this.bp1.frequency.value = hz;
    this.bp2.frequency.value = hz;
  }

  /** 今いちばん強い音の周波数を返す（トーンの自動合わせ）。 */
  strongestPitch(lo = 300, hi = 1200) {
    const bins = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(bins);
    const hzPerBin = this.ctx.sampleRate / this.analyser.fftSize;
    let best = -1;
    let bestDb = -Infinity;
    for (let i = Math.floor(lo / hzPerBin); i <= Math.ceil(hi / hzPerBin); i++) {
      if (bins[i] > bestDb) { bestDb = bins[i]; best = i; }
    }
    return best > 0 ? Math.round(best * hzPerBin) : 0;
  }

  reset() {
    clearTimeout(this._charTimer);
    this.buffer = '';
    this._marks = [];
    this._on = false;
    this._sawAnything = false;
  }

  /** 音の経路を外して止める。局を減らしたときに使う。 */
  dispose() {
    this.reset();
    this.detachMic();
    this.input.disconnect();
    this.bp1.disconnect();
    this.bp2.disconnect();
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
  }

  get wpm() { return Math.round(1.2 / this.dit); }

  // ───────── 分類 ─────────

  _edge(on, t) {
    const dur = t - this._lastEdge;
    this._lastEdge = t;
    clearTimeout(this._charTimer);

    if (on) {
      // 無音が終わった。無音の長さで文字・語の切れ目を判定
      if (this._sawAnything && dur > this.dit * 2.2) {
        this._flushChar();
        if (dur > this.dit * 5.5) this._emit('word');
      }
    } else if (this._sawAnything || dur < 2) {
      // 鳴り終わった。長さで短点か長点か
      this._classifyMark(dur);
    }
    this._on = on;
    this._sawAnything = true;

    if (!on) {
      // 手が止まったら、語間相当を待って文字を確定させる。
      // エッジはもう来ないかもしれないので、時計で締める
      this._charTimer = setTimeout(() => {
        this._flushChar();
        this._emit('word');
      }, Math.max(200, this.dit * 6 * 1000));
    }
  }

  _classifyMark(dur) {
    if (dur < this.dit * 0.25 || dur > 2.5) return;   // ノイズと長すぎる音は捨てる
    this._marks.push(dur);
    if (this._marks.length > 12) this._marks.shift();

    // 短点の推定: 直近の鳴りの最小値へ寄せる。長点しか来ていない間は
    // その 1/3 を仮の短点とみなす（長点 = 短点 3 個分）
    const min = Math.min(...this._marks);
    const estimate = Math.min(min, Math.max(...this._marks) / 3 + 0.001);
    this.dit = this.dit * 0.6 + Math.max(0.015, estimate) * 0.4;

    this.buffer += dur > this.dit * 1.9 ? '-' : '.';
    this._emit('element');
  }

  _flushChar() {
    if (!this.buffer) return;
    const char = decodePattern(this.buffer) ?? '＊';
    this.buffer = '';
    this._emit('char', { char, wpm: this.wpm });
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

/**
 * 複数の局を、トーンの違いで聞き分ける。
 *
 * パイルアップでは、呼んでくる局が少しずつ違う音程で重なる。ひとつの
 * デコーダーはひとつのトーンにしか合わせられないので、聞こえている
 * トーンの数だけデコーダーを並べ、同じ受信音を全部に入れる。
 * 各デコーダーは自分のトーンだけを通し、速度も自分の相手に追従する。
 *
 * 分けられるのは音程が離れている局だけで、限界は測ってある:
 *   200 Hz 以上離れていれば、相手が 20 dB 強くても取れる
 *   100 Hz なら 10 dB まで。50 Hz は同じ強さのときだけ
 * 同じ音程で重なった局（ゼロビート）は原理的に分けられない。
 *
 * scan() を続けて呼ぶと、鳴っている音のピークを覚えておいて（キーイング
 * の切れ目で消えないよう、最大値を保持しつつゆっくり下げる）、
 * 局らしいピークを強い順に返す。setPitches() でそこにデコーダーを置く。
 */
export class CWDecoderBank extends EventTarget {
  /**
   * @param {AudioContext} ctx
   * @param {{ max?: number, minGap?: number }} opts
   *   max    並べる局の最大数
   *   minGap 別の局と見なす最小の音程差（Hz）。フィルタの幅より広くする
   */
  constructor(ctx, { max = 3, minGap = 80 } = {}) {
    super();
    this.ctx = ctx;
    this.max = max;
    this.minGap = minGap;
    this.input = ctx.createGain();          // ここへ受信音をつなぐ
    this.analyser = ctx.createAnalyser();   // 局を探す用
    this.analyser.fftSize = 4096;
    // アナライザーの平滑化は使わない。あれは「呼び出しごと」に前回と
    // 混ぜるので、しばらく読まずにいると、とっくに鳴り終わった局が
    // 次に読んだときに -6 dB で現れる。時間の平滑化は scan() の
    // 最大値保持がやる
    this.analyser.smoothingTimeConstant = 0;
    this.input.connect(this.analyser);

    /** @type {Array<{ id: number, pitch: number, decoder: CWDecoder }>} */
    this.channels = [];
    this._nextId = 1;
    this._held = null;      // 最大値保持したスペクトル（dB）
    this.mic = null;
    this._micSource = null;
  }

  /** マイク（ライン入力）を開いてつなぐ。 */
  async attachMic(deviceId) {
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      },
    });
    this._micSource = this.ctx.createMediaStreamSource(this.mic);
    this._micSource.connect(this.input);
  }

  detachMic() {
    this._micSource?.disconnect();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this._micSource = null;
  }

  channel(id) {
    return this.channels.find((c) => c.id === id) ?? null;
  }

  /**
   * スペクトルを 1 回見て、局らしいピークを強い順に返す。
   * 何度も呼ぶほど、キーイングの切れ目に隠れていた局も拾える。
   * @returns {Array<{ hz: number, db: number }>}
   */
  scan(lo = 300, hi = 1200) {
    const bins = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(bins);
    if (!this._held) this._held = new Float32Array(bins.length).fill(-Infinity);
    const held = this._held;
    // 1 回の scan で 1 dB 下げる。100 ms おきなら 3 秒で 30 dB。
    // 語間や符号の切れ目（1 秒未満）で局が消えない程度に遅く、
    // 交信が終わった局が次の scan まで残らない程度に速く
    for (let i = 0; i < bins.length; i++) {
      held[i] = Math.max(bins[i], held[i] - 1);
    }

    const hzPerBin = this.ctx.sampleRate / this.analyser.fftSize;
    const from = Math.max(2, Math.floor(lo / hzPerBin));
    const to = Math.min(bins.length - 3, Math.ceil(hi / hzPerBin));

    // 床は範囲内の中央値。雑音の高さで、これより十分高いものだけを局とする
    const sorted = Array.from(held.subarray(from, to + 1)).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return [];
    const floor = sorted[Math.floor(sorted.length / 2)];

    // 近くのビンより高い（山の頂上）ところを候補にする
    const cands = [];
    for (let i = from; i <= to; i++) {
      const v = held[i];
      if (v < floor + 15) continue;
      if (v < held[i - 1] || v < held[i - 2] || v <= held[i + 1] || v <= held[i + 2]) continue;
      // 頂上の位置を隣のビンとの差から少し寄せる（ビン幅より細かく）
      const l = held[i - 1]; const r = held[i + 1];
      const denom = l - 2 * v + r;
      const shift = denom ? Math.max(-0.5, Math.min(0.5, 0.5 * (l - r) / denom)) : 0;
      cands.push({ hz: Math.round((i + shift) * hzPerBin), db: v });
    }
    cands.sort((a, b) => b.db - a.db);

    // 強い順に、既に取った局から minGap 以上離れているものだけを取る。
    // 最も強い局から 25 dB より弱い局は、いても分けられないので出さない
    const peaks = [];
    for (const c of cands) {
      if (peaks.length >= this.max) break;
      if (peaks.length && c.db < peaks[0].db - 25) break;
      if (peaks.every((p) => Math.abs(p.hz - c.hz) >= this.minGap)) peaks.push(c);
    }
    return peaks;
  }

  /** 覚えていたピークを忘れる。局を探し直すときに呼ぶ。 */
  forget() { this._held = null; }

  /**
   * 一定時間、繰り返し見て局を探す。
   * 1 回の snapshot は 85 ms ぶんしかなく、キーイングの切れ目に当たると
   * 局が見えないので、語間より長く見てから答える。
   */
  async scanFor(ms = 2000, interval = 100) {
    this.forget();
    let peaks = [];
    const n = Math.max(1, Math.round(ms / interval));
    for (let i = 0; i < n; i++) {
      await new Promise((r) => setTimeout(r, interval));
      peaks = this.scan();
    }
    return peaks;
  }

  /**
   * 指定した音程にデコーダーを並べる。
   * 近い音程に既にあるものは合わせ直して使い続け（速度の推定が残る）、
   * 無くなった音程のものは外す。
   * @param {number[]} pitches
   * @returns {Promise<Array<{ id, pitch, decoder }>>}
   */
  async setPitches(pitches) {
    const wanted = [...new Set(pitches.map((p) => Math.round(p)))].slice(0, this.max);
    const keep = new Set();
    const next = [];
    for (const hz of wanted) {
      let ch = this.channels.find((c) => !keep.has(c) && Math.abs(c.pitch - hz) < this.minGap / 2);
      if (ch) {
        ch.pitch = hz;
        ch.decoder.setPitch(hz);
      } else {
        ch = await this._open(hz);
      }
      keep.add(ch);
      next.push(ch);
    }
    for (const c of this.channels) if (!keep.has(c)) c.decoder.dispose();
    this.channels = next;
    this._emit('channels', { channels: this.channels.map((c) => ({ id: c.id, pitch: c.pitch })) });
    return this.channels;
  }

  /** 1 局ぶんの音程を変える（つまみを回したとき）。 */
  retune(id, hz) {
    const ch = this.channel(id);
    if (!ch) return;
    ch.pitch = Math.round(hz);
    ch.decoder.setPitch(ch.pitch);
    this._emit('channels', { channels: this.channels.map((c) => ({ id: c.id, pitch: c.pitch })) });
  }

  /**
   * 範囲内でいちばん強い音の周波数（1 局だけ合わせるとき用）。
   * 一瞬の snapshot では切れ目に当たるので、少しのあいだ見てから答える。
   */
  async strongestPitch(lo = 300, hi = 1200, ms = 600) {
    this.forget();
    let peaks = [];
    for (let i = 0; i < Math.max(1, Math.round(ms / 100)); i++) {
      await new Promise((r) => setTimeout(r, 100));
      peaks = this.scan(lo, hi);
    }
    return peaks[0]?.hz ?? 0;
  }

  reset() {
    for (const c of this.channels) c.decoder.reset();
  }

  async _open(hz) {
    const decoder = new CWDecoder(this.ctx);
    await decoder.init();
    decoder.setPitch(hz);
    this.input.connect(decoder.input);
    const ch = { id: this._nextId++, pitch: hz, decoder };
    // 局ごとの出来事に、どの局かを添えて外へ流す
    for (const type of ['char', 'word', 'element', 'level']) {
      decoder.addEventListener(type, (e) => {
        this._emit(type, { ...e.detail, id: ch.id, pitch: ch.pitch });
      });
    }
    return ch;
  }

  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
