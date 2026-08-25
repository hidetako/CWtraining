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

// どの語が割れたのかを名指しする。「切れ目が違う」だけでは、2 行を目で
// 追わないと分からない
ok('割れた語を名指しする', body2.includes('割って'), body2.slice(0, 200));
ok('語ごとの突き合わせが出る',
  await page.locator('#keyer-result .compare-words').count() === 1);
const splitCells = await page.$$eval('#keyer-result .compare-words .mine',
  (els) => els.map((e) => ({ text: e.textContent, bad: e.classList.contains('bad') })));
console.log('語の突き合わせ:', JSON.stringify(splitCells));
ok('割れた語だけに色が付く',
  splitCells.filter((c) => c.bad).length === 1,
  JSON.stringify(splitCells.filter((c) => c.bad)));

// ── = と <BT> は語の切れ目でも同じ扱い ────────────
// 文字が全部合っているのに別格にならないと、= を <BT> と解読された
// せいだと思ってしまう。この 2 つは同じ符号なので差にならない
const diff = await page.evaluate(() => window.__cw.spacingDiff(
  'PSE QRS = I AM BEGINNER HI', 'PSE QRS <BT> I AM BE GINNER HI'));
const btPair = diff.pairs.find((p) => p.sent[0].text === '<BT>');
ok('= と <BT> の組は一致扱い', btPair?.ok === true, JSON.stringify(btPair));
const splitPair = diff.pairs.find((p) => !p.ok);
ok('割れた語だけが不一致',
  splitPair?.target.map((w) => w.text).join() === 'BEGINNER'
  && splitPair?.sent.map((w) => w.text).join() === 'BE,GINNER',
  JSON.stringify(splitPair));
ok('= と <BT> だけの違いなら 100点＋',
  await page.evaluate(() => window.__cw.sameSpacing(
    'PSE QRS = I AM BEGINNER HI', 'PSE QRS <BT> I AM BEGINNER HI')));

// つなげたときも同じように名指しできる
const joined = await page.evaluate(() => window.__cw.spacingDiff('CQ TEST', 'CQTEST'));
ok('つなぎも組にできる', joined.pairs.length === 1 && joined.pairs[0].ok === false,
  JSON.stringify(joined.pairs.map((p) => [p.target.map((w) => w.text), p.sent.map((w) => w.text)])));
// 文字そのものが違うときは語では比べられない。無理に組にしない
const wrong = await page.evaluate(() => window.__cw.spacingDiff('CQ TEST', 'CQ TXST'));
ok('文字が違えば組にしない', wrong.pairs.length === 0, JSON.stringify(wrong));

// ── 外したあとの打ち直しでは数え直さない ──────────
// 計測は「その課題に挑み始めてから 100点＋ が出るまで」。失敗のたびに
// 0 に戻すと、最後の 1 回ぶんしか計らないことになる
const beforeMiss = await page.evaluate(() => window.__cw.paddleState.startedAt);
await page.click('#btn-keyer-clear');
await page.waitForTimeout(150);
ok('打ち直しで記録表は消えない', await page.locator('#keyer-plus .plus-table').count() === 1);
const startedAt = await page.evaluate(() => window.__cw.paddleState.startedAt);
ok('計測は続いている', startedAt > 0, String(startedAt));
ok('外したあとの打ち直しでは数え直さない', startedAt === beforeMiss,
  `${beforeMiss} → ${startedAt}`);
ok('画面にもその旨が書いてある',
  (await page.textContent('#keyer-plus')).includes('途中で外しても'));

await page.waitForTimeout(400);
await gradeAs(task);
rows = await page.$$eval('#keyer-plus .plus-table tbody tr', (els) => els.length);
ok('2 回目が記録される', rows === 2, `${rows} 行`);
const secondTime = await page.evaluate(() => window.__cw.paddleState.runs.at(-1).seconds);
console.log('2 回目:', secondTime.toFixed(2), '秒');
// 1 回目の 100点＋ のあとに押した「打ち直す」からの通算。外した回の
// やり直しを挟んでいるので、その時間もこの中に入る
ok('2 回目は打ち直しからの通算時間', secondTime > 0.6 && secondTime < 8, `${secondTime} 秒`);

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
