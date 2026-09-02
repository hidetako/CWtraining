// 交信シナリオの生成
//
// Responder は「相手局を演じる役」のインターフェースで、
// LocalResponder はそれを乱数と語彙表だけで実装したもの。
// 将来 LLM を相手役にする場合も、同じ buildScript(profile, options) を
// 実装したクラスを差し替えるだけでよい。

import {
  ANTENNAS, POWERS, RIGS, RST_POOL, WEATHER, NAMES, QTH,
  SOLID_COPY, GLAD_PHRASES,
  greetingForHour, isJapanese, makeCallsign, pick, pickInt,
} from './data.js';

/** 受信内容の採点対象となる項目の表示名。 */
export const FIELD_LABELS = {
  callsign: '相手局コールサイン',
  rst: 'RST（自局が受けたレポート）',
  name: '相手の名前',
  qth: '相手の QTH',
  rig: 'リグ',
  pwr: '出力',
  ant: 'アンテナ',
  wx: '天気',
};

/**
 * 各欄に何を入れるのかを、入力欄の中に薄く出す。
 * 本文を丸ごと入れてしまう間違いが起きやすいので、
 * 「その項目だけ」と分かる書き方にしている。
 */
export const FIELD_HINTS = {
  callsign: '聞き取ったコールサインを入力',
  rst: '聞き取った RST を入力（599 など）',
  name: '聞き取った名前を入力',
  qth: '聞き取った QTH を入力',
  rig: '聞き取ったリグ名を入力',
  pwr: '聞き取った出力を入力',
  ant: '聞き取ったアンテナを入力',
  wx: '聞き取った天気を入力',
};

/** 相手局のプロフィールをランダムに作る。 */
/**
 * 天気に見合う気温を返す。
 * 天気と気温を別々に振ると「SNOW ES TEMP 26C」のような台本ができてしまう。
 */
function tempFor(wx) {
  // 語として照合する。部分一致だと CLDY（曇り）が CLD（寒い）に当たる
  const words = ` ${wx} `;
  const has = (list) => list.some((k) => words.includes(` ${k} `));
  if (has(['SNOW', 'BLIZZARD', 'SLEET', 'HAIL', 'CHILLY', 'CLD'])) return pickInt(-8, 6);
  if (has(['HOT', 'MUGGY', 'STICKY', 'HUMID'])) return pickInt(27, 36);
  if (has(['WARM', 'SUNNY', 'FINE', 'FAIR', 'CLEAR'])) return pickInt(15, 28);
  return pickInt(5, 22);
}

export function makeStation(options = {}) {
  const callsign = options.callsign || makeCallsign(options.region);
  const ja = isJapanese(callsign);
  const wx = pick(WEATHER);
  return {
    callsign,
    name: pick(ja ? NAMES.JA : NAMES.DX),
    qth: pick(ja ? QTH.JA : QTH.DX),
    rig: pick(RIGS),
    pwr: pick(POWERS),
    ant: pick(ANTENNAS),
    wx,
    temp: `${tempFor(wx)}C`,
    // アンテナの地上高。設備の紹介に「10 MTRS UP GND」を添えるのに使う
    antHeight: pickInt(6, 20),
    rstGiven: pick(RST_POOL),   // 相手が自局に送るレポート
    rstGot: pick(RST_POOL),     // 自局が相手に送るレポート
  };
}

const TAIL = {
  short: ['<AR>', 'K'],
  normal: ['K'],
};

/**
 * レポートに添える一言。取りにくかった理由を伝えるのが実際の交信。
 * 599 のような良好なレポートには付けない（言うことが無いため）。
 */
function rstNote(rst) {
  if (/^5[89]9$/.test(rst) || rst === '5NN') return '';
  return pick(['', '', ' WID QSB', ' WID QRM', ' WID QRN', ' BUT SOLID CPI']);
}

/**
 * 「どのくらい取れたか」の言い方。自分が相手に出したレポートと辻褄を合わせる。
 * 599 を送っておいて「混信を突き抜けて届いている」では話が合わない。
 */
function copyNotes(rstIGave) {
  const good = /^5[89]9$/.test(rstIGave) || rstIGave === '5NN';
  return good
    ? ['ALL SOLID', 'SOLID CPI', 'SOLID CPI NW', 'UR SIG LOUD ES CLR']
    : ['GUD CPI AGN', 'CUTTING THRU QRM', 'ALL CPI 100 PERCENT', 'SOLID CPI'];
}

