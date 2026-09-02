// ラバースタンプ交信の言い回し
//
// 型どおりの交換を並べるだけでは、決まり文句の羅列にしかならない。
// 「およそ」「嬉しい」「完全に取れている」を挟めるようになると会話に近づく。
// ここでは、その語彙が実際に台本へ現れることと、意味が引けることを見る。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);

// 台本をたくさん作って、出てくる語を集める
const sample = await page.evaluate(() => {
  const me = {
    callsign: 'JA1ABC', name: 'TARO', qth: 'TOKYO',
    rig: 'IC-7300', pwr: '50W', ant: 'DP', wx: 'FINE',
  };
  const scripts = [];
  for (let i = 0; i < 240; i++) {
    scripts.push(window.__cw.buildScript(me, {
      mode: i % 2 ? 'answer' : 'cq', length: 'long', reaction: 'none',
    }));
  }
  const words = new Set();
  const stations = [];
  for (const s of scripts) {
    for (const t of s.turns) for (const w of t.text.split(/\s+/)) words.add(w);
    stations.push({ wx: s.station.wx, temp: s.station.temp });
  }
  return { words: [...words], stations, one: scripts[0].turns.map((t) => `${t.side}: ${t.text}`) };
});
console.log('台本の例:\n' + sample.one.join('\n'));

const has = (w) => sample.words.includes(w);

// ── 挨拶と気持ち ──────────────────────────────────
ok('DR OM で呼びかける', has('DR'), '');
ok('嬉しさを伝える語が出る', has('GLD') || has('PSED'), '');
ok('UFB / VFB が出る', has('UFB') || has('VFB'), '');

// ── どのくらい取れたかを伝える ────────────────────
ok('SOLID が出る', has('SOLID'));
ok('CPI が出る', has('CPI'));
ok('LOUD / CLR / THRU が出る', has('CLR') || has('THRU'), '');

// ── 設備の紹介 ────────────────────────────────────
ok('RNG（運用中）が出る', has('RNG'));
ok('BAREFOOT が出る', has('BAREFOOT'));
ok('地上高を添える', has('GND') || has('MTRS'), '');
ok('ABT で数値をぼかす', has('ABT'));

// ── 締めくくり ────────────────────────────────────
ok('BCNU が出る', has('BCNU'));
ok('QRU で話題が尽きたと伝える', has('QRU'));
ok('SA / WL で話を切り替える', has('SA') || has('WL'), '');

// ── 天気の言い方が増えている ──────────────────────
const wxSeen = new Set(sample.stations.map((s) => s.wx));
console.log('出た天気:', [...wxSeen].sort().join(' / '));
ok('天気の言い方が 12 通り以上出る', wxSeen.size >= 12, `${wxSeen.size} 通り`);
ok('海外で使う言い方も出る',
  ['OVERCAST', 'MUGGY', 'HAZY', 'BREEZY', 'CHILLY', 'DULL', 'STICKY', 'SLEET',
    'BLIZZARD', 'SHOWER', 'FAIR', 'MOSTLY SUNNY', 'PARTLY SUNNY']
    .some((w) => wxSeen.has(w)),
  [...wxSeen].join(','));

// ── 天気と気温の辻褄が合う ────────────────────────
// 天気と気温を別々に振ると「SNOW ES TEMP 26C」のような台本ができる
const cold = sample.stations.filter((s) => /^(SNOW|BLIZZARD|SLEET|HAIL|CHILLY|CLD)$/.test(s.wx));
const hot = sample.stations.filter((s) => /^(HOT|MUGGY|STICKY|HUMID)$/.test(s.wx));
const degC = (s) => parseInt(s.temp, 10);
console.log('寒い天気:', cold.length, '件 最高', cold.length ? Math.max(...cold.map(degC)) : '—',
  '/ 暑い天気:', hot.length, '件 最低', hot.length ? Math.min(...hot.map(degC)) : '—');
ok('雪やみぞれのときは寒い', cold.every((s) => degC(s) <= 10),
  JSON.stringify(cold.filter((s) => degC(s) > 10).slice(0, 3)));
ok('蒸し暑いときは暑い', hot.every((s) => degC(s) >= 25),
  JSON.stringify(hot.filter((s) => degC(s) < 25).slice(0, 3)));
// CLDY（曇り）を CLD（寒い）と取り違えていないこと
const cldy = sample.stations.filter((s) => s.wx === 'CLDY');
ok('曇りを寒いと取り違えない', !cldy.length || cldy.some((s) => degC(s) > 10),
  JSON.stringify(cldy.slice(0, 3)));

