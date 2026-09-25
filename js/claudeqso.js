// 模擬交信で Claude を使う（任意）
//
// 相手局の返事に流動性を持たせ、相談に自由文で答える。使うかどうかは設定で、
// 既定は使わない。API キーはこの端末の localStorage にだけ保存し、
// 要求はブラウザから Anthropic へ直接送る（サーバーは無い）。
//
// 相手の返事は、まず規則で作った文（必ず要点を含む）を用意しておき、
// Claude にはそれを「同じ要点を保ったまま言い回しを変える」よう頼む。
// 返ってきた文は要点が残っているか検査し、欠けていれば規則の文に戻す。
// 通信に失敗しても交信は止まらない。

import { parseSend } from './mockqso.js';

export const CLAUDE_MODELS = {
  'claude-opus-5': 'Claude Opus 5（標準）',
  'claude-sonnet-5': 'Claude Sonnet 5（速い）',
  'claude-haiku-4-5': 'Claude Haiku 4.5（軽い）',
};
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';
export const CLAUDE_KEY_STORAGE = 'cwtraining.claude.key';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

const CW_RULES = `あなたはアマチュア無線の CW（モールス）交信で相手局を演じます。
出力は相手局が電鍵で打つ文そのもので、英大文字・数字・空白・記号（= ? / .）と
プロサイン <SK> <AR> <BT> だけを使います。日本語や説明は書きません。
略語は実際の交信で使うもの（TNX FER CALL, UR RST, NAME, QTH, RIG, ANT, PWR, WX, HW?, 73, CUAGN, GL, GB など）。
区切りは = で示し、文の最後は K（続く）か <SK>（終える）です。`;

export class ClaudeAssist {
  /**
   * @param {{ apiKey?: string, model?: string, fetch?: Function }} opts
   */
  constructor(opts = {}) {
    this.apiKey = opts.apiKey || '';
    this.model = CLAUDE_MODELS[opts.model] ? opts.model : DEFAULT_CLAUDE_MODEL;
    this._fetch = opts.fetch || ((...a) => fetch(...a));
    this.lastError = '';
  }

  get configured() { return !!this.apiKey; }

  async _ask({ system, user, maxTokens = 400, effort = 'low' }) {
    const res = await this._fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        // ブラウザから直接呼ぶための明示的な許可
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        system,
        // 交信の返事は短く、速さが要る。考える量は低めで十分
        output_config: { effort },
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error?.message || ''; } catch { /* 本文なし */ }
      throw new Error(`${res.status}${detail ? ` ${detail}` : ''}`);
    }
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('refusal');
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }

  /**
   * 相手局の返事を、規則で作った文をもとに言い換えてもらう。
   * 要点（コール・RST・名前・QTH・締めの符号）が欠けたら規則の文を返す。
   * @returns {Promise<{ text: string, source: 'claude'|'rule', error?: string }>}
   */
  async dxReply({ baseText, transcript, dx, me, phase }) {
    if (!this.configured) return { text: baseText, source: 'rule' };
    const log = transcript.slice(-8).map((t) => `${t.dir === 'tx' ? '自局' : '相手'}: ${t.text}`).join('\n');
    const user = `相手局: ${dx.callsign}（名前 ${dx.name}、QTH ${dx.qth}、RIG ${dx.rig}、PWR ${dx.pwr}、ANT ${dx.ant}、天気 ${dx.wx}）
自局（あなたが話しかける相手）: ${me.callsign}
段階: ${phase}
これまでのやり取り:
${log}

次の相手局の送信を、以下の文と同じ要点を保ったまま、実際の交信らしい自然な言い回しに書き換えてください。
含める要点は変えず（コール・RST・名前・QTH・設備・締めの符号）、長さは同じくらい。文だけを出力:
${baseText}`;
    try {
      const text = normalizeCw(await this._ask({ system: CW_RULES, user, maxTokens: 300 }));
      const ok = keepsEssentials(baseText, text, { myCall: me.callsign, dxCall: dx.callsign });
      if (!ok) return { text: baseText, source: 'rule', error: '要点が欠けたので規則の文に戻しました' };
      return { text, source: 'claude' };
    } catch (err) {
      this.lastError = String(err.message || err);
      return { text: baseText, source: 'rule', error: this.lastError };
    }
  }

  /**
   * 相談。状況と模範解答を渡し、日本語で短く答えてもらう。
   * @returns {Promise<{ text: string, source: 'claude'|'rule', error?: string }>}
   */
  async advise({ question, situation, expected, transcript }) {
    if (!this.configured) return { text: situation.join('\n'), source: 'rule' };
    const log = transcript.slice(-10).map((t) => `${t.dir === 'tx' ? '自局' : '相手'}: ${t.text}`).join('\n');
    const system = `あなたはアマチュア無線の CW 交信を教える先輩です。初心者の質問に、日本語で、
簡潔に（5 文以内）答えます。送る文の例は英大文字の CW の文で示します。
ラバースタンプ交信の型（呼び出し → 応答 → RST・名前・QTH → 了解と設備 → 73）に沿って助言します。`;
    const user = `状況:
${situation.join('\n')}
模範解答: ${expected}
これまでのやり取り:
${log}

質問: ${question || 'どう返事をすればよいですか'}`;
    try {
      const text = await this._ask({ system, user, maxTokens: 600, effort: 'medium' });
      return { text, source: 'claude' };
    } catch (err) {
      this.lastError = String(err.message || err);
      return { text: situation.join('\n'), source: 'rule', error: this.lastError };
    }
  }
}

/** モデルの出力を CW の文にそろえる（大文字・余計な行や引用符を落とす）。 */
export function normalizeCw(text) {
  return String(text || '')
    .split('\n').map((s) => s.trim()).filter(Boolean)[0]?.replace(/^["'`]+|["'`]+$/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim() || '';
}

/**
 * 言い換えた文に要点が残っているか。
 * 元の文にあったコール・RST・名前・QTH・締めの符号が、言い換え後にもあること。
 */
export function keepsEssentials(base, text, { myCall, dxCall }) {
  if (!text) return false;
  const b = parseSend(base, { myCall, dxCalls: [dxCall] });
  const t = parseSend(text, { myCall, dxCalls: [dxCall] });
  if (base.includes(myCall) && !text.includes(myCall)) return false;
  if (base.includes(dxCall) && !text.includes(dxCall)) return false;
  if (b.rst && t.rst !== b.rst) return false;
  if (b.name && t.name !== b.name) return false;
  if (b.qth && t.qth !== b.qth) return false;
  if (b.sk && !t.sk) return false;
  if (!b.sk && t.sk) return false;   // 勝手に交信を終えない
  if (b.agn && !t.agn) return false; // 聞き返しの意図を落とさない
  return true;
}