/** 設備の言い方。「MY RIG …」だけでなく、実際に使われる形も混ぜる。 */
function rigLine(st) {
  return pick([
    `MY RIG ${st.rig} PWR ${st.pwr}`,
    `RIG HR IS ${st.rig} ES PWR ${st.pwr}`,
    `RIG ${st.rig} = AM RNG ${st.pwr}`,
    `MY RIG ${st.rig} = RNG ${st.pwr} BAREFOOT`,
  ]);
}

/**
 * アンテナの言い方。地上高を添えるのは実際の交信でよくある。
 * 値そのもの（ANT の答え）は先頭に置き、高さは = で区切った別の文にする。
 * 聞き取り練習の答えはアンテナ名だけなので、続けて書くと紛らわしい。
 */
function antLine(st) {
  // 地上高は相手局だけが持つ（自局の設定に高さの項目が無いため）
  const h = st.antHeight ? pick([
    '', '',
    ` = ${st.antHeight} MTRS UP GND`,
    ` = ${st.antHeight}M H`,
    ` = ABT ${st.antHeight} MTRS UP GND`,
  ]) : '';
  return `ANT ${st.ant}${h}`;
}

/** 天気の言い方。気温には ABT を添えて、数値をぼかす形を耳に入れる。 */
function wxLine(st) {
  // 気温も相手局だけが持つ。無いときは天気だけを言う
  if (!st.temp) return pick([`WX ${st.wx} HR`, `WX HR ${st.wx}`, `HR WX ${st.wx}`]);
  const temp = st.temp.startsWith('-')
    ? `MINUS ${st.temp.slice(1, -1)} DEG C`
    : `ABT ${st.temp}`;
  return pick([
    `WX ${st.wx} TEMP ${temp}`,
    `WX HR ${st.wx} ES TEMP ${temp}`,
    `HR WX ${st.wx} = TEMP ${temp}`,
  ]);
}

/**
 * ラバースタンプ QSO の台本を組み立てる。
 *
 * @param {object} profile  自局の情報 { callsign, name, qth, rig, pwr, ant, wx }
 * @param {object} options  { mode: 'cq'|'answer', length: 'short'|'normal'|'long', station, hour }
 * @returns {{ station: object, turns: Array }}
 */
export function buildScript(profile, options = {}) {
  const me = normalizeProfile(profile);
  const dx = options.station || makeStation(options);
  const mode = options.mode === 'answer' ? 'answer' : 'cq';
  const length = options.length || 'normal';
  const hour = options.hour ?? new Date().getHours();
  const greet = greetingForHour(hour);

  const turns = [];
  const add = (side, text, fields, phase, extra) => {
    turns.push({ side, text: squash(text), fields: fields || [], phase, ...extra });
  };

  if (mode === 'cq') {
    add('me', `CQ CQ CQ DE ${me.callsign} ${me.callsign} ${me.callsign} PSE K`, [], 'cq');
    add('dx', `${me.callsign} DE ${dx.callsign} ${dx.callsign} K`, [
      field('callsign', dx.callsign),
    ], 'pickup');
  } else {
    add('dx', `CQ CQ CQ DE ${dx.callsign} ${dx.callsign} ${dx.callsign} PSE K`, [
      field('callsign', dx.callsign),
    ], 'pickup');
    add('me', `${dx.callsign} DE ${me.callsign} ${me.callsign} K`, [], 'call');
  }

  // 第 1 交換: 自局からレポート・名前・QTH を送る
  add('me', [
    `${dx.callsign} DE ${me.callsign}`,
    `= ${greet} ${pick(['DR OM', 'OM', 'DR OM'])} TNX FER ${mode === 'cq' ? 'CALL' : 'CQ'}`,
    `= ${pick(GLAD_PHRASES)}`,
    `= UR RST ${dx.rstGot} ${dx.rstGot}${rstNote(dx.rstGot)}`,
    `= NAME ${me.name} ${me.name}`,
    `= QTH ${me.qth} ${me.qth}`,
    `= HW? ${dx.callsign} DE ${me.callsign} ${pick(TAIL[length] || TAIL.normal)}`,
  ].join(' '), [], 'exchange1');

  // 第 2 交換: 相手からの返信。ここが聞き取りの山場になる
  const dxReply = [
    `${me.callsign} DE ${dx.callsign}`,
    `= R R ${pick(['FB', 'FB', 'VFB', 'UFB'])} ${me.name} ES TNX FER RPRT`,
    `= UR RST ${dx.rstGiven} ${dx.rstGiven}${rstNote(dx.rstGiven)}`,
    `= NAME ${dx.name} ${dx.name}`,
    `= QTH ${dx.qth} ${dx.qth}`,
  ];
  const dxFields = [
    field('rst', dx.rstGiven),
    field('name', dx.name),
    field('qth', dx.qth),
  ];

  if (length !== 'short') {
    dxReply.push(`= ${rigLine(dx)}`);
    dxReply.push(`= ${antLine(dx)}`);
    dxFields.push(field('rig', dx.rig), field('pwr', dx.pwr), field('ant', dx.ant));
  }
  if (length === 'long') {
    dxReply.push(`= ${wxLine(dx)}`);
    dxFields.push(field('wx', dx.wx));
  }
  dxReply.push(`= HW? ${me.callsign} DE ${dx.callsign} K`);
  add('dx', dxReply.join(' '), dxFields, 'exchange2');

  // 第 3 交換: 自局の設備を返して締めに入る
  const meReply = [
    `${dx.callsign} DE ${me.callsign}`,
    `= R R FB ${dx.name} ${pick(copyNotes(dx.rstGot))}`,
    `= ${rigLine(me)}`,
    `= ${antLine(me)}`,
  ];
  if (length === 'long') meReply.push(`= ${wxLine(me)}`);
  meReply.push(`= ${pick(['TNX FER NICE QSO ES 73', 'MNI TNX FER FB QSO ES 73',
    'NW QRU SA 73', 'WL NW QRU = TNX FER QSO ES 73'])}`);
  meReply.push(`= ${dx.callsign} DE ${me.callsign} K`);
  add('me', meReply.join(' '), [], 'exchange2');

  // 終話
  add('dx', [
    `${me.callsign} DE ${dx.callsign}`,
    `= R FB TNX FER FB QSO ${me.name}`,
    `= ${pick(['HPE CUAGN', 'CUAGN SN', 'BCNU', 'I WL CU VY SN', 'HPE CU AGN SN'])}`,
    `= 73 ES GL`,
    `= ${me.callsign} DE ${dx.callsign} <SK>`,
  ].join(' '), [], 'close');

  add('me', `${dx.callsign} DE ${me.callsign} R TU 73 ES ${
    pick(['CUAGN', 'BCNU', 'CUAGN SN'])} <SK>`, [], 'close');

  const script = { station: dx, profile: me, mode, length, turns };
  applyReaction(script, options.reaction);
  return script;
}

