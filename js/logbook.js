// ログ帳（本番の交信記録）
//
// 練習の成績（stats.js）とは別物。実際の交信を 1 件ずつ残す台帳で、
// HAMLOG などの一般的なログソフトでできることを一通りそろえる:
// 登録・編集・削除、検索、交信歴（同じ局と何回・前回いつ）、
// JCC/JCG 検索、ADIF / CSV の入出力、集計。

import { JCC_TSV } from './jccdata.js';
import { JCC_GEO_TSV } from './jccgeo.js';

const STORE_KEY = 'cwtraining.logbook.v1';

// ───────── JCC / JCG 検索 ─────────

let jccTable = null;

/** 同梱データを表に起こす。桁数が種類を表す: 2=都道府県, 4=市, 5=郡, 6=区。 */
export function jccEntries() {
  if (jccTable) return jccTable;
  const kinds = { 2: '都道府県', 4: 'JCC', 5: 'JCG', 6: '区' };
  jccTable = JCC_TSV.split('\n').map((line) => {
    const [code, name, roman, gone] = line.split('\t');
    return { code, name, roman: roman || '', gone: !!gone, kind: kinds[code.length] || '' };
  });
  return jccTable;
}

/**
 * 番号または名前で引く。番号は前方一致、名前・ローマ字は部分一致。
 * 「さっぽろ」のような読みは持っていないので、漢字かローマ字で。
 */
export function jccSearch(query, limit = 30) {
  const q = String(query || '').trim();
  if (!q) return [];
  const table = jccEntries();
  if (/^\d+$/.test(q)) {
    return table.filter((e) => e.code.startsWith(q)).slice(0, limit);
  }
  const lower = q.toLowerCase();
  return table
    .filter((e) => e.name.includes(q) || (e.roman && e.roman.toLowerCase().includes(lower)))
    .slice(0, limit);
}

// ───────── 現在地から JCC を推定する ─────────

let geoTable = null;

function geoPoints() {
  if (geoTable) return geoTable;
  const byCode = new Map(jccEntries().map((e) => [e.code, e]));
  geoTable = JCC_GEO_TSV.split('\n').map((line) => {
    const [code, lat, lon] = line.split('\t');
    return { code, lat: Number(lat), lon: Number(lon), entry: byCode.get(code) };
  }).filter((p) => p.entry);
  return geoTable;
}

/** 2 点間の距離（km）。ハバースイン公式。 */
function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 緯度経度に近い市・郡（と東京特別区）を距離順に返す。
 *
 * 収録している座標は各市郡の代表点なので、境界近くでは隣が先に出ることが
 * ある。「これで決める」のではなく「近い候補から選ぶ」ための並びと考えること。
 * 政令指定都市の市が近いときは、その市の区番号から選べるように区も添える。
 * @returns {{ code, name, kind, km, wards?: {code,name}[] }[]}
 */
