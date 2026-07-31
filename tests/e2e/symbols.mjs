// ローマ字以外の記号とプロサインの習得
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);

// ═══════════════ 記号の並び ═══════════════
const set = await page.evaluate(() => {
  const { SYMBOL_ORDER, termCode, lookupTerm } = window.__cw;
  return {
    order: SYMBOL_ORDER,
    codes: SYMBOL_ORDER.map((u) => termCode(u)),
    meanings: Object.fromEntries(SYMBOL_ORDER.map((u) => [u, lookupTerm(u)?.ja ?? null])),
  };
});
console.log('記号:', JSON.stringify(set.order));
ok('区切りの = がある', set.order.includes('='));
ok('移動運用の / がある', set.order.includes('/'));
ok('プロサインが入っている',
  ['<AR>', '<SK>', '<KN>', '<BK>'].every((p) => set.order.includes(p)),
  JSON.stringify(set.order.filter((u) => u.startsWith('<'))));
ok('句読点が入っている', set.order.includes('.') && set.order.includes(','));

// 同じ符号を持つ表記が二つ入っていないこと。
// + は <AR>、( は <KN> とまったく同じ音なので、両方あると答えが定まらない
const dup = set.codes.filter((c, i) => set.codes.indexOf(c) !== i);
ok('同じ符号の表記が重複しない', dup.length === 0, JSON.stringify(dup));
ok('すべてに符号がある', set.codes.every((c) => /[・－]/.test(c)), JSON.stringify(set.codes));
ok('すべてに意味がある', Object.values(set.meanings).every(Boolean),
  JSON.stringify(Object.entries(set.meanings).filter(([, v]) => !v)));

