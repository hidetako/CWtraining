// 設定と学習統計の永続化（localStorage）

import { clampKeyerWpm } from './keyer.js';
import { clampHint } from './contest.js';

const SETTINGS_KEY = 'cwtraining.settings.v1';

/** 受信速度（文字速度・実効速度）の上限（WPM）。画面のつまみと保存値の両方をこれで抑える。 */
export const RX_WPM_MAX = 30;
const STATS_KEY = 'cwtraining.stats.v1';

export const DEFAULT_SETTINGS = {
  // 自局プロフィール
  callsign: 'JA1ABC',
  name: 'TARO',
  qth: 'TOKYO',
  rig: 'IC-7300',
  pwr: '50W',
  ant: 'DP',
  wx: 'FINE',

  // 音声
  charWpm: 20,
  effWpm: 15,
  freq: 700,
  volume: 0.5,
  qrn: 0,
  qsb: 0,
  qrm: 0,
  toneWave: 'sine',     // 側音の波形
  toneRamp: 5,          // キーイングの立ち上がり ms

  // 練習
  kochLevel: 2,
  drillType: 'koch',
  groupSize: 5,
  groupCount: 5,
  drillCount: 1,        // 連続出題の問題数（1 = 都度）
  qsoMode: 'cq',
  qsoLength: 'normal',
  qsoStyle: 'guided',      // 'guided'（型を覚える）| 'copy'（聞き取り試験）
  qsoReaction: 'normal',   // 相手の反応のゆらぎ
  showText: false,      // 送信中に本文を表示するか
  beginnerMode: true,   // Q 符号・略語の解説をリアルタイムで出すか
  copyReveal: false,    // 聞き取り練習で、受信中に相手の送信を画面に出すか

  // エレクトロニックキーヤー
  keyerMode: 'iambicB',
  keyerWeight: 50,
  keyerWpm: 20,
  keyerHand: 'right',   // 'right' | 'left' — パドルを操作する手
  keyerThumb: 'dit',    // 'dit' | 'dah'   — 親指側のレバーが出す要素
  keyerTaskType: 'callsign',
  keyerTopic: '',        // 交信の定型文の話題。空ならすべての話題から選ぶ
  keyerFreq: 700,       // 送信側音の高さ Hz（受信の freq とは独立）
  // 100点＋ を出したときの祝い方（celebrate.js の id）。
  // 既定は 'random'（毎回 10 種類から選び直す）
  plusStyle: 'random',

  // コンテスト運用
  contestMode: 'pileup',
  contestExchange: 'serial',
  contestMinutes: 5,
  contestActivity: 3,
  contestDxWpm: 22,      // 相手局の速度の基準（WPM）
  contestDxSpread: 6,    // 相手局どうしの速度のばらつき（±WPM、0 でそろう）
  contestMyNumber: '13H',
  contestRecord: false,
  // 受信ヘルプの段階。seq → char → none の順に難しくなる。
  // 既定は none（実戦どおり。従来の動きと同じ）
  contestHint: 'none',

  // バンドコンディション（コンテスト用）
  condQrn: true,
  condQrm: true,
  condQsb: true,
  condFlutter: true,
  condLids: true,

  // 受信系
  bandwidth: 500,
  qsk: true,
};

export const DEFAULT_STATS = {
  perChar: {},       // { 'A': { sent, correct } }
  drills: { attempts: 0, chars: 0, correct: 0 },
  qso: { completed: 0, fields: 0, correct: 0 },
  keying: { attempts: 0, chars: 0, correct: 0 },
  contest: { sessions: 0, qsos: 0, valid: 0, bestRate: 0 },
  history: [],       // 直近の練習結果（新しい順、最大 50 件）
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(fallback);
    return { ...structuredClone(fallback), ...JSON.parse(raw) };
  } catch {
    return structuredClone(fallback);
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // プライベートブラウジングなどで保存できない場合は諦める
  }
}

export function loadSettings() {
  const settings = read(SETTINGS_KEY, DEFAULT_SETTINGS);

  // 旧版の keyerSwap（左右入れ替えのチェックボックス）を利き手設定へ移行する
  if (settings.keyerSwap != null && !settings.keyerHandMigrated) {
    settings.keyerHand = settings.keyerSwap ? 'left' : 'right';
    settings.keyerHandMigrated = true;
    delete settings.keyerSwap;
  }

  // 送信速度の上限を下げた際、以前の設定値が範囲外のまま残らないようにする
  settings.keyerWpm = clampKeyerWpm(settings.keyerWpm);
  // 受信速度（文字速度・実効速度）も同じ。上限 30 WPM
  settings.charWpm = Math.max(5, Math.min(RX_WPM_MAX, Number(settings.charWpm) || 20));
  settings.effWpm = Math.max(5, Math.min(settings.charWpm, Number(settings.effWpm) || 15));
  // 知らない段階名が保存されていても、いちばん厳しい none に寄せる
  settings.contestHint = clampHint(settings.contestHint);

  return settings;
}

/**
 * 利き手と親指の割り当てから、短点・長点をどちらのボタンに置くかを決める。
 * 右手ではパドルの左レバー、左手では右レバーに親指が当たるため、
 * 「親指＝短点」を保つには左手用で左右が入れ替わる。
 * @returns {boolean} true なら左ボタンが長点（＝入れ替え）
 */
