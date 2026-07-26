// 聞き取りドリルの問題生成と採点

import {
  ABBREVIATIONS, FREQUENCY_ORDER, KOCH_ORDER, RST_POOL,
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
 * @returns {{ total, correct, accuracy, marks, perChar }}
 *   marks は [{ expected, actual, ok }] の配列（表示用）
 */
export function gradeProblem(problem, input) {
  const expected = String(problem.answer).toUpperCase().replace(/\s+/g, '');
  const actual = String(input || '').toUpperCase().replace(/\s+/g, '');

  const marks = [];
  const perChar = {};
  let correct = 0;

  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i] ?? '';
    const ok = e === a;
    if (ok) correct += 1;
    marks.push({ expected: e, actual: a, ok });

    if (!perChar[e]) perChar[e] = { sent: 0, correct: 0 };
    perChar[e].sent += 1;
    if (ok) perChar[e].correct += 1;
  }

  // 余分に打った文字も誤りとして見えるようにする
  for (let i = expected.length; i < actual.length; i++) {
    marks.push({ expected: '', actual: actual[i], ok: false });
  }

  const total = expected.length;
  return {
    total,
    correct,
    accuracy: total ? correct / total : 0,
    marks,
    perChar,
  };
}

/**
 * コッホ法の進級判定。正答率 90% 以上で次のレベルへ進むのが通例。
 */
export function shouldLevelUp(accuracy, threshold = 0.9) {
  return accuracy >= threshold;
}

export { COMMON_WORDS };
