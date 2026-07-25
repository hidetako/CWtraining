// モールス符号テーブルと符号化ユーティリティ

export const MORSE_TABLE = {
  A: '.-',    B: '-...',  C: '-.-.',  D: '-..',   E: '.',     F: '..-.',
  G: '--.',   H: '....',  I: '..',    J: '.---',  K: '-.-',   L: '.-..',
  M: '--',    N: '-.',    O: '---',   P: '.--.',  Q: '--.-',  R: '.-.',
  S: '...',   T: '-',     U: '..-',   V: '...-',  W: '.--',   X: '-..-',
  Y: '-.--',  Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
  5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.',
  '!': '-.-.--', '/': '-..-.',  '(': '-.--.',  ')': '-.--.-',
  '&': '.-...',  ':': '---...', ';': '-.-.-.', '=': '-...-',
  '+': '.-.-.',  '-': '-....-', '_': '..--.-', '"': '.-..-.',
  '$': '...-..-', '@': '.--.-.',
};

// 連続送信する短縮符（プロサイン）。本文中では <AR> のように書く。
export const PROSIGNS = {
  AR: '.-.-.',    // 送信の終わり
  SK: '...-.-',   // 交信終了
  VA: '...-.-',   // SK の別名
  BT: '-...-',    // 区切り（= と同符号）
  KN: '-.--.',    // 指定局のみどうぞ
  AS: '.-...',    // 少し待って
  BK: '-...-.-',  // ブレークイン
  SN: '...-.',    // 了解
  HH: '........', // 訂正
  CT: '-.-.-',    // 送信開始
};

export const PROSIGN_LABEL = {
  AR: '送信の終わり', SK: '交信終了', VA: '交信終了', BT: '区切り',
  KN: '指定局のみどうぞ', AS: '少し待って', BK: 'ブレークイン',
  SN: '了解', HH: '訂正', CT: '送信開始',
};

const REVERSE_TABLE = (() => {
  const map = {};
  for (const [ch, pattern] of Object.entries(MORSE_TABLE)) map[pattern] = ch;
  return map;
})();

/**
 * 文字列をトークン列に分解する。
 * 返り値の要素は次のいずれか:
 *   { type: 'char',    text: 'A',    pattern: '.-'    }
 *   { type: 'prosign', text: '<AR>', pattern: '.-.-.' }
 *   { type: 'space' }                                   語間スペース
 * 未対応の文字は黙って読み飛ばす。
 */
export function tokenize(text) {
  const src = String(text ?? '').toUpperCase();
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (ch === '<') {
      const end = src.indexOf('>', i);
      const name = end > i ? src.slice(i + 1, end) : null;
      if (name && PROSIGNS[name]) {
        tokens.push({ type: 'prosign', text: `<${name}>`, pattern: PROSIGNS[name] });
        i = end + 1;
        continue;
      }
      // 対応するプロサインが無ければ '<' 自体を読み飛ばす
      i += 1;
      continue;
    }

    if (ch === ' ' || ch === '\n' || ch === '\t') {
      // 連続する空白はひとつの語間として扱う
      if (tokens.length && tokens[tokens.length - 1].type !== 'space') {
        tokens.push({ type: 'space' });
      }
      i += 1;
      continue;
    }

    const pattern = MORSE_TABLE[ch];
    if (pattern) tokens.push({ type: 'char', text: ch, pattern });
    i += 1;
  }

  // 末尾の語間は不要
  while (tokens.length && tokens[tokens.length - 1].type === 'space') tokens.pop();
  return tokens;
}

/**
 * ARRL 方式のファーンズワース・タイミングを算出する。
 * charWpm で各文字を打ち、文字間・語間を延ばして全体を effWpm に合わせる。
 * 語 "PARIS" は 50 単位（符号部 31 単位 + 間隔部 19 単位）で構成される。
 */
export function computeTiming(charWpm, effWpm) {
  const c = Math.max(5, Number(charWpm) || 20);
  const s = Math.min(Math.max(5, Number(effWpm) || c), c);
  const dit = 1.2 / c;

  let charGap = 3 * dit;
  let wordGap = 7 * dit;

  if (s < c) {
    // 1 語あたりに配分できる間隔の総時間（秒）
    const ta = (60 * c - 37.2 * s) / (s * c);
    charGap = (3 * ta) / 19;
    wordGap = (7 * ta) / 19;
  }

  return { dit, dah: 3 * dit, elementGap: dit, charGap, wordGap };
}

/** 文字列の送信に要する時間（秒）を返す。 */
export function estimateDuration(text, charWpm, effWpm) {
  const t = computeTiming(charWpm, effWpm);
  const tokens = tokenize(text);
  let total = 0;
  let prevWasSpace = true;

  for (const token of tokens) {
    if (token.type === 'space') {
      total += t.wordGap;
      prevWasSpace = true;
      continue;
    }
    if (!prevWasSpace) total += t.charGap;
    for (let i = 0; i < token.pattern.length; i++) {
      total += token.pattern[i] === '-' ? t.dah : t.dit;
      if (i < token.pattern.length - 1) total += t.elementGap;
    }
    prevWasSpace = false;
  }
  return total;
}

/** 文字列を ".-  -..." 形式の可読なモールス表記に変換する。 */
export function toMorseString(text) {
  return tokenize(text)
    .map((token) => (token.type === 'space' ? '/' : token.pattern))
    .join(' ');
}

// 記号と同じ符号を持つが、実際の交信ではプロサインとして使われるもの。
// 解読時は記号（+ = ( など）より、こちらの表記を優先する。
const PROSIGN_FIRST = {
  '.-.-.': '<AR>',
  '-...-': '<BT>',
  '...-.-': '<SK>',
  '-.--.': '<KN>',
};

/**
 * 単一のパターン（".-" など）を文字に戻す。
 * 該当が無ければ null を返す。プロサインは <AR> 形式で返す。
 */
export function decodePattern(pattern) {
  const p = String(pattern || '');
  if (!p) return null;
  if (PROSIGN_FIRST[p]) return PROSIGN_FIRST[p];
  if (REVERSE_TABLE[p]) return REVERSE_TABLE[p];
  const prosign = Object.keys(PROSIGNS).find((name) => PROSIGNS[name] === p);
  return prosign ? `<${prosign}>` : null;
}

/** ".- -..." 形式のモールス表記を文字列に戻す。 */
export function fromMorseString(morse) {
  return String(morse ?? '')
    .trim()
    .split(/\s+/)
    .map((pattern) => {
      if (pattern === '/' || pattern === '|') return ' ';
      if (REVERSE_TABLE[pattern]) return REVERSE_TABLE[pattern];
      const prosign = Object.keys(PROSIGNS).find((name) => PROSIGNS[name] === pattern);
      return prosign ? `<${prosign}>` : '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
