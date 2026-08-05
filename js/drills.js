// 聞き取りドリルの問題生成と採点

import { codeUnits, countSubstitutions } from './morse.js';
import {
  ABBREVIATIONS, FREQUENCY_ORDER, KOCH_ORDER, RST_POOL, SYMBOL_ORDER,
  makeCallsign, pick, pickInt,
} from './data.js';

/** 平文の交信でよく出てくる短い単語。 */
const COMMON_WORDS = [
  'CQ', 'DE', 'TNX', 'FER', 'QSO', 'UR', 'RST', 'NAME', 'QTH', 'RIG', 'ANT',
  'PWR', 'WX', 'HW', 'PSE', 'AGN', 'GM', 'GA', 'GE', 'OM', 'YL', 'FB', 'ES',
  'HR', 'NW', 'VY', 'GUD', 'TU', 'CFM', 'CUAGN', 'HPE', 'SRI', 'WKD', 'MNI',
  '73', '88', 'QRZ', 'QRM', 'QRN', 'QSB', 'QSY', 'QRP', 'QRS', 'QRQ',
];

export const DRILL_TYPES = {
  koch: { label: 'コッホ法（文字）', help: 'レベルの文字だけを使った 5 文字ずつのランダム群' },
  frequency: { label: '頻度順（文字）', help: '英文での出現頻度が高い文字から順に増やす' },
  callsign: { label: 'コールサイン', help: '実在しそうなコールサインを聞き取る' },
  abbrev: { label: '略語・Q 符号', help: '交信で頻出する略語。答え合わせで意味も表示' },
  number: { label: '数字・RST', help: 'RST や番号などの数字列' },
  word: { label: '頻出単語', help: '交信でよく使う短い単語' },
  symbol: {
    label: '記号・プロサイン',
    help: '= / ? . , や <AR> <SK> など、ローマ字以外の符号だけを出題します',
  },
  weak: { label: '苦手集中', help: '正答率の低い文字を重点的に出題します（記録から自動選択）' },
};

/**
 * 問題を 1 問生成する。
 * @param {string} type   DRILL_TYPES のキー
 * @param {object} opts   { level, groupSize, groupCount }
 * @returns {{ text: string, answer: string, hint?: string, chars: string[] }}
 */
export function makeProblem(type, opts = {}) {
  switch (type) {
    case 'weak': {
      // 呼び出し側が苦手文字の配列（重み付けで重複あり）を渡す。
      // 記録が足りなければコッホ法の文字で代替する
      const alphabet = (opts.alphabet && opts.alphabet.length >= 2)
        ? opts.alphabet
        : KOCH_ORDER.slice(0, Math.max(2, opts.level || 2));
      return groupsFromAlphabet(alphabet, opts);
    }
    case 'koch':
      return charGroups(KOCH_ORDER, opts);
    case 'frequency':
      return charGroups(FREQUENCY_ORDER, opts);
    case 'symbol':
      return charGroups(SYMBOL_ORDER, opts);
    case 'callsign': {
      const call = makeCallsign(opts.region);
      return { text: call, answer: call, chars: call.split('') };
    }
    case 'abbrev': {
      const entry = pick(ABBREVIATIONS);
      return {
        text: entry.code,
        answer: entry.code,
        hint: entry.ja,
        chars: entry.code.split(''),
      };
    }
    case 'number': {
      const value = Math.random() < 0.5
        ? pick(RST_POOL).replace('5NN', '599')
        : String(pickInt(1, 9999)).padStart(pick([2, 3, 4]), '0');
      return { text: value, answer: value, chars: value.split('') };
    }
    case 'word': {
      const word = pick(COMMON_WORDS);
      const meaning = ABBREVIATIONS.find((a) => a.code === word);
      return { text: word, answer: word, hint: meaning?.ja, chars: word.split('') };
    }
    default:
      return charGroups(KOCH_ORDER, opts);
  }
}

function charGroups(order, opts) {
  const level = Math.min(Math.max(2, opts.level || 2), order.length);
  return groupsFromAlphabet(order.slice(0, level), opts);
}

