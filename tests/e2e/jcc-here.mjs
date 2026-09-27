// ログ帳: 「現在地から探す」で出た候補を選ぶと、登録フォームに入り、それが目に見えること
//
// ・位置情報から近い順に候補が出る（政令指定都市なら区も）
// ・候補を選ぶ（PC はクリック、iPhone は本物のタッチ）と JCC 欄と QTH 欄に入る
// ・選んだ項目に印が付き、入れた内容がその場に出る（狭い画面ではフォームが上に隠れているため）
// ・選び直せば置き換わる
const { chromium, devices } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch();
const TOKYO = { latitude: 35.6812, longitude: 139.7671 };   // 東京駅

for (const [label, opts] of [
  ['PC', { viewport: { width: 1400, height: 1000 } }],
  ['iPhone', { ...devices['iPhone 13'], hasTouch: true, isMobile: true }],
]) {
  const ctx = await browser.newContext({ ...opts, geolocation: TOKYO, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`${BASE}/index.html`);
  await page.waitForTimeout(500);
  await page.click('.tab[data-panel="logbook"]');
  await page.waitForTimeout(300);

  const tap = async (sel) => {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    const b = await el.boundingBox();
    if (label === 'iPhone') await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(400);
  };

  await tap('#btn-jcc-here');
  await page.waitForTimeout(1200);
  const hits = await page.$$eval('#jcc-results .jcc-hit', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log(`${label} 候補:`, JSON.stringify(hits.slice(0, 3)));
  ok(`${label}: 現在地から候補が出る`, hits.length >= 3, JSON.stringify(hits));
  ok(`${label}: 東京駅なら東京都の区が先頭に来る`, /東京都.*区/.test(hits[0] || ''), hits[0]);

  await tap('#jcc-results .jcc-hit');
  const first = await page.evaluate(() => ({
    jcc: document.querySelector('#log-jcc').value,
    qth: document.querySelector('#log-qth').value,
    selected: document.querySelector('#jcc-results .jcc-hit.is-selected')?.dataset.code,
    picked: document.querySelector('#jcc-picked').hidden ? '' : document.querySelector('#jcc-picked').textContent,
    flash: document.querySelector('#log-jcc').classList.contains('is-flash'),
  }));
  console.log(`${label} 選んだ後:`, JSON.stringify(first));
  ok(`${label}: 選ぶと JCC 欄に入る`, /^\d{4,6}$/.test(first.jcc), first.jcc);
  ok(`${label}: 選ぶと QTH 欄に入る`, /東京都/.test(first.qth), first.qth);
  ok(`${label}: 選んだ項目に印が付く`, first.selected === first.jcc, JSON.stringify(first));
  ok(`${label}: 入れた内容がその場に出る`, first.picked.includes(first.jcc) && first.picked.includes(first.qth), first.picked);
  ok(`${label}: 欄が光る`, first.flash);
  await page.screenshot({ path: `${DIR}/jcc-${label}.png`, fullPage: label === 'iPhone' });

  // 選び直すと置き換わる
  await page.locator('#jcc-results .jcc-hit').nth(2).scrollIntoViewIfNeeded();
  const b2 = await page.locator('#jcc-results .jcc-hit').nth(2).boundingBox();
  if (label === 'iPhone') await page.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2);
  else await page.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.waitForTimeout(400);
  const second = await page.evaluate(() => ({
    jcc: document.querySelector('#log-jcc').value,
    selected: document.querySelector('#jcc-results .jcc-hit.is-selected')?.dataset.code,
    count: document.querySelectorAll('#jcc-results .jcc-hit.is-selected').length,
  }));
  ok(`${label}: 選び直すと置き換わる`, second.jcc !== first.jcc && second.selected === second.jcc && second.count === 1, JSON.stringify(second));

  await ctx.close();
}

await browser.close();
console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
process.exit(errors.length + fails.length ? 1 : 0);
