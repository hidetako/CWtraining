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
    // バンド内が全体のかなりの割合を占めていることも要求する。
    // 合わせている周波数から離れたトーンや音声は、フィルタの裾から
    // わずかに漏れてくるが、それを「弱い信号」と取り違えないため
    const inBand = this.env > this.raw * (this.on ? 0.2 : 0.4);
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
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
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
