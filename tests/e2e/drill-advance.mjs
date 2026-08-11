// 採点結果を見ないまま次の問題へ進んでしまわないこと
//
// 報告: コッホ法で解答後、採点評価せずに次の問題に進んでしまう。
// 原因は 2 つあった。
//   1. Enter を少し長く押すと自動リピートが届き、採点した直後に
//      もう一度 Enter が入って次の問題へ進んでいた
//   2. 「レベルを 1 上げる」がその場で次の問題を始めていたので、
//      採点結果が消えていた（コッホ法・頻度順・記号だけに出るボタン）
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

const waitDrillReady = () => page.waitForFunction(
  () => document.querySelector('#drill-countdown').hidden === true, null, { timeout: 15000 });

const resultShown = () => page.evaluate(() => !document.querySelector('#drill-result').hidden);

await page.click('.tab[data-panel="drill"]');
await page.selectOption('#drill-type', 'koch');

// ── 1. Enter の自動リピートで飛ばされないこと ──────
await page.click('#btn-drill-new');
await waitDrillReady();
await page.waitForTimeout(200);

let answer = await page.evaluate(() => window.__cw.drillProblem.answer);
await page.fill('#drill-answer', answer);
await page.evaluate(() => {
  const el = document.querySelector('#drill-answer');
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  // 押しっぱなしで届く 2 発目
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat: true }));
});
await page.waitForTimeout(400);

ok('押しっぱなしでも採点結果が残る', await resultShown());
ok('押しっぱなしで次の問題に進まない',
  await page.inputValue('#drill-answer') === answer, await page.inputValue('#drill-answer'));

// ── 2. 打ち終えた勢いの 2 度押しでも飛ばされないこと ──
await page.click('#btn-drill-next');
await waitDrillReady();
await page.waitForTimeout(200);
answer = await page.evaluate(() => window.__cw.drillProblem.answer);
await page.fill('#drill-answer', answer);
await page.press('#drill-answer', 'Enter');
await page.waitForTimeout(60);            // 採点結果を読むには短すぎる間
await page.press('#drill-answer', 'Enter');
await page.waitForTimeout(400);

ok('素早い 2 度押しでも採点結果が残る', await resultShown());
ok('素早い 2 度押しで次の問題に進まない',
  await page.inputValue('#drill-answer') === answer, await page.inputValue('#drill-answer'));
await page.screenshot({ path: `${DIR}/da1-guard.png`, fullPage: true });

// ── 3. 間を置いた Enter なら、ちゃんと次へ進めること ──
// 飛ばされないようにした結果、次へ進めなくなっては困る
await page.waitForTimeout(800);
await page.press('#drill-answer', 'Enter');
await page.waitForTimeout(400);
ok('間を置けば Enter で次の問題へ進む', await page.inputValue('#drill-answer') === '');
await waitDrillReady();

// ── 4. 「レベルを 1 上げる」で採点結果が消えないこと ──
// 90% 以上・10 文字以上でしか出ないボタンなので、満点で出させる
await page.waitForTimeout(200);
answer = await page.evaluate(() => window.__cw.drillProblem.answer);
await page.fill('#drill-answer', answer);
await page.press('#drill-answer', 'Enter');
await page.waitForTimeout(400);

const before = await page.evaluate(() => window.__cw.settings.kochLevel);
const hasLevelBtn = await page.locator('#btn-levelup').count() === 1;
console.log('レベル上げボタン:', hasLevelBtn, '| 今のレベル:', before);
ok('満点ならレベル上げボタンが出る', hasLevelBtn);

if (hasLevelBtn) {
  const shownAnswer = await page.textContent('#drill-result p.hint');
  await page.click('#btn-levelup');
  await page.waitForTimeout(400);

  ok('レベルが 1 上がる',
    await page.evaluate(() => window.__cw.settings.kochLevel) === before + 1,
    `${before} → ${await page.evaluate(() => window.__cw.settings.kochLevel)}`);
  ok('レベルを上げても採点結果が残る', await resultShown());
  ok('レベルを上げても同じ問題の結果のまま',
    (await page.textContent('#drill-result p.hint')) === shownAnswer, shownAnswer);
  ok('レベルを上げても次の問題は始まらない',
    await page.evaluate(() => document.querySelector('#drill-countdown').hidden === true));
  ok('上げたあとのボタンは押せない',
    await page.locator('#btn-levelup').isDisabled());
  ok('次へ進むボタンは残る', await page.locator('#btn-drill-next').count() === 1);
  await page.screenshot({ path: `${DIR}/da2-levelup.png`, fullPage: true });
}

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
