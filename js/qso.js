// 交信シナリオの生成
//
// Responder は「相手局を演じる役」のインターフェースで、
// LocalResponder はそれを乱数と語彙表だけで実装したもの。
// 将来 LLM を相手役にする場合も、同じ buildScript(profile, options) を
// 実装したクラスを差し替えるだけでよい。

import {
  ANTENNAS, POWERS, RIGS, RST_POOL, WEATHER, NAMES, QTH,
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

/** 相手局のプロフィールをランダムに作る。 */
export function makeStation(options = {}) {
  const callsign = options.callsign || makeCallsign(options.region);
  const ja = isJapanese(callsign);
  return {
    callsign,
    name: pick(ja ? NAMES.JA : NAMES.DX),
    qth: pick(ja ? QTH.JA : QTH.DX),
    rig: pick(RIGS),
    pwr: pick(POWERS),
    ant: pick(ANTENNAS),
    wx: pick(WEATHER),
    temp: `${pickInt(-5, 35)}C`,
    rstGiven: pick(RST_POOL),   // 相手が自局に送るレポート
    rstGot: pick(RST_POOL),     // 自局が相手に送るレポート
  };
}

const TAIL = {
  short: ['<AR>', 'K'],
  normal: ['K'],
};

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
  const add = (side, text, fields) => {
    turns.push({ side, text: squash(text), fields: fields || [] });
  };

  if (mode === 'cq') {
    add('me', `CQ CQ CQ DE ${me.callsign} ${me.callsign} ${me.callsign} PSE K`);
    add('dx', `${me.callsign} DE ${dx.callsign} ${dx.callsign} K`, [
      field('callsign', dx.callsign),
    ]);
  } else {
    add('dx', `CQ CQ CQ DE ${dx.callsign} ${dx.callsign} ${dx.callsign} PSE K`, [
      field('callsign', dx.callsign),
    ]);
    add('me', `${dx.callsign} DE ${me.callsign} ${me.callsign} K`);
  }

  // 第 1 交換: 自局からレポート・名前・QTH を送る
  add('me', [
    `${dx.callsign} DE ${me.callsign}`,
    `= ${greet} OM TNX FER ${mode === 'cq' ? 'CALL' : 'CQ'}`,
    `= UR RST ${dx.rstGot} ${dx.rstGot}`,
    `= NAME ${me.name} ${me.name}`,
    `= QTH ${me.qth} ${me.qth}`,
    `= HW? ${dx.callsign} DE ${me.callsign} ${pick(TAIL[length] || TAIL.normal)}`,
  ].join(' '));

  // 第 2 交換: 相手からの返信。ここが聞き取りの山場になる
  const dxReply = [
    `${me.callsign} DE ${dx.callsign}`,
    `= R R FB ${me.name} ES TNX FER RPRT`,
    `= UR RST ${dx.rstGiven} ${dx.rstGiven}`,
    `= NAME ${dx.name} ${dx.name}`,
    `= QTH ${dx.qth} ${dx.qth}`,
  ];
  const dxFields = [
    field('rst', dx.rstGiven),
    field('name', dx.name),
    field('qth', dx.qth),
  ];

  if (length !== 'short') {
    dxReply.push(`= RIG ${dx.rig} PWR ${dx.pwr}`);
    dxReply.push(`= ANT ${dx.ant}`);
    dxFields.push(field('rig', dx.rig), field('pwr', dx.pwr), field('ant', dx.ant));
  }
  if (length === 'long') {
    dxReply.push(`= WX ${dx.wx} TEMP ${dx.temp}`);
    dxFields.push(field('wx', dx.wx));
  }
  dxReply.push(`= HW? ${me.callsign} DE ${dx.callsign} K`);
  add('dx', dxReply.join(' '), dxFields);

  // 第 3 交換: 自局の設備を返して締めに入る
  const meReply = [
    `${dx.callsign} DE ${me.callsign}`,
    `= R R FB ${dx.name} ALL SOLID`,
    `= MY RIG ${me.rig} PWR ${me.pwr}`,
    `= ANT ${me.ant}`,
  ];
  if (length === 'long') meReply.push(`= WX ${me.wx} HR`);
  meReply.push(`= TNX FER NICE QSO ES 73`);
  meReply.push(`= ${dx.callsign} DE ${me.callsign} K`);
  add('me', meReply.join(' '));

  // 終話
  add('dx', [
    `${me.callsign} DE ${dx.callsign}`,
    `= R FB TNX FER FB QSO ${me.name}`,
    `= ${pick(['HPE CUAGN', 'CUAGN SN', 'HPE CUAGN SOON'])}`,
    `= 73 ES GL`,
    `= ${me.callsign} DE ${dx.callsign} <SK>`,
  ].join(' '));

  add('me', `${dx.callsign} DE ${me.callsign} R TU 73 ES CUAGN <SK>`);

  return { station: dx, profile: me, mode, length, turns };
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