// ── 取れ具合の言い方がレポートと合う ──────────────
// 599 を送っておいて「混信を突き抜けて届いている」では話が合わない
const mismatch = await page.evaluate(() => {
  const me = { callsign: 'JA1ABC', name: 'TARO', qth: 'TOKYO', rig: 'IC-7300', pwr: '50W', ant: 'DP', wx: 'FINE' };
  const bad = [];
  for (let i = 0; i < 300; i++) {
    const s = window.__cw.buildScript(me, { mode: 'cq', length: 'normal', reaction: 'none' });
    const good = /^5[89]9$/.test(s.station.rstGot) || s.station.rstGot === '5NN';
    const line = s.turns.find((t) => t.side === 'me' && /R R FB/.test(t.text))?.text ?? '';
    if (good && /CUTTING THRU QRM|100 PERCENT/.test(line)) bad.push([s.station.rstGot, line.slice(0, 60)]);
  }
  return bad;
});
ok('良いレポートに混信の断りを付けない', mismatch.length === 0,
  JSON.stringify(mismatch.slice(0, 2)));

// ── 出てくる語の意味が引ける ──────────────────────
// 聞こえても意味が出ないのでは、語彙を増やした意味がない
const meanings = await page.evaluate((words) => {
  const out = {};
  for (const w of words) out[w] = window.__cw.lookupTerm(w)?.ja ?? null;
  return out;
}, ['ABT', 'AGN', 'BCNU', 'BTU', 'BTW', 'C', 'CFM', 'CL', 'DR', 'GLD', 'MOM',
  'MNI', 'NIL', 'PSED', 'SA', 'SN', 'SRI', 'UFB', 'VFB', 'WL', 'WUD', 'RNG',
  'SOLID', 'CPI', 'CLR', 'THRU', 'BAREFOOT', 'DP', 'DIPOLE', 'YAGI', 'VERT',
  'VERTICAL', 'GP', 'LW', 'GND', 'MTRS',
  'OVERCAST', 'MUGGY', 'HAZY', 'BREEZY', 'CHILLY', 'DULL', 'STICKY',
  'SLEET', 'HAIL', 'BLIZZARD', 'SHOWER', 'FAIR', 'CALM', 'MOSTLY', 'PARTLY',
  'QRL', 'QSL', 'QSB', 'QRM', 'QRN', 'QRU', 'QRZ', 'QTH']);
const missing = Object.entries(meanings).filter(([, ja]) => !ja).map(([w]) => w);
console.log('意味が引けない語:', missing.length ? missing.join(' ') : 'なし');
ok('依頼された語すべてに意味がある', missing.length === 0, missing.join(' '));

// ── 略語集からも引ける ────────────────────────────
await page.click('.tab[data-panel="glossary"]');
await page.waitForTimeout(300);
for (const [q, want] of [['OVERCAST', '本曇り'], ['SOLID', '完全'], ['RNG', '運用中']]) {
  await page.fill('#glossary-search', q);
  await page.waitForTimeout(200);
  const first = (await page.textContent('#glossary-list .gloss-item')) ?? '';
  ok(`略語集で ${q} が引ける`, first.includes(want), first.replace(/\s+/g, ' ').trim());
}
await page.fill('#glossary-search', '');
await page.waitForTimeout(200);
await page.screenshot({ path: `${DIR}/rs-glossary.png`, fullPage: true });

// ── 聞き取り練習の採点が壊れていないこと ──────────
// 言い回しを増やしても、答えになる値そのものは変えていない
const grade = await page.evaluate(() => {
  const me = { callsign: 'JA1ABC', name: 'TARO', qth: 'TOKYO', rig: 'IC-7300', pwr: '50W', ant: 'DP', wx: 'FINE' };
  const s = window.__cw.buildScript(me, { mode: 'cq', length: 'long', reaction: 'none' });
  const fields = s.turns.flatMap((t) => t.fields);
  // 台本に、答えとして期待している値がそのまま含まれていること
  const text = s.turns.map((t) => t.text).join(' ');
  return {
    keys: fields.map((f) => f.key),
    inText: fields.every((f) => text.includes(f.value)),
    graded: fields.every((f) => window.__cw.gradeField(f.value, f.value).correct),
  };
});
console.log('採点対象:', grade.keys.join(','));
ok('答えの値が台本にそのまま出る', grade.inText);
ok('同じ値を入れれば正解になる', grade.graded);
ok('設備と天気も採点対象に残る',
  ['rig', 'pwr', 'ant', 'wx'].every((k) => grade.keys.includes(k)), grade.keys.join(','));

