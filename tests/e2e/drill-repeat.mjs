// 聞き取りドリル: 出題の音声を 1〜3 回続けて鳴らせること
//
// ・「音声の繰り返し」の選択が保存され、読み直しても残る
// ・3 回にすると、出題で同じ本文が 3 回鳴る（間に無音を置いて）
// ・1 回（既定）なら 1 回だけ
// ・繰り返しの途中で採点すると、残りは鳴らない
// ・「もう一度聞く」は回数に関係なく 1 回
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
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(500);

await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(200);
await page.selectOption('#drill-type', 'koch');
// 短い問題にして、鳴り終わりを待つ時間を抑える
await page.fill('#drill-groupsize', '2');
await page.dispatchEvent('#drill-groupsize', 'change');
await page.fill('#drill-groupcount', '1');
await page.dispatchEvent('#drill-groupcount', 'change');
await page.waitForTimeout(150);

/** player.play の呼び出しを数える */
const spy = () => page.evaluate(() => {
  const p = window.__cw.player;
  window.__plays = [];
  if (!p.__spied) {
    const orig = p.play.bind(p);
    p.play = (text, opts) => { window.__plays.push({ text, at: performance.now() }); return orig(text, opts); };
    p.__spied = true;
  }
});
const plays = () => page.evaluate(() => window.__plays);

const newProblemAndWait = async (waitMs) => {
  await page.click('#btn-drill-new');
  await page.waitForFunction(() => document.querySelector('#drill-countdown')?.hidden === true, null, { timeout: 15000 });
  await page.waitForTimeout(waitMs);
};

// ── 既定は 1 回 ──
ok('既定は 1 回', (await page.inputValue('#drill-repeat')) === '1');
await spy();
await newProblemAndWait(4500);
const once = await plays();
ok('1 回なら 1 回だけ鳴る', once.length === 1, String(once.length));

// ── 3 回にすると 3 回鳴る（同じ本文、間を置いて） ──
await page.selectOption('#drill-repeat', '3');
await page.waitForTimeout(100);
ok('選択が設定に入る', (await page.evaluate(() => window.__cw.settings.drillRepeat)) === 3);
await spy();
await newProblemAndWait(9000);
const thrice = await plays();
const sameText = thrice.every((p) => p.text === thrice[0].text);
const gaps = thrice.slice(1).map((p, i) => Math.round(p.at - thrice[i].at));
console.log('3 回:', thrice.length, '回', JSON.stringify(gaps), 'ms 間隔');
ok('3 回にすると同じ本文が 3 回鳴る', thrice.length === 3 && sameText, `${thrice.length} 回`);
ok('繰り返しの間に無音の間がある（1.5 秒以上）', gaps.every((g) => g >= 1400), JSON.stringify(gaps));
await page.screenshot({ path: `${DIR}/drill-repeat.png` });

// ── 途中で採点すると残りは鳴らない ──
await spy();
await page.click('#btn-drill-new');
await page.waitForFunction(() => document.querySelector('#drill-countdown')?.hidden === true, null, { timeout: 15000 });
await page.waitForTimeout(300);            // 1 回目が鳴り始めたところ
await page.fill('#drill-answer', 'KM');
await page.keyboard.press('Enter');        // 採点
await page.waitForTimeout(6000);
const cut = await plays();
ok('途中で採点すると残りは鳴らない', cut.length === 1, `${cut.length} 回`);
ok('採点結果は出ている', await page.evaluate(() => document.querySelector('#drill-result').hidden === false));

// ── 「もう一度聞く」は 1 回 ──
await spy();
await page.click('#btn-drill-replay');
await page.waitForTimeout(5000);
ok('「もう一度聞く」は回数に関係なく 1 回', (await plays()).length === 1, String((await plays()).length));

// ── 読み直しても残る ──
await page.reload();
await page.waitForTimeout(500);
await page.click('.tab[data-panel="drill"]');
ok('読み直しても 3 回のまま', (await page.inputValue('#drill-repeat')) === '3');

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();
process.exit(errors.length + fails.length ? 1 : 0);