export function paddleSwapped({ keyerHand, keyerThumb }) {
  const thumbOnRightButton = keyerHand === 'left';
  const thumbSendsDah = keyerThumb === 'dah';
  return thumbOnRightButton !== thumbSendsDah; // 排他的論理和
}

/** 現在の割り当てで、各ボタンがどちらの要素を出すかを返す。 */
export function paddleAssignment(settings) {
  const swapped = paddleSwapped(settings);
  return {
    swapped,
    left: swapped ? 'dah' : 'dit',
    right: swapped ? 'dit' : 'dah',
    thumbButton: settings.keyerHand === 'left' ? 'right' : 'left',
  };
}

export function saveSettings(settings) {
  write(SETTINGS_KEY, settings);
}

export function loadStats() {
  return read(STATS_KEY, DEFAULT_STATS);
}

export function saveStats(stats) {
  write(STATS_KEY, stats);
}

export function resetStats() {
  const fresh = structuredClone(DEFAULT_STATS);
  write(STATS_KEY, fresh);
  return fresh;
}

/** ドリル 1 回分の結果を統計に反映する。 */
export function recordDrill(stats, { type, result, level }) {
  stats.drills.attempts += 1;
  // 余分に打った分も分母に入れる。画面の点数と通算の集計をそろえるため
  stats.drills.chars += result.total + (result.extra ?? 0);
  stats.drills.correct += result.correct;

  for (const [ch, counts] of Object.entries(result.perChar)) {
    if (!stats.perChar[ch]) stats.perChar[ch] = { sent: 0, correct: 0 };
    stats.perChar[ch].sent += counts.sent;
    stats.perChar[ch].correct += counts.correct;
  }

  pushHistory(stats, {
    kind: 'drill',
    type,
    level,
    accuracy: result.accuracy,
    total: result.total,
    at: Date.now(),
  });
  return stats;
}

/** 交信シミュレーション 1 回分の結果を統計に反映する。 */
export function recordQso(stats, { correct, total, station, wpm }) {
  stats.qso.completed += 1;
  stats.qso.fields += total;
  stats.qso.correct += correct;

  pushHistory(stats, {
    kind: 'qso',
    station,
    wpm,
    accuracy: total ? correct / total : 0,
    total,
    at: Date.now(),
  });
  return stats;
}

/** パドル送信練習 1 回分の結果を統計に反映する。 */
export function recordKeying(stats, { correct, total, extra = 0, target, wpm }) {
  if (!stats.keying) stats.keying = { attempts: 0, chars: 0, correct: 0 };
  // 余分に打った分も分母に入れる。画面の点数・履歴・通算をそろえるため
  const denominator = total + extra;
  stats.keying.attempts += 1;
  stats.keying.chars += denominator;
  stats.keying.correct += correct;

  pushHistory(stats, {
    kind: 'keying',
    target,
    wpm,
    accuracy: denominator ? correct / denominator : 0,
    total,
    at: Date.now(),
  });
  return stats;
}

/** コンテスト 1 セッション分の結果を統計に反映する。 */
export function recordContest(stats, { score, minutes, exchange }) {
  if (!stats.contest) stats.contest = { sessions: 0, qsos: 0, valid: 0, bestRate: 0 };
  stats.contest.sessions += 1;
  stats.contest.qsos += score.rawPoints ?? 0;
  stats.contest.valid += score.points ?? 0;
  stats.contest.bestRate = Math.max(stats.contest.bestRate, score.rate ?? 0);

  pushHistory(stats, {
    kind: 'contest',
    exchange,
    minutes,
    rate: score.rate ?? 0,
    accuracy: score.accuracy,
    total: score.rawPoints ?? 0,
    at: Date.now(),
  });
  return stats;
}

function pushHistory(stats, entry) {
  stats.history.unshift(entry);
  if (stats.history.length > 50) stats.history.length = 50;
}

/**
 * 打鍵の照合結果（compareSending の marks）から文字別の成績を数え、
 * 打鍵側の記録（keyPerChar）へ足す。
 *
 * 聞き取り（perChar）とは分けて持つ。耳で取れない文字と手で打てない
 * 文字は別物で、混ぜると「聞き取れるのに苦手扱い」（逆も）になる。
 * 手本側の文字（ok / missing）だけを数え、余分に打った文字は
 * どの出題文字の成績でもないので数えない（ドリルの採点と同じ扱い）。
 */
export function recordKeyPerChar(stats, marks) {
  if (!stats.keyPerChar) stats.keyPerChar = {};
  for (const m of marks) {
    if (m.type !== 'ok' && m.type !== 'missing') continue;
    if (!stats.keyPerChar[m.char]) stats.keyPerChar[m.char] = { sent: 0, correct: 0 };
    stats.keyPerChar[m.char].sent += 1;
    if (m.type === 'ok') stats.keyPerChar[m.char].correct += 1;
  }
  return stats;
}

/**
 * 苦手な文字を正答率の低い順に返す。
 * source: 'drill' = 聞き取り（既定）、'keying' = パドル入力。
 */
export function weakChars(stats, { minSent = 5, limit = 10, source = 'drill' } = {}) {
  const table = source === 'keying' ? (stats.keyPerChar || {}) : stats.perChar;
  return Object.entries(table)
    .filter(([, c]) => c.sent >= minSent)
    .map(([ch, c]) => ({ char: ch, accuracy: c.correct / c.sent, sent: c.sent }))
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, limit);
}