/**
 * 相手の反応にゆらぎを入れる。
 * 型どおりに進むだけでなく、聞き返されたり取り違えられたりする状況を
 * 割り込ませることで、実際の交信に近づける。
 */
export function applyReaction(script, reaction) {
  const key = reaction === 'random' ? pick(REACTION_KEYS) : reaction;
  if (!key || key === 'normal' || !REACTIONS[key]) {
    script.reaction = 'normal';
    return script;
  }

  script.reaction = key;
  REACTIONS[key](script);
  return script;
}

/** 割り込みを入れる位置（第 1 交換の直後）を探す。 */
function afterFirstExchange(script) {
  const i = script.turns.findIndex((t) => t.side === 'me' && t.phase === 'exchange1');
  return i < 0 ? 1 : i + 1;
}

const REACTIONS = {
  /** 名前だけ取れなかったので聞き返してくる。 */
  nameQuery(script) {
    const { profile: me, station: dx } = script;
    const at = afterFirstExchange(script);
    script.turns.splice(at, 0,
      {
        side: 'dx',
        text: `${me.callsign} DE ${dx.callsign} PSE NAME AGN? K`,
        fields: [],
        phase: 'exchange1',
        reaction: 'nameQuery',
      },
      {
        side: 'me',
        text: `${dx.callsign} DE ${me.callsign} NAME ${me.name} ${me.name} ${me.name} K`,
        fields: [],
        phase: 'exchange1',
      });
  },

  /** 速すぎて取れないので、ゆっくり送り直してほしい。 */
  qrs(script) {
    const { profile: me, station: dx } = script;
    const at = afterFirstExchange(script);
    script.turns.splice(at, 0,
      {
        side: 'dx',
        text: `${me.callsign} DE ${dx.callsign} QRS PSE QRS K`,
        fields: [],
        phase: 'exchange1',
        reaction: 'qrs',
      },
      {
        side: 'me',
        text: `${dx.callsign} DE ${me.callsign} R QRS OK = NAME ${me.name} ${me.name}`
          + ` = QTH ${me.qth} ${me.qth} = HW? K`,
        fields: [],
        phase: 'exchange1',
        slow: true,
      });
  },

  /** こちらのコールサインを取り違えている。訂正が必要。 */
  wrongCall(script) {
    const { profile: me, station: dx } = script;
    const wrong = corruptCall(me.callsign);
    const at = afterFirstExchange(script);
    script.turns.splice(at, 0,
      {
        side: 'dx',
        text: `${wrong} DE ${dx.callsign} R FB = UR RST 599 = HW? K`,
        fields: [],
        phase: 'exchange1',
        reaction: 'wrongCall',
        wrongCall: wrong,
      },
      {
        side: 'me',
        text: `${dx.callsign} DE ${me.callsign} = MY CALL ${me.callsign} ${me.callsign}`
          + ` = ${me.callsign} K`,
        fields: [],
        phase: 'exchange1',
      });
  },

  /** 呼び出しを取り切れず、もう一度名乗ってほしい。 */
  qrz(script) {
    const { profile: me, station: dx } = script;
    // 相手が応答してくる直前に差し込む
    const i = script.turns.findIndex((t) => t.side === 'dx' && t.phase === 'pickup');
    const at = i < 0 ? 1 : i;
    script.turns.splice(at, 0,
      {
        side: 'dx',
        text: `QRZ? QRZ? DE ${dx.callsign} K`,
        fields: [],
        phase: 'pickup',
        reaction: 'qrz',
      },
      {
        side: 'me',
        text: `${dx.callsign} DE ${me.callsign} ${me.callsign} ${me.callsign} K`,
        fields: [],
        phase: 'call',
      });
  },

  /** 手短に終わらせたい。設備の話は省いて締めに向かう。 */
  hurried(script) {
    const { profile: me, station: dx } = script;
    const at = afterFirstExchange(script);
    script.turns.splice(at, 0,
      {
        side: 'dx',
        text: `${me.callsign} DE ${dx.callsign} R UR RST ${dx.rstGiven} `
          + `= NAME ${dx.name} = QTH ${dx.qth} = SRI QRU PSE 73 K`,
        fields: [
          field('rst', dx.rstGiven),
          field('name', dx.name),
          field('qth', dx.qth),
        ],
        phase: 'close',
        reaction: 'hurried',
      },
      {
        side: 'me',
        text: `${dx.callsign} DE ${me.callsign} R R TNX FER QSO 73 ES CUAGN <SK>`,
        fields: [],
        phase: 'close',
      });
    // 締めに入るので、残りの通常ターンは落とす
    script.turns.length = at + 2;
  },
};

