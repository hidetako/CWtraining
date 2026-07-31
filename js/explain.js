// 初心者向けのリアルタイム解説
//
// 送信中の語を morse.js のトークン列と対応付けて追跡し、Q 符号・略語・
// RST・コールサインなどに解説を付ける。

import { ABBREVIATIONS } from './data.js';
import { PROSIGN_LABEL, prettyCode, tokenize } from './morse.js';

const ABBREV_MAP = new Map(ABBREVIATIONS.map((a) => [a.code, a.ja]));

/** RST の各桁の意味。 */
const RST_READABILITY = {
  1: '了解不能', 2: 'かろうじて了解', 3: 'かなり困難', 4: '実用上支障なし', 5: '完全に了解',
};
const RST_STRENGTH = {
  1: 'かすか', 2: '非常に弱い', 3: '弱い', 4: 'やや弱い', 5: '並',
  6: 'やや強い', 7: '強い', 8: '非常に強い', 9: '極めて強い',
};
const RST_TONE = {
  1: '交流音・非常に粗い', 2: '交流音・粗い', 3: '粗い整流音', 4: 'やや粗い整流音',
  5: '整流音の混じった調子', 6: 'わずかに交流を含む', 7: 'ほぼ純音', 8: '純音に近い', 9: '完全な純音',
};

const CALLSIGN_RE = /^[A-Z0-9]{1,3}[0-9][A-Z]{1,4}$/;

/**
 * 語ひとつを解説する。該当が無ければ null。
 * @returns {{ term, ja, kind } | null}
 */
export function lookupTerm(word) {
  const w = String(word || '').toUpperCase().trim();
  if (!w) return null;

  // プロサイン <AR> など
  const prosign = w.match(/^<([A-Z]+)>$/);
  if (prosign) {
    const label = PROSIGN_LABEL[prosign[1]];
    if (label) return { term: w, ja: label, kind: 'prosign' };
  }

  // 区切り記号
  if (w === '=') return { term: '=', ja: '区切り（BT）— 話題の切れ目', kind: 'prosign' };
  if (w === '?') return { term: '?', ja: '「もう一度」「何ですか」の意味', kind: 'prosign' };

  // 略語・Q 符号
  if (ABBREV_MAP.has(w)) {
    return { term: w, ja: ABBREV_MAP.get(w), kind: w.startsWith('Q') && w.length === 3 ? 'qcode' : 'abbrev' };
  }

  // RST レポート（5NN は 599 の短縮送信）
  const rstRaw = w === '5NN' ? '599' : w;
  if (/^[1-5][1-9][1-9]$/.test(rstRaw)) {
    const [r, s, t] = rstRaw.split('').map(Number);
    const note = w === '5NN' ? '（5NN は 599 を短く打つ送り方）' : '';
    return {
      term: w,
      ja: `信号レポート ${rstRaw}${note} — 了解度${r}:${RST_READABILITY[r]} / 強度${s}:${RST_STRENGTH[s]} / 音調${t}:${RST_TONE[t]}`,
      kind: 'rst',
    };
  }

  // コールサイン
  if (CALLSIGN_RE.test(w)) {
    return { term: w, ja: 'コールサイン（局の呼出符号）', kind: 'callsign' };
  }

  // 数字だけの語
  if (/^\d+$/.test(w)) {
    return { term: w, ja: `数字 ${w}`, kind: 'number' };
  }

  // 末尾の記号を外して引き直す。QRZ? や HW? のように、疑問符を付けて
  // 送るのが普通の語があるため（? だけの語は上で拾い済み）
  const stripped = w.replace(/[?.,!]+$/, '');
  if (stripped && stripped !== w) {
    const entry = lookupTerm(stripped);
    // 見出しは打つとおりの表記のままにする
    if (entry) return { ...entry, term: w };
  }

  return null;
}

/**
 * 本文をトークン列に合わせて語単位に区切る。
 * 返り値は [{ text, from, to }]（from/to は tokenize() のインデックス）。
 * tokenize() は未対応文字を読み飛ばすので、必ずこの関数で対応付ける。
 */
export function wordSpans(text) {
  const tokens = tokenize(text);
  const spans = [];
  let current = null;

  tokens.forEach((token, index) => {
    if (token.type === 'space') {
      current = null;
      return;
    }
    if (!current) {
      current = { text: '', from: index, to: index };
      spans.push(current);
    }
    current.text += token.text;
    current.to = index;
  });

  return spans;
}

/** 本文に含まれる用語を、重複を除いて出現順に返す。 */
/**
 * 語の符号を ・－ 表記で返す（FER → "・・－・　・　・－・"）。
 * 意味だけでなく「どう打つか」まで見せるために、解説と並べて使う。
 */
export const termCode = (term) => prettyCode(term);

/** マウスを載せたときに出す説明文。意味に符号を添える。 */
export const termTitle = (entry) => {
  const code = termCode(entry.term);
  return code ? `${entry.ja}　${code}` : entry.ja;
};

export function explainText(text) {
  const seen = new Set();
  const terms = [];
  for (const span of wordSpans(text)) {
    const entry = lookupTerm(span.text);
    if (!entry || seen.has(entry.term)) continue;
    seen.add(entry.term);
    terms.push(entry);
  }
  return terms;
}

/**
 * 再生中に「今どの語を送っているか」を追跡するヘルパー。
 * onToken(token, index) から step(index) を呼ぶと、
 * 新しい語に入ったときだけ解説を返す。
 */
export function createTracker(text) {
  const spans = wordSpans(text);
  let lastSpan = null;

  return {
    spans,
    /** @returns {{ span, entry, index } | null} 新しい語に入ったときだけ返す */
    step(index) {
      const at = spans.findIndex((s) => index >= s.from && index <= s.to);
      const span = spans[at];
      if (!span || span === lastSpan) return null;
      lastSpan = span;
      return { span, entry: lookupTerm(span.text), index: at };
    },
    reset() { lastSpan = null; },
  };
}

/**
 * 本文を HTML に変換し、解説の付く語を印付きにする。
 * escape は呼び出し側の関数を渡す（app.js と同じ実装を使うため）。
 */
export function annotateHtml(text, escape) {
  // 再生中の語を光らせられるよう、すべての語を span で包んで通し番号を振る。
  // 番号は wordSpans() と揃える（再生側はトークン位置から語を特定するため）。
  // 万一ずれたら番号を振らないでおく — 光らないだけで表示は壊れない
  const spans = wordSpans(text);
  let wi = 0;

  return String(text)
    .split(/(\s+)/)
    .map((chunk) => {
      if (/^\s+$/.test(chunk)) return chunk;

      // tokenize() は大文字に直すので、対応付けも大文字どうしで比べる
      // （変換・電鍵タブには小文字のまま入力できる）
      const index = spans[wi]?.text === chunk.toUpperCase() ? wi++ : null;
      const entry = lookupTerm(chunk);
      const cls = entry ? `word term term-${entry.kind}` : 'word';
      const attrs = [
        `class="${cls}"`,
        index != null ? `data-w="${index}"` : '',
        entry ? `title="${escape(termTitle(entry))}"` : '',
      ].filter(Boolean).join(' ');

      return `<span ${attrs}>${escape(chunk)}</span>`;
    })
    .join('');
}