// ── 聞き取りドリルでも同じ語彙を出す ──────────────
// 台本に出るだけでは、聞き取れるようにはならない。狙って練習できること
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(300);
const drillTypes = await page.$$eval('#drill-type option', (els) => els.map((e) => e.value));
ok('天気のドリルがある', drillTypes.includes('wx'), drillTypes.join(','));

const wxDrill = await page.evaluate(() => {
  const seen = new Map();
  for (let i = 0; i < 400; i++) {
    const p = window.__cw.makeProblem('wx', {});
    seen.set(p.answer, p.hint);
  }
  return [...seen];
});
console.log('天気ドリル:', wxDrill.length, '通り');
ok('天気の言い方が 30 通り以上出る', wxDrill.length >= 30, `${wxDrill.length} 通り`);
ok('どれにも意味が付く', wxDrill.every(([, hint]) => hint), 
  JSON.stringify(wxDrill.filter(([, h]) => !h).slice(0, 3)));
// 2 語の言い方は語ごとにつながず、まとめた意味を出す
const two = wxDrill.filter(([w]) => w.includes(' '));
console.log('2 語の言い方:', JSON.stringify(two));
ok('2 語の言い方も出る', two.length >= 3, JSON.stringify(two.map(([w]) => w)));
ok('2 語の意味をつなぎ合わせない', two.every(([, h]) => !h.includes(' + ')),
  JSON.stringify(two));

// 略語ドリルは表をそのまま引くので、足した語も自然に出る
const abbrevSeen = await page.evaluate(() => {
  const seen = new Set();
  for (let i = 0; i < 3000; i++) seen.add(window.__cw.makeProblem('abbrev', {}).answer);
  return [...seen];
});
const wanted = ['GLD', 'PSED', 'UFB', 'VFB', 'BTW', 'SA', 'WUD', 'RNG', 'SOLID', 'CPI', 'CL'];
const gotAbbrev = wanted.filter((w) => abbrevSeen.includes(w));
ok('略語ドリルに足した語が出る', gotAbbrev.length === wanted.length,
  `出た: ${gotAbbrev.join(',')}`);

// 頻出単語にも会話らしい語を入れてある
const wordSeen = await page.evaluate(() => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(window.__cw.makeProblem('word', {}).answer);
  return [...seen];
});
ok('頻出単語にも会話の語が入る',
  ['ABT', 'DR', 'GLD', 'BCNU', 'SOLID', 'QRU'].every((w) => wordSeen.includes(w)),
  wordSeen.length + ' 語');

// ── パドル練習でも同じ語彙を打てる ────────────────
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(350);
const taskTypes = await page.$$eval('#keyer-task-type option', (els) => els.map((e) => e.value));
console.log('パドルの課題:', taskTypes.join(','));
ok('パドルにも天気の課題がある', taskTypes.includes('wx'), taskTypes.join(','));
ok('パドルにも設備の課題がある', taskTypes.includes('gear'), taskTypes.join(','));

for (const [type, want] of [['wx', 12], ['gear', 8]]) {
  await page.selectOption('#keyer-task-type', type);
  await page.waitForTimeout(250);
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    await page.click('#btn-keyer-task');
    await page.waitForTimeout(35);
    seen.add(await page.evaluate(() => window.__cw.keyerTask));
  }
  console.log(`${type} の課題:`, [...seen].slice(0, 5).join(' / '), `(${seen.size} 通り)`);
  ok(`${type} の課題が入れ替わる`, seen.size >= want, `${seen.size} 通り`);
  ok(`${type} の課題が鳴らせる文字だけ`,
    [...seen].every((t) => /^[A-Z0-9 /?.,<>+=-]+$/.test(t)), [...seen].join(' / '));
}

// 天気の課題には意味が添う。何を送るのか分からないまま打たせない
await page.selectOption('#keyer-task-type', 'wx');
await page.waitForTimeout(250);
let withMeaning = 0;
for (let i = 0; i < 12; i++) {
  await page.click('#btn-keyer-task');
  await page.waitForTimeout(60);
  if ((await page.textContent('#keyer-task-terms')).trim()) withMeaning += 1;
}
ok('天気の課題に意味が添う', withMeaning >= 10, `${withMeaning} / 12`);
await page.screenshot({ path: `${DIR}/rs-keyer-wx.png`, fullPage: true });

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