// ═══════════════ 頻度順に入っている ═══════════════
const freq = await page.evaluate(() => {
  const { SYMBOL_ORDER } = window.__cw;
  const order = window.__cw.FREQUENCY_ORDER ?? null;
  return { order, symbols: SYMBOL_ORDER };
});
if (freq.order) {
  const tail = freq.order.slice(-freq.symbols.length);
  ok('頻度順の末尾が記号', JSON.stringify(tail) === JSON.stringify(freq.symbols), JSON.stringify(tail));
} else {
  // 画面から確かめる（__cw に出していない場合）
  await page.click('.tab[data-panel="drill"]');
  await page.selectOption('#drill-type', 'frequency');
  await page.evaluate(() => {
    const s = document.querySelector('#drill-level');
    s.value = s.max; s.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(200);
  const shown = await page.textContent('#drill-alphabet');
  ok('頻度順に記号が入っている', set.order.every((u) => shown.includes(u)), shown);
}

await page.click('.tab[data-panel="drill"]');
await page.selectOption('#drill-type', 'frequency');
await page.evaluate(() => {
  const s = document.querySelector('#drill-level');
  s.value = s.max; s.dispatchEvent(new Event('input'));
});
await page.waitForTimeout(250);
const freqAlphabet = await page.textContent('#drill-alphabet');
console.log('頻度順（最大）:', freqAlphabet);
ok('頻度順の最大で記号がすべて出る', set.order.every((u) => freqAlphabet.includes(u)), freqAlphabet);
ok('頻度順でも入力ボタンが出る', await page.isVisible('#drill-symbol-pad'));

// ═══════════════ 記号だけのドリル ═══════════════
await page.selectOption('#drill-type', 'symbol');
await page.waitForTimeout(250);
ok('記号ドリルの種類がある', await page.inputValue('#drill-type') === 'symbol');
ok('レベルを選べる', await page.isVisible('#drill-level-field'));
ok('レベルの上限が記号の数', await page.getAttribute('#drill-level', 'max') === String(set.order.length),
  await page.getAttribute('#drill-level', 'max'));

await page.evaluate(() => {
  const s = document.querySelector('#drill-level');
  s.value = s.max; s.dispatchEvent(new Event('input'));
});
await page.fill('#drill-groupsize', '3');
await page.waitForTimeout(250);
ok('入力ボタンが出る', await page.isVisible('#drill-symbol-pad'));
const keys = await page.evaluate(() =>
  [...document.querySelectorAll('.pad-key')].map((el) => ({ t: el.textContent, m: el.title })));
console.log('入力ボタン:', JSON.stringify(keys.map((k) => k.t)));
ok('ボタンが記号の数だけある', keys.length === set.order.length, String(keys.length));
ok('ボタンに符号の説明が付く', keys.every((k) => /[・－]/.test(k.m)), JSON.stringify(keys.slice(0, 2)));

// ボタンで答案欄に差し込める（カーソル位置に入る）
await page.fill('#drill-answer', 'AB');
await page.evaluate(() => {
  const el = document.querySelector('#drill-answer');
  el.focus(); el.setSelectionRange(1, 1);   // A と B のあいだ
});
await page.click('.pad-key[data-insert="<AR>"]');
await page.waitForTimeout(150);
ok('カーソル位置に差し込まれる', await page.inputValue('#drill-answer') === 'A<AR>B',
  await page.inputValue('#drill-answer'));
ok('差し込み後も答案欄に焦点が残る',
  await page.evaluate(() => document.activeElement?.id) === 'drill-answer',
  await page.evaluate(() => document.activeElement?.id));
await page.fill('#drill-answer', '');

// ═══════════════ 出題と採点 ═══════════════
await page.click('#btn-drill-new');
await page.waitForTimeout(900);
const problem = await page.evaluate(() => window.__cw.drillProblem?.answer ?? '');
console.log('出題:', JSON.stringify(problem));
ok('記号だけが出題される', problem.length > 0 && !/[A-Z0-9]/.test(problem.replace(/<[A-Z]+>/g, '')),
  problem);

await page.fill('#drill-answer', problem);
await page.press('#drill-answer', 'Enter');
await page.waitForTimeout(500);
const result = await page.textContent('#drill-result');
ok('正しく書けば満点', result.includes('100%'), result.split('\n').map((s) => s.trim()).filter(Boolean)[0]);
await page.evaluate(() => window.__cw.player.stop());
await page.screenshot({ path: `${DIR}/s1-symbol-drill.png` });

// プロサインは 1 個として数える
const counted = await page.evaluate(() => {
  const { gradeProblem } = window.__cw;
  const g = (ans, inp) => {
    const r = gradeProblem({ answer: ans }, inp);
    return { pct: Math.round(r.accuracy * 100), correct: r.correct, total: r.total, extra: r.extra };
  };
  return {
    prosign: g('<AR> <SK>', '<AR> <SK>'),
    asLetters: g('<AR> <SK>', 'AR SK'),
    btForEq: g('= / ?', '<BT> / ?'),
    mixed: g('A = B', 'A <BT> B'),
    wrong: g('= / ?', '= / .'),
  };
});
console.log('採点:', JSON.stringify(counted));
ok('プロサインは 1 個', counted.prosign.total === 2 && counted.prosign.pct === 100,
  JSON.stringify(counted.prosign));
ok('ローマ字で書いたら不正解', counted.asLetters.pct < 100, JSON.stringify(counted.asLetters));
ok('= を <BT> と書いても正解', counted.btForEq.pct === 100, JSON.stringify(counted.btForEq));
ok('文中でも同じ扱い', counted.mixed.pct === 100, JSON.stringify(counted.mixed));
ok('符号が違えば不正解', counted.wrong.pct < 100, JSON.stringify(counted.wrong));

// ═══════════════ レベル上げは記号の数で止まる ═══════════════
// 種類ごとに使う文字の並びが違うので、上限もその並びで見る必要がある。
// コッホ法の長さで判定すると、記号の上限を超えて保存値だけが増え、
// コッホ法に戻したときにレベルが飛んでしまう
const levelUpAt = async (level, groups = 4) => {
  await page.evaluate((v) => {
    const s = document.querySelector('#drill-level');
    s.value = String(v); s.dispatchEvent(new Event('input'));
  }, level);
  await page.fill('#drill-groupsize', '5');
  await page.fill('#drill-groupcount', String(groups));
  await page.waitForTimeout(200);
  await page.click('#btn-drill-new');
  await page.waitForTimeout(800);
  const ans = await page.evaluate(() => window.__cw.drillProblem?.answer ?? '');
  await page.fill('#drill-answer', ans);
  await page.press('#drill-answer', 'Enter');
  await page.waitForTimeout(450);
  const shown = await page.locator('#btn-levelup').count() > 0;
  if (shown) { await page.click('#btn-levelup'); await page.waitForTimeout(500); }
  await page.evaluate(() => window.__cw.player.stop());
  return { shown, saved: await page.evaluate(() => window.__cw.settings.kochLevel) };
};

const max = set.order.length;
const below = await levelUpAt(max - 1);
console.log(`記号 レベル${max - 1}:`, JSON.stringify(below));
ok('上限の手前ではレベルを上げられる', below.shown && below.saved === max, JSON.stringify(below));

const atMax = await levelUpAt(max);
console.log(`記号 レベル${max}:`, JSON.stringify(atMax));
ok('上限では勧めない', atMax.shown === false, JSON.stringify(atMax));
ok('上限を超えて保存されない', atMax.saved === max, String(atMax.saved));

// コッホ法に戻しても、記号の練習でレベルが飛んでいないこと
await page.selectOption('#drill-type', 'koch');
await page.waitForTimeout(250);
const kochLevelShown = Number(await page.inputValue('#drill-level'));
ok('コッホ法のレベルが飛ばない', kochLevelShown === max, String(kochLevelShown));

await page.selectOption('#drill-type', 'symbol');
await page.evaluate(() => {
  const s = document.querySelector('#drill-level');
  s.value = s.max; s.dispatchEvent(new Event('input'));
});
await page.fill('#drill-groupsize', '3');
await page.waitForTimeout(250);

// ═══════════════ 入力ボタンは答えを漏らさない ═══════════════
// 出す・出さないは「そのレベルで使う文字」で決める。出題の中身では決めない。
// 答えに記号があるときだけ出したら、出ていること自体が手がかりになる
const visibility = [];
for (let i = 0; i < 6; i++) {
  await page.click('#btn-drill-new');
  await page.waitForTimeout(500);
  visibility.push({
    hasSymbol: /[^A-Z0-9 ]/.test(await page.evaluate(() => window.__cw.drillProblem?.answer ?? '')),
    padShown: await page.isVisible('#drill-symbol-pad'),
  });
}
await page.evaluate(() => window.__cw.player.stop());
ok('出題ごとに出したり消したりしない', visibility.every((v) => v.padShown === true),
  JSON.stringify(visibility));

// 記号を使わないレベルでは出さない
await page.selectOption('#drill-type', 'koch');
await page.evaluate(() => {
  const s = document.querySelector('#drill-level');
  s.value = '2'; s.dispatchEvent(new Event('input'));
});
await page.waitForTimeout(250);
ok('記号を使わないレベルでは出さない', await page.isHidden('#drill-symbol-pad'),
  await page.textContent('#drill-alphabet'));

// コッホ法でも記号のレベルまで進めば出る（. は 13 番目）
await page.evaluate(() => {
  const s = document.querySelector('#drill-level');
  s.value = '13'; s.dispatchEvent(new Event('input'));
});
await page.waitForTimeout(250);
const kochAlphabet = await page.textContent('#drill-alphabet');
ok('コッホ法でも記号のレベルで出る',
  kochAlphabet.includes('.') && await page.isVisible('#drill-symbol-pad'), kochAlphabet);

// ═══════════════ 略語集から引ける ═══════════════
await page.click('.tab[data-panel="glossary"]');
await page.waitForTimeout(300);
const gloss = await page.evaluate(() =>
  [...document.querySelectorAll('.gloss-item.is-symbol')].map((el) => ({
    code: el.querySelector('.code')?.textContent ?? '',
    ja: el.querySelector('.ja')?.textContent ?? '',
    morse: el.querySelector('.morse')?.textContent ?? '',
  })));
console.log('略語集の記号:', JSON.stringify(gloss.slice(0, 3)));
ok('略語集に記号が並ぶ', gloss.length === set.order.length, String(gloss.length));
ok('意味と符号が付く', gloss.every((g) => g.ja && /[・－]/.test(g.morse)),
  JSON.stringify(gloss.filter((g) => !g.ja || !/[・－]/.test(g.morse))));
ok('略語にも符号が付く',
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.gloss-item:not(.is-symbol)')][0];
    return /[・－]/.test(el?.querySelector('.morse')?.textContent ?? '');
  }));

await page.fill('#glossary-search', '斜線');
await page.waitForTimeout(250);
const found = await page.evaluate(() =>
  [...document.querySelectorAll('.gloss-item')].map((el) => el.querySelector('.code')?.textContent));
ok('意味からも探せる', found.length === 1 && found[0] === '/', JSON.stringify(found));
await page.screenshot({ path: `${DIR}/s2-glossary.png` });

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