export function nearestJcc(lat, lon, limit = 6) {
  const sorted = geoPoints()
    .map((p) => ({ ...p, km: distanceKm(lat, lon, p.lat, p.lon) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
  const all = jccEntries();
  return sorted.map((p) => {
    const wards = p.code.length === 4
      ? all.filter((e) => e.code.length === 6 && e.code.startsWith(p.code) && !e.gone)
      : [];
    return {
      code: p.code, name: p.entry.name, kind: p.entry.kind,
      km: Math.round(p.km * 10) / 10,
      wards: wards.length ? wards.map((w) => ({ code: w.code, name: w.name })) : undefined,
    };
  });
}

// ───────── 保存・読み出し ─────────

export function loadLogbook() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data?.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

export function saveLogbook(entries) {
  localStorage.setItem(STORE_KEY, JSON.stringify({ entries }));
}

let seq = 0;

/**
 * 1 交信分のエントリを作る。ts は UTC の ISO 文字列で持つ
 * （ADIF が UTC を要求するのと、時差の解釈を保存時に固定しないため）。
 */
export function newEntry(fields = {}) {
  seq += 1;
  return {
    id: `${Date.now().toString(36)}-${seq}`,
    ts: fields.ts || new Date().toISOString(),
    call: (fields.call || '').toUpperCase().trim(),
    freq: fields.freq || '',            // MHz。文字列のまま持つ（7.010 の末尾 0 を守る）
    band: fields.band || bandFromFreq(fields.freq),
    mode: fields.mode || 'CW',
    rstS: fields.rstS || '',
    rstR: fields.rstR || '',
    name: fields.name || '',
    qth: fields.qth || '',
    jcc: fields.jcc || '',
    qslS: !!fields.qslS,
    qslR: !!fields.qslR,
    notes: fields.notes || '',
    source: fields.source || 'manual',  // manual | support
    transcript: fields.transcript || null,  // 交信サポートの受信・送信記録
  };
}

// ───────── バンド ─────────

const BANDS = [
  [1.8, 2.0, '1.9MHz', '160m'],
  [3.5, 3.8, '3.5MHz', '80m'],
  [7.0, 7.3, '7MHz', '40m'],
  [10.1, 10.15, '10MHz', '30m'],
  [14.0, 14.35, '14MHz', '20m'],
  [18.0, 18.2, '18MHz', '17m'],
  [21.0, 21.45, '21MHz', '15m'],
  [24.8, 25.0, '24MHz', '12m'],
  [28.0, 29.7, '28MHz', '10m'],
  [50, 54, '50MHz', '6m'],
  [144, 148, '144MHz', '2m'],
  [430, 440, '430MHz', '70cm'],
  [1200, 1300, '1200MHz', '23cm'],
  [2400, 2450, '2400MHz', '13cm'],
];

/** 周波数（MHz）からバンド表示を決める。範囲外は空。 */
export function bandFromFreq(freq) {
  const f = Number(freq);
  if (!f) return '';
  const hit = BANDS.find(([lo, hi]) => f >= lo && f <= hi);
  return hit ? hit[2] : '';
}

/** ADIF のバンド表記（40m など）。 */
export function adifBand(band) {
  const hit = BANDS.find((b) => b[2] === band);
  return hit ? hit[3] : '';
}

export function bandFromAdif(adif) {
  const hit = BANDS.find((b) => b[3] === String(adif || '').toLowerCase());
  return hit ? hit[2] : '';
}

export const BAND_LABELS = BANDS.map((b) => b[2]);

// ───────── 検索・交信歴・集計 ─────────

/** 一覧の絞り込み。text はコール・名前・QTH・JCC・備考を横断で見る。 */
export function searchLog(entries, { text = '', band = '', mode = '' } = {}) {
  const q = text.trim().toUpperCase();
  return entries.filter((e) => {
    if (band && e.band !== band) return false;
    if (mode && e.mode !== mode) return false;
    if (!q) return true;
    return [e.call, e.name, e.qth, e.jcc, e.notes]
      .some((v) => String(v || '').toUpperCase().includes(q));
  });
}

/** 同じコールサインとの過去の交信。新しい順。 */
export function history(entries, call) {
  const c = String(call || '').toUpperCase().trim();
  if (!c) return [];
  return entries.filter((e) => e.call === c).sort((a, b) => b.ts.localeCompare(a.ts));
}

export function logStats(entries) {
  const byBand = {};
  const byMode = {};
  const calls = new Set();
  const jcc = new Set();
  const jcg = new Set();
  let qslR = 0;
  for (const e of entries) {
    if (e.band) byBand[e.band] = (byBand[e.band] || 0) + 1;
    if (e.mode) byMode[e.mode] = (byMode[e.mode] || 0) + 1;
    if (e.call) calls.add(e.call);
    // 区番号（6 桁）は市としても数える（区で交信できていれば JCC は埋まる）
    const code = String(e.jcc || '').trim();
    if (/^\d{4}$/.test(code)) jcc.add(code);
    else if (/^\d{6}$/.test(code)) { jcc.add(code.slice(0, 4)); }
    else if (/^\d{5}$/.test(code)) jcg.add(code);
    if (e.qslR) qslR += 1;
  }
  return { total: entries.length, calls: calls.size, byBand, byMode,
    jcc: jcc.size, jcg: jcg.size, qslR };
}

// ───────── ADIF ─────────

const adifField = (name, value) => {
  const v = String(value ?? '');
  return v ? `<${name}:${[...v].length ? new TextEncoder().encode(v).length : 0}>${v} ` : '';
};

/** ADIF 3 形式で書き出す。日時は UTC。JCC は独自フィールドで添える。 */
export function toAdif(entries) {
  const head = 'CW交信トレーニング ログ帳\n<ADIF_VER:5>3.1.4\n<PROGRAMID:10>CWTraining\n<EOH>\n';
  const records = entries.map((e) => {
    const d = new Date(e.ts);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
    return adifField('CALL', e.call)
      + adifField('QSO_DATE', date)
      + adifField('TIME_ON', time)
      + adifField('BAND', adifBand(e.band))
      + adifField('FREQ', e.freq)
      + adifField('MODE', e.mode)
      + adifField('RST_SENT', e.rstS)
      + adifField('RST_RCVD', e.rstR)
      + adifField('NAME', e.name)
      + adifField('QTH', e.qth)
      + adifField('APP_CWTRAINING_JCC', e.jcc)
      + adifField('QSL_SENT', e.qslS ? 'Y' : '')
      + adifField('QSL_RCVD', e.qslR ? 'Y' : '')
      + adifField('NOTES', e.notes)
      + '<EOR>\n';
  }).join('');
  return head + records;
}

/** ADIF を読み込む。バイト数指定は当てにせず、次のタグまでを値として拾う。 */
export function fromAdif(text) {
  const [, body = text] = String(text).split(/<EOH>/i);
  const out = [];
  for (const rec of body.split(/<EOR>/i)) {
    const fields = {};
    const re = /<([A-Za-z_0-9]+):\d+(?::[^>]*)?>([^<]*)/g;
    let m;
    while ((m = re.exec(rec))) fields[m[1].toUpperCase()] = m[2].trim();
    if (!fields.CALL) continue;
    const date = fields.QSO_DATE || '';
    const time = (fields.TIME_ON || '0000').padEnd(6, '0');
    const ts = date
      ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`
      : new Date().toISOString();
    out.push(newEntry({
      ts,
      call: fields.CALL,
      freq: fields.FREQ || '',
      band: fields.FREQ ? bandFromFreq(fields.FREQ) : bandFromAdif(fields.BAND),
      mode: fields.MODE || 'CW',
      rstS: fields.RST_SENT || '',
      rstR: fields.RST_RCVD || '',
      name: fields.NAME || '',
      qth: fields.QTH || '',
      jcc: fields.APP_CWTRAINING_JCC || fields.JCC || '',
      qslS: fields.QSL_SENT === 'Y',
      qslR: fields.QSL_RCVD === 'Y',
      notes: fields.NOTES || fields.COMMENT || '',
    }));
  }
  return out;
}

// ───────── CSV ─────────

const CSV_HEADER = ['日時(UTC)', 'コール', '周波数MHz', 'バンド', 'モード',
  'RST送', 'RST受', '名前', 'QTH', 'JCC', 'QSL送', 'QSL受', '備考', '交信記録'];

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function toCsv(entries) {
  const rows = entries.map((e) => [
    e.ts, e.call, e.freq, e.band, e.mode, e.rstS, e.rstR, e.name, e.qth, e.jcc,
    e.qslS ? 'Y' : '', e.qslR ? 'Y' : '', e.notes,
    e.transcript ? JSON.stringify(e.transcript) : '',
  ].map(csvCell).join(','));
  return [CSV_HEADER.join(','), ...rows].join('\n') + '\n';
}

/** 引用符と引用符内の改行に対応した最小の CSV パーサ。 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

export function fromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  // 見出し行はあってもなくても読めるように、1 行目がコール欄に日時らしき
  // ものを持つかで判断する
  const start = /^\d{4}-\d{2}/.test(rows[0][0]) ? 0 : 1;
  const out = [];
  for (const r of rows.slice(start)) {
    if (!r[1]) continue;
    let transcript = null;
    try { transcript = r[13] ? JSON.parse(r[13]) : null; } catch { transcript = null; }
    out.push(newEntry({
      ts: r[0] || new Date().toISOString(),
      call: r[1], freq: r[2] || '', band: r[3] || bandFromFreq(r[2]),
      mode: r[4] || 'CW', rstS: r[5] || '', rstR: r[6] || '',
      name: r[7] || '', qth: r[8] || '', jcc: r[9] || '',
      qslS: r[10] === 'Y', qslR: r[11] === 'Y', notes: r[12] || '',
      transcript,
    }));
  }
  return out;
}