const REACTION_KEYS = ['normal', 'normal', 'nameQuery', 'qrs', 'wrongCall', 'qrz', 'hurried'];

export const REACTION_LABELS = {
  normal: '型どおり（ゆらぎなし）',
  random: 'おまかせ（毎回変わる）',
  nameQuery: '名前を聞き返される',
  qrs: 'ゆっくり送るよう頼まれる',
  wrongCall: 'コールサインを取り違えられる',
  qrz: '呼び出しを取ってもらえない',
  hurried: '手短に切り上げたいと言われる',
};

/** コールサインの 1 文字を変えて、取り違えられた形を作る。 */
function corruptCall(call) {
  const chars = String(call).split('');
  const positions = chars
    .map((c, i) => (/[A-Z]/.test(c) ? i : -1))
    .filter((i) => i > 1);
  if (!positions.length) return call;
  const i = pick(positions);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((c) => c !== chars[i]);
  chars[i] = pick(alphabet);
  return chars.join('');
}

function field(key, value) {
  return { key, label: FIELD_LABELS[key] || key, value: String(value) };
}

function squash(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function normalizeProfile(profile = {}) {
  return {
    callsign: (profile.callsign || 'JA1ABC').toUpperCase(),
    name: (profile.name || 'TARO').toUpperCase(),
    qth: (profile.qth || 'TOKYO').toUpperCase(),
    rig: (profile.rig || 'IC-7300').toUpperCase(),
    pwr: (profile.pwr || '50W').toUpperCase(),
    ant: (profile.ant || 'DP').toUpperCase(),
    wx: (profile.wx || 'FINE').toUpperCase(),
  };
}

/** 乱数だけで相手局を演じる既定の Responder。 */
export class LocalResponder {
  constructor(options = {}) {
    this.options = options;
  }

  get label() {
    return 'ローカル生成';
  }

  async buildScript(profile, options = {}) {
    return buildScript(profile, { ...this.options, ...options });
  }
}

/**
 * 解答の採点。大文字化して空白・記号のゆれを吸収したうえで比較する。
 * 599 と 5NN、O と 0 の混同はカット・ナンバーとして許容する。
 */
export function gradeField(expected, actual) {
  const norm = (s) => String(s ?? '')
    .toUpperCase()
    .replace(/[\s\-_/.]/g, '')
    .replace(/5NN/g, '599')
    .replace(/\bT\b/g, '0');

  const e = norm(expected);
  const a = norm(actual);
  if (!a) return { correct: false, empty: true, distance: e.length };

  const distance = levenshtein(e, a);
  return { correct: distance === 0, empty: false, distance };
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}