function groupsFromAlphabet(alphabet, opts) {
  const groupSize = opts.groupSize || 5;
  const groupCount = opts.groupCount || 5;

  const groups = [];
  for (let g = 0; g < groupCount; g++) {
    let group = '';
    for (let i = 0; i < groupSize; i++) group += pick(alphabet);
    groups.push(group);
  }
  const text = groups.join(' ');
  return { text, answer: text, chars: text.replace(/ /g, '').split('') };
}

/**
 * 解答を文字単位で採点する。空白は無視して並びだけを比べる。
 *
 * 位置をそのまま突き合わせると、1 文字打ち漏らしただけで以降が全部ずれ、
 * ほとんど取れていても 0% 近くになってしまう。実際には「1 文字落とした」
 * だけなので、最長共通部分列で対応を取ってから過不足を数える。
 *
 * @returns {{ total, correct, accuracy, marks, perChar }}
 *   marks は [{ type: 'ok'|'missing'|'extra', expected, actual, ok }] の配列（表示用）
 */
export function gradeProblem(problem, input) {
  const expected = String(problem.answer).toUpperCase();
  const actual = String(input || '').toUpperCase();

  const marks = align(expected, actual);
  const perChar = {};
  let correct = 0;
  let extra = 0;

  for (const m of marks) {
    // 余分な文字は、どの出題文字の成績でもないが、誤りとしては数える
    if (m.type === 'extra') { extra += 1; continue; }
    if (!perChar[m.expected]) perChar[m.expected] = { sent: 0, correct: 0 };
    perChar[m.expected].sent += 1;
    if (m.type === 'ok') {
      perChar[m.expected].correct += 1;
      correct += 1;
    }
  }

  // 出題の長さは符号の個数で数える。プロサインは <AR> で 1 個
  const total = marks.filter((m) => m.type !== 'extra').length;
  // 書き間違い 1 文字は「取り漏らし＋余分」に分かれて出てくる。
  // これは 1 回の誤りなので、余分としては数えない
  const wrong = countSubstitutions(marks);
  // 残った余分（水増し）は分母に入れる。そうしないと、当てずっぽうに
  // 多く書くほど得をしてしまう（出題文字さえ含まれていれば 100% になる）
  const inserted = Math.max(0, extra - wrong);
  const denominator = total + inserted;
  return {
    total,
    correct,
    extra: inserted,
    wrong,
    accuracy: denominator ? correct / denominator : 0,
    marks,
    perChar,
  };
}

/**
 * 最長共通部分列で 2 つの文字列を並べ、一致・打ち漏らし・余分に分ける。
 * @returns {Array<{ type: 'ok'|'missing'|'extra', expected: string, actual: string, ok: boolean }>}
 */
function align(expected, actual) {
  // 文字ではなく符号の単位で並べる。<AR> のようなプロサインは 1 個として
  // 数え、= と <BT> のように同じ符号を持つ表記は同じものとして扱う
  // （耳では区別が付かないので、どちらで書いても正解にする）
  const a = codeUnits(expected).filter((u) => !u.space);
  const b = codeUnits(actual).filter((u) => !u.space);

  // dp[i][j] = a[i..] と b[j..] の最長共通部分列の長さ
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i].key === b[j].key
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const marks = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i].key === b[j].key) {
      // 表記が違っても符号が同じなら正解。表示は出題側の表記に揃える
      marks.push({ type: 'ok', expected: a[i].text, actual: a[i].text, ok: true });
      i += 1; j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      marks.push({ type: 'missing', expected: a[i].text, actual: '', ok: false });
      i += 1;
    } else {
      marks.push({ type: 'extra', expected: '', actual: b[j].text, ok: false });
      j += 1;
    }
  }
  while (i < a.length) marks.push({ type: 'missing', expected: a[i++].text, actual: '', ok: false });
  while (j < b.length) marks.push({ type: 'extra', expected: '', actual: b[j++].text, ok: false });

  return marks;
}

/**
 * コッホ法の進級判定。正答率 90% 以上で次のレベルへ進むのが通例。
 */
export function shouldLevelUp(accuracy, threshold = 0.9) {
  return accuracy >= threshold;
}

export { COMMON_WORDS };
