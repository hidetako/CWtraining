// 聞き直しているとき、今どの語を送っているかを強調する
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);

/** 再生中に強調された語を、変わった順に集める。 */
const collect = async (box, ticks = 40, wait = 150) => {
  const seen = [];
  for (let i = 0; i < ticks; i++) {
    await page.waitForTimeout(wait);
    const w = await page.evaluate(
      (sel) => document.querySelector(`${sel} .word.is-playing`)?.textContent ?? null, box);
    if (w && seen[seen.length - 1] !== w) seen.push(w);
  }
  return seen;
};

// ── 本文の語がすべて span で包まれ、通し番号が振られる ──
await page.click('.tab[data-panel="tools"]');
await page.fill('#tool-text', 'CQ DE JA1ABC K');
await page.waitForTimeout(250);
const words = await page.locator('#tool-annotated .word').evaluateAll(
  (els) => els.map((e) => ({ t: e.textContent, w: e.dataset.w })));
console.log('語:', JSON.stringify(words));
ok('すべての語が包まれる', words.length === 4, String(words.length));
ok('通し番号が順に振られる', words.every((x, i) => x.w === String(i)), JSON.stringify(words.map((x) => x.w)));

// ── 再生に合わせて強調が移る ──────────────────────
await page.evaluate(() => {
  window.__cw.settings.charWpm = 38;
  window.__cw.player.setSettings({ charWpm: 38, effWpm: 38 });
});
await page.click('#btn-tool-play');
const seen = await collect('#tool-annotated');
console.log('強調の順:', JSON.stringify(seen));
ok('本文の順に移る', JSON.stringify(seen) === JSON.stringify(['CQ', 'DE', 'JA1ABC', 'K']), JSON.stringify(seen));
ok('同時に光るのは 1 語だけ', await page.evaluate(
  () => document.querySelectorAll('#tool-annotated .word.is-playing').length) <= 1);

await page.waitForTimeout(2500);
ok('鳴り終わると消える', await page.locator('#tool-annotated .word.is-playing').count() === 0);

// 途中で止めても残らない
await page.click('#btn-tool-play');
await page.waitForTimeout(700);
await page.click('#btn-tool-stop');
await page.waitForTimeout(400);
ok('止めても残らない', await page.locator('#tool-annotated .word.is-playing').count() === 0);

// 初心者モードが切でも強調は効く（解説とは別の機能）
await page.evaluate(() => { window.__cw.settings.beginnerMode = false; });
await page.click('#btn-tool-play');
const seenOff = await collect('#tool-annotated', 20);
console.log('初心者モード切:', JSON.stringify(seenOff));
ok('初心者モードが切でも強調する', seenOff.length >= 2, JSON.stringify(seenOff));
await page.click('#btn-tool-stop');
await page.evaluate(() => { window.__cw.settings.beginnerMode = true; });

// ── 小文字で入力しても効く ────────────────────────
// tokenize() は大文字に直すので、対応付けを大文字どうしで比べていないと
// 通し番号が振られず、音は鳴るのに光らない
await page.fill('#tool-text', 'cq de ja1abc k');
await page.waitForTimeout(250);
const lower = await page.locator('#tool-annotated .word').evaluateAll(
  (els) => els.map((e) => e.dataset.w));
console.log('小文字の通し番号:', JSON.stringify(lower));
ok('小文字でも番号が振られる', lower.every((w, i) => w === String(i)), JSON.stringify(lower));
await page.click('#btn-tool-play');
const seenLower = await collect('#tool-annotated', 25);
console.log('小文字での強調:', JSON.stringify(seenLower));
ok('小文字でも強調する', seenLower.length >= 2, JSON.stringify(seenLower));
await page.click('#btn-tool-stop');
await page.waitForTimeout(300);

// ── 再生し直しても強調が続く ──────────────────────
await page.fill('#tool-text', 'CQ DE JA1ABC K');
await page.evaluate(() => {
  window.__cw.settings.charWpm = 30;
  window.__cw.player.setSettings({ charWpm: 30, effWpm: 30 });
});
await page.waitForTimeout(200);
await page.click('#btn-tool-play');
await page.waitForTimeout(900);
await page.click('#btn-tool-play');   // 鳴っている途中で押し直す
const seenAgain = await collect('#tool-annotated', 30, 180);
console.log('押し直したあと:', JSON.stringify(seenAgain));
ok('再生し直しても強調が続く', seenAgain.length >= 3, JSON.stringify(seenAgain));
await page.click('#btn-tool-stop');
await page.evaluate(() => {
  window.__cw.settings.charWpm = 38;
  window.__cw.player.setSettings({ charWpm: 38, effWpm: 38 });
});

// ── 聞き取り練習の「本文を聞き直す」でも効く ──────
await page.click('.tab[data-panel="qso"]');
await page.locator('.style-option[data-style="copy"]').click();
await page.waitForTimeout(150);
await page.click('#btn-qso-start');
await page.waitForTimeout(600);
for (let i = 0; i < 8; i++) {
  if (await page.locator('#btn-turn-grade').count()) break;
  if (await page.locator('#btn-turn-skip').count()) await page.click('#btn-turn-skip');
  else if (await page.locator('#btn-turn-next').count()) await page.click('#btn-turn-next');
  else break;
  await page.waitForTimeout(300);
}
await page.evaluate(() => window.__cw.player.stop());
await page.click('#btn-turn-grade');
await page.waitForTimeout(400);
ok('答え合わせに本文が出る', await page.locator('.annotated .word').count() > 0);

await page.click('#btn-turn-relisten');
const seenQso = await collect('.annotated', 30);
console.log('聞き直しの強調:', JSON.stringify(seenQso.slice(0, 5)));
ok('聞き直しでも強調する', seenQso.length >= 2, JSON.stringify(seenQso.slice(0, 5)));
ok('本文の先頭から始まる', seenQso[0] === await page.evaluate(
  () => document.querySelector('.annotated .word').textContent), seenQso[0]);
await page.screenshot({ path: `${DIR}/h1-highlight.png` });
await page.evaluate(() => window.__cw.player.stop());
await page.waitForTimeout(300);
ok('止めれば消える（聞き直し）', await page.locator('.annotated .word.is-playing').count() === 0);

// ── 見た目が実際に変わっていること ────────────────
const look = await page.evaluate(() => {
  const w = document.querySelector('#tool-annotated .word') || document.querySelector('.annotated .word');
  const before = getComputedStyle(w).boxShadow;
  w.classList.add('is-playing');
  const after = getComputedStyle(w).boxShadow;
  w.classList.remove('is-playing');
  return { before, after };
});
ok('強調で見た目が変わる', look.before !== look.after, JSON.stringify(look).slice(0, 90));

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
