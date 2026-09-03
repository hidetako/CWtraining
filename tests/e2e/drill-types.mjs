// 聞き取りドリルの問題の種類と、答え合わせに添える解説
//
// ・種類がひととおり出題でき、自分の答えを写せば満点になること
// ・Q 符号・略語・RST では、答え合わせで意味と符号が出ること
// ・意味を書いても情報が増えないもの（数字の言い換え）は出さないこと
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);
await page.click('.tab[data-panel="drill"]');

// ── 種類が選べること ──────────────────────────────
const types = await page.$$eval('#drill-type option', (els) => els.map((e) => e.value));
console.log('選べる種類:', types.join(', '));
ok('種類が増えている', types.length >= 15, `${types.length} 種類`);
for (const want of ['qcode', 'rst', 'name', 'qth', 'gear', 'wx', 'phrase', 'exchange']) {
  ok(`${want} が選べる`, types.includes(want));
}
ok('もとからある種類が消えていない',
  ['koch', 'frequency', 'callsign', 'abbrev', 'number', 'word', 'symbol', 'weak']
    .every((t) => types.includes(t)));

// 見出しと説明がすべての種類に付いていること
const described = await page.evaluate((list) => list.map((t) => {
  const opt = [...document.querySelectorAll('#drill-type option')].find((o) => o.value === t);
  return { t, label: opt?.textContent?.trim() || '', help: window.__cw.DRILL_TYPES[t]?.help || '' };
}), types);
ok('すべての種類に見出しがある', described.every((d) => d.label.length > 0),
  described.filter((d) => !d.label).map((d) => d.t).join(','));
ok('すべての種類に説明がある', described.every((d) => d.help.length > 0),
  described.filter((d) => !d.help).map((d) => d.t).join(','));

// ── 出題と採点が通ること ──────────────────────────
// 生成は乱数なので、種類ごとに何度も引いて確かめる
const generated = await page.evaluate((list) => {
  const out = {};
  for (const t of list) {
    const seen = new Set();
    let bad = null;
    for (let i = 0; i < 60; i++) {
      const p = window.__cw.makeProblem(t, { level: 10, groupSize: 5, groupCount: 3 });
      if (!p || !p.answer) { bad = '答えが空'; break; }
      if (p.text !== p.answer) { bad = `読みと答えが違う: ${p.text} / ${p.answer}`; break; }
      // 符号表に無い文字が混ざっていないか。鳴らないまま答えにだけ現れ、
      // 「聞こえないのに書けない」問題になってしまう（差し込み記号の
      // 埋め残し {QTH} で実際に起きた）
      const unplayable = p.answer.replace(/<[A-Z]+>/g, '').split('')
        .filter((ch) => ch !== ' ' && !window.__cw.MORSE_TABLE[ch]);
      if (unplayable.length) { bad = `鳴らせない文字 ${unplayable.join('')}: ${p.answer}`; break; }
      // 自分の答えをそのまま写したら満点になること
      const g = window.__cw.gradeProblem(p, p.answer);
      if (Math.round(g.accuracy * 100) !== 100) { bad = `写しても満点にならない: ${p.answer}`; break; }
      seen.add(p.answer);
    }
    out[t] = { variety: seen.size, bad, sample: [...seen][0] };
  }
  return out;
}, types);

for (const [t, r] of Object.entries(generated)) {
  console.log(`  ${t}: ${r.variety} 通り  例=${r.sample}`);
  ok(`${t} は出題できる`, !r.bad, r.bad || '');
  ok(`${t} は毎回同じ問題にならない`, r.variety >= 5, `${r.variety} 通り`);
}

// ── 答え合わせの解説 ──────────────────────────────
const waitDrillReady = () => page.waitForFunction(
  () => document.querySelector('#drill-countdown').hidden === true, null, { timeout: 15000 });

const answerAndRead = async (type) => {
  await page.selectOption('#drill-type', type);
  await page.click('#btn-drill-new');
  await waitDrillReady();
  await page.waitForTimeout(150);
  const answer = await page.evaluate(() => window.__cw.drillProblem.answer);
  await page.fill('#drill-answer', answer);
  await page.press('#drill-answer', 'Enter');
  await page.waitForTimeout(400);
  return {
    answer,
    heading: (await page.$$eval('#drill-result h4', (e) => e.map((x) => x.textContent))).join('|'),
    cards: await page.$$eval('#drill-result .explain-card',
      (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim())),
    lines: await page.$$eval('#drill-result p.hint',
      (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim())),
  };
};

