// パドル採点の「100点＋」（間隔まで手本どおり）
//
// 文字の採点は語間を照合に使わない（手が一瞬止まっただけで語間が入るため）。
// 「CQ が C Q に割れていないか」だけを別に見て、そろっていれば別格に扱う。
// あわせて、出せるまでの時間を最大 5 回まで表に残す。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);

// ── 判定そのもの ──────────────────────────────────
const same = (a, b) => page.evaluate(([x, y]) => window.__cw.sameSpacing(x, y), [a, b]);

ok('同じならそろっている', await same('CQ TEST', 'CQ TEST'));
ok('CQ が C Q に割れたら不一致', await same('CQ', 'C Q') === false);
ok('語間が抜けても不一致', await same('CQ TEST', 'CQTEST') === false);
ok('連続した空白は 1 つの語間', await same('CQ  TEST', 'CQ TEST'));
// 照合は表記ではなく符号。= と <BT> は同じ符号なので差にならない
ok('= と <BT> は同じ扱い', await same('R = TU', 'R <BT> TU'));
ok('文字が違えば当然不一致', await same('CQ', 'CT') === false);

const units = await page.evaluate(() => window.__cw.spacingUnits('CQ DE'));
ok('語間が単位として入る', units.filter((u) => u === ' ').length === 1, JSON.stringify(units));

// ── 画面: 間隔までそろえば 100点＋ ────────────────
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);

/** 解読結果を直接与えて採点する（打鍵の間隔を実時間で作らずに済ませる）。 */
const gradeAs = async (text) => {
  await page.evaluate((t) => { window.__cw.keyer.text = t; }, text);
  await page.click('#btn-keyer-grade');
  await page.waitForTimeout(200);
};
const task = await page.evaluate(() => window.__cw.keyerTask);
console.log('課題:', task);
ok('課題が出ている', !!task, String(task));

await gradeAs(task);
const big = await page.textContent('#keyer-result .big');
const note = await page.textContent('#keyer-result .score-line .hint');
console.log('採点:', big.trim(), '|', note.trim());
ok('間隔までそろえば 100点＋', big.trim() === '100点＋', big.trim());
ok('別格の色が付く', await page.locator('#keyer-result .big.is-plus').count() === 1);
ok('かかった時間が出る', /\d+\.\d 秒/.test(note), note.trim());

ok('記録表が出る', await page.locator('#keyer-plus .plus-table').count() === 1);
let rows = await page.$$eval('#keyer-plus .plus-table tbody tr', (els) => els.length);
ok('1 行目が入る', rows === 1, `${rows} 行`);
await page.screenshot({ path: `${DIR}/kp1-plus.png`, fullPage: true });

// ── 文字は合っているが語間が違う → 100% どまり ────
await page.click('#btn-keyer-clear');
await page.waitForTimeout(150);
// 先頭の 1 文字を切り離して「C Q」の形にする
const split = task[0] + ' ' + task.slice(1);
await gradeAs(split);
const big2 = await page.textContent('#keyer-result .big');
const body2 = await page.textContent('#keyer-result');
console.log('語間違い:', big2.trim());
ok('文字が合えば 100%', big2.trim() === '100%', big2.trim());
ok('100点＋ にはならない', await page.locator('#keyer-result .big.is-plus').count() === 0);
ok('理由が書いてある', body2.includes('語の切れ目'), body2.slice(0, 80));
ok('記録は増えない', await page.$$eval('#keyer-plus .plus-table tbody tr', (e) => e.length) === 1);

// ── 打ち直すと計測が始まり直す ────────────────────
await page.click('#btn-keyer-clear');
await page.waitForTimeout(150);
ok('打ち直しで記録表は消えない', await page.locator('#keyer-plus .plus-table').count() === 1);
const startedAt = await page.evaluate(() => window.__cw.paddleState.startedAt);
ok('打ち直しで計測が始まる', startedAt > 0, String(startedAt));

await page.waitForTimeout(400);
await gradeAs(task);
rows = await page.$$eval('#keyer-plus .plus-table tbody tr', (els) => els.length);
ok('2 回目が記録される', rows === 2, `${rows} 行`);
const secondTime = await page.evaluate(() => window.__cw.paddleState.runs.at(-1).seconds);
console.log('2 回目:', secondTime.toFixed(2), '秒');
ok('2 回目は打ち直しからの時間', secondTime > 0.3 && secondTime < 5, `${secondTime} 秒`);

// ── 5 回で打ち止め ────────────────────────────────
for (let i = 0; i < 5; i++) {
  await page.click('#btn-keyer-clear');
  await page.waitForTimeout(120);
  await gradeAs(task);
}
rows = await page.$$eval('#keyer-plus .plus-table tbody tr', (els) => els.length);
ok('5 回で打ち止め', rows === 5, `${rows} 行`);
ok('打ち止めを知らせる', (await page.textContent('#keyer-plus')).includes('5 回そろいました'));
ok('最速の行が目立つ', await page.locator('#keyer-plus .plus-table tr.best').count() >= 1);
await page.screenshot({ path: `${DIR}/kp2-table.png`, fullPage: true });

// ── 次の課題で数え直す ────────────────────────────
await page.click('#btn-keyer-next');
await page.waitForTimeout(250);
ok('次の課題で記録が消える', await page.locator('#keyer-plus .plus-table').count() === 0);
ok('次の課題で計測が始まる', await page.evaluate(() => window.__cw.paddleState.startedAt) > 0);

// ── 他のタブの打ち直しでは計測を始めない ──────────
await page.evaluate(() => { window.__cw.paddleState.startedAt = 0; });
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(200);
await page.evaluate(() => window.__cw.redoKeying());
await page.waitForTimeout(150);
ok('他のタブの打ち直しでは計測を始めない',
  await page.evaluate(() => window.__cw.paddleState.startedAt) === 0);

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
