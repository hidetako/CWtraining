// コンテストのログ・採点・統計
//
// Morse Runner の Log.pas に対応する。交信は打ち込んだ内容と実際の内容の
// 両方を持ち、CheckErr で NIL / DUP / RST / NR のいずれかに分類する。

/** 交信のエラー種別。Morse Runner の Err 文字列に対応する。 */
export const QSO_ERROR = {
  NONE: '',
  NIL: 'NIL',   // 該当する局がいない（存在しない交信）
  DUP: 'DUP',   // 重複交信
  RST: 'RST',   // RST の取り違え
  NR: 'NR',     // ナンバーの取り違え
  CALL: 'CALL', // コールサインの取り違え
};

export const QSO_ERROR_LABEL = {
  [QSO_ERROR.NONE]: '有効',
  [QSO_ERROR.NIL]: '該当局なし',
  [QSO_ERROR.DUP]: '重複交信',
  [QSO_ERROR.RST]: 'RST 違い',
  [QSO_ERROR.NR]: 'ナンバー違い',
  [QSO_ERROR.CALL]: 'コールサイン違い',
};

/**
 * コールサインから WPX プリフィックスを求める。
 * 末尾が数字を含まない場合は、最後の数字までを取り、
 * 数字が無ければ先頭 2 文字 + '0' とする（WPX 規約の簡略版）。
 */
export function wpxPrefix(callsign) {
  const call = String(callsign || '').toUpperCase();
  if (!call) return '';

  // ポータブル表記があれば、より短い方（運用地）を使う
  const parts = call.split('/').filter(Boolean);
  let base = parts[0] || call;
  if (parts.length > 1) {
    const tail = parts[parts.length - 1];
    // /P /M /QRP のような接尾辞は運用地ではない
    if (!/^(P|M|MM|AM|QRP|A)$/.test(tail)) {
      base = tail.length < base.length ? tail : base;
    }
  }

  const lastDigit = base.search(/\d(?!.*\d)/);
  if (lastDigit >= 0) return base.slice(0, lastDigit + 1);

  // 数字を含まないコール（例: 一部の特別局）は先頭 2 文字 + 0
  return `${base.slice(0, 2)}0`;
}

export class ContestLog {
  constructor() {
    this.qsos = [];
  }

  get count() {
    return this.qsos.length;
  }

  /** 過去にこのコールサインと有効な交信をしているか。 */
  isDupe(callsign) {
    const call = String(callsign || '').toUpperCase();
    return this.qsos.some((q) => q.call === call && q.err !== QSO_ERROR.NIL);
  }

  /**
   * 交信を記録する。
   * @param {object} entry
   *   { call, rst, nr, trueCall, trueRst, trueNr, at }
   *   true* が null なら該当局が存在しなかった（NIL）ことを意味する。
   */
  add(entry) {
    const call = String(entry.call || '').toUpperCase();
    const qso = {
      at: entry.at ?? Date.now(),
      call,
      rst: normalizeNumber(entry.rst),
      nr: normalizeNumber(entry.nr),
      trueCall: entry.trueCall ? String(entry.trueCall).toUpperCase() : '',
      trueRst: entry.trueRst == null ? null : normalizeNumber(entry.trueRst),
      trueNr: entry.trueNr == null ? null : normalizeNumber(entry.trueNr),
      pfx: wpxPrefix(call),
      dupe: this.isDupe(call),
      err: QSO_ERROR.NONE,
    };

    qso.err = checkErr(qso);
    this.qsos.push(qso);
    return qso;
  }

  /** 有効交信（エラーなし）だけを返す。 */
  get verified() {
    return this.qsos.filter((q) => q.err === QSO_ERROR.NONE);
  }

  /**
   * 得点。Morse Runner に倣い、素点（打ち込んだ全交信）と
   * 確定点（エラーを除いたもの）の両方を出す。
   * WPX 形式では マルチ = 異なるプリフィックスの数。
   */
  score({ useMultiplier = true } = {}) {
    const verified = this.verified;
    const rawMults = new Set(this.qsos.map((q) => q.pfx).filter(Boolean));
    const verMults = new Set(verified.map((q) => q.pfx).filter(Boolean));

    const rawPoints = this.qsos.length;
    const verPoints = verified.length;

    return {
      rawPoints,
      rawMults: rawMults.size,
      rawScore: useMultiplier ? rawPoints * rawMults.size : rawPoints,
      points: verPoints,
      mults: verMults.size,
      score: useMultiplier ? verPoints * verMults.size : verPoints,
      errors: this.qsos.length - verPoints,
      accuracy: this.qsos.length ? verPoints / this.qsos.length : 0,
    };
  }

  /**
   * 直近 5 分間の交信数から毎時ペースを求める（Morse Runner の ShowRate と同じ）。
   * 開始からまだ 5 分経っていない場合は経過時間で割る。
   */
  rate(now = Date.now(), startedAt = null, windowMs = 5 * 60 * 1000) {
    const from = now - windowMs;
    const recent = this.verified.filter((q) => q.at >= from);

    // 経過時間が窓より短いうちは、その経過時間で換算する
    let spanMs = windowMs;
    if (startedAt != null) {
      const elapsed = now - startedAt;
      if (elapsed < windowMs) spanMs = Math.max(30000, elapsed);
    }
    if (spanMs <= 0) return 0;
    return Math.round((recent.length / spanMs) * 3600000);
  }

  /** 5 分ごとの交信数。ヒストグラム表示に使う。 */
  histogram(startedAt, endsAt, blockMs = 5 * 60 * 1000) {
    const blocks = [];
    const total = Math.max(blockMs, endsAt - startedAt);
    for (let t = startedAt; t < startedAt + total; t += blockMs) {
      const upto = t + blockMs;
      blocks.push({
        from: t,
        valid: this.verified.filter((q) => q.at >= t && q.at < upto).length,
        raw: this.qsos.filter((q) => q.at >= t && q.at < upto).length,
      });
    }
    return blocks;
  }

  clear() {
    this.qsos = [];
  }
}

/** Morse Runner の CheckErr と同じ優先順位で誤りを判定する。 */
export function checkErr(qso) {
  if (!qso.trueCall) return QSO_ERROR.NIL;
  if (qso.call !== qso.trueCall) return QSO_ERROR.CALL;
  if (qso.dupe) return QSO_ERROR.DUP;
  if (qso.trueRst != null && qso.trueRst !== qso.rst) return QSO_ERROR.RST;
  if (qso.trueNr != null && qso.trueNr !== qso.nr) return QSO_ERROR.NR;
  return QSO_ERROR.NONE;
}

/**
 * カットナンバーを数字に戻して比較用に正規化する。
 * CW では 9 を N、0 を T や O と打つ習慣がある。
 */
export function normalizeNumber(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/N/g, '9')
    .replace(/[TO]/g, '0')
    .replace(/A/g, '1')
    .replace(/E/g, '5');
}

// ───────── ハイスコアの保存 ─────────

const HIGH_SCORE_KEY = 'cwtraining.highscores.v1';

export function loadHighScores() {
  try {
    return JSON.parse(localStorage.getItem(HIGH_SCORE_KEY)) || {};
  } catch {
    return {};
  }
}

/**
 * 運用モードごとにハイスコアを保存する。更新したら true を返す。
 */
export function saveHighScore(mode, entry) {
  const all = loadHighScores();
  const prev = all[mode];
  if (prev && prev.score >= entry.score) return false;

  all[mode] = { ...entry, at: Date.now() };
  try {
    localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(all));
  } catch {
    // 保存できなくても運用自体は続けられる
  }
  return true;
}