const q = await answerAndRead('qcode');
console.log('Q 符号:', JSON.stringify(q));
ok('Q 符号で解説が出る', q.cards.length === 1, JSON.stringify(q.cards));
ok('解説に見出しが付く', q.heading.includes('意味'), q.heading);
ok('解説に符号が入る', /[・－]/.test(q.cards[0] || ''), q.cards[0]);
ok('解説に日本語の意味が入る', /[ぁ-んァ-ン一-龥]/.test(q.cards[0] || ''), q.cards[0]);
// 意味が「正解」行と解説の 2 か所に出ると、同じ説明が 1 画面に並んでしまう
ok('意味を二重に出さない', q.lines.filter((l) => l.startsWith('正解:')).every((l) => !l.includes('—')),
  JSON.stringify(q.lines));
ok('1 語のときはモールス行を重ねない', !q.lines.some((l) => l.startsWith('モールス:')),
  JSON.stringify(q.lines));
await page.screenshot({ path: `${DIR}/dt1-qcode.png`, fullPage: true });

const ab = await answerAndRead('abbrev');
console.log('略語:', JSON.stringify(ab));
ok('略語でも解説が出る', ab.cards.length >= 1, JSON.stringify(ab.cards));

const rst = await answerAndRead('rst');
console.log('RST:', JSON.stringify(rst));
ok('RST は各桁の意味まで出る',
  /了解度/.test(rst.cards[0] || '') && /音調/.test(rst.cards[0] || ''), rst.cards[0]);

// 複数語の問題では、語ごとに解説が並び、全体のモールスも残ること
const ex = await answerAndRead('exchange');
console.log('実戦の一節:', JSON.stringify(ex));
ok('複数語でも解説が出る', ex.cards.length >= 1, JSON.stringify(ex.cards));
ok('複数語では全体のモールスも出る', ex.lines.some((l) => l.startsWith('モールス:')),
  JSON.stringify(ex.lines));
await page.screenshot({ path: `${DIR}/dt2-exchange.png`, fullPage: true });

// ── 実戦の一節の幅 ────────────────────────────────
// 同じ形ばかりだと並びのほうを覚えてしまい、聞かずに書けるようになる。
// 呼び出しから締めまで、交信のどの場面の一節も出ること。
// あわせて、鳴らせない文字が混じっていないことも見る（混じると
// 音は出ないのに答えにだけ現れ、絶対に取れない問題になる）
const variety = await page.evaluate(() => {
  const texts = [];
  const unplayable = new Set();
  for (let i = 0; i < 600; i++) {
    const p = window.__cw.makeProblem('exchange');
    texts.push(p.answer);
    for (const u of window.__cw.codeUnits(p.answer)) {
      if (!u.space && String(u.key).startsWith('?')) unplayable.add(u.text);
    }
  }
  // 差し込む値を伏せて「形」だけを数える。値違いは同じ形として扱う
  const shapes = new Set(texts.map((t) => t.replace(/[A-Z0-9\-]+/g, '_')));
  const has = (re) => texts.some((t) => re.test(t));
  return {
    kinds: new Set(texts).size,
    shapes: shapes.size,
    unplayable: [...unplayable],
    call: has(/^CQ |^QRZ\?/),          // 呼び出し
    first: has(/\bUR (599|5NN|\d{3})/), // 第 1 交換
    gear: has(/\bRIG |\bANT |\bPWR /),  // 第 2 交換
    wx: has(/\bWX /),                   // 天気
    again: has(/\bPSE (RPT|CFM)|\bQRS\b/), // 聞き返し
    close: has(/\b73\b/),               // 締めくくり
  };
});
console.log('一節の幅:', JSON.stringify(variety));
ok('一節の形が増えている', variety.shapes >= 20, `${variety.shapes} 形`);
ok('中身も毎回引き直す', variety.kinds >= 300, `${variety.kinds} 通り`);
ok('鳴らせない文字が混じらない', variety.unplayable.length === 0,
  variety.unplayable.join(' '));
for (const [scene, seen] of Object.entries({
  呼び出し: variety.call, 第1交換: variety.first, 設備: variety.gear,
  天気: variety.wx, 聞き返し: variety.again, 締め: variety.close,
})) ok(`${scene}の一節が出る`, seen);

// 文字群には解説が付かない（「数字 0537」のような言い換えも出さない）
const koch = await answerAndRead('koch');
ok('文字群には解説を出さない', koch.cards.length === 0, JSON.stringify(koch.cards));

const num = await page.evaluate(() => {
  // 数字だけの答えで、言い換えだけの解説が出ないこと
  const box = document.createElement('div');
  box.innerHTML = window.__cw.termListHtml('0537', { heading: 'x', skip: ['number'] });
  const kept = window.__cw.termListHtml('0537', { heading: 'x' });
  return { skipped: box.innerHTML.trim(), keptLength: kept.length };
});
console.log('数字の言い換え:', JSON.stringify(num));
ok('数字の言い換えは出さない', num.skipped === '', num.skipped.slice(0, 60));

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
