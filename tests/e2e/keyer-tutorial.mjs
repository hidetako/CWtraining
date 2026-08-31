// Playwright の場所は環境によって違うため動的に読み込む
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
page.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
page.on('pageerror', e => errors.push('pageerror: '+e.message));
const DIR = process.env.SHOTS ?? '.';
const shot = n => page.screenshot({path:`${DIR}/${n}.png`, fullPage:true});

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(500);
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(400);

// 使い方を知っている人に毎回 1 画面ぶん押しのけられないよう、
// チュートリアルは初めからたたんである。開かないと中身は見えない
ok('初めはたたまれている',
  await page.locator('#tutorial.is-collapsed').count() === 1);
ok('たたまれていれば中身は見えない', !(await page.locator('#tutorial-body').isVisible()));
ok('開くボタンになっている',
  (await page.textContent('#btn-tutorial-toggle')).trim() === '開く');
await page.click('#btn-tutorial-toggle');
await page.waitForTimeout(200);
ok('押せば開く', await page.locator('#tutorial-body').isVisible());

const step = async () => (await page.textContent('#tutorial-title')).trim();
const goal = async () => (await page.textContent('#tutorial-goal')).replace(/\s+/g,' ').trim();
console.log('step1:', await step(), '|', await goal());
await shot('t1-intro');

await page.click('#btn-tutorial-next');
await page.waitForTimeout(200);
console.log('step2:', await step(), '|', await goal());

await page.locator('#pw-pad').scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
const b = await page.locator('#pw-pad').boundingBox();
await page.mouse.move(b.x+b.width/2, b.y+b.height/2);
const hold = async (button, ms) => { await page.mouse.down({button}); await page.waitForTimeout(ms); await page.mouse.up({button}); };

// step2: 5+ dits (hold left)
await hold('left', 800);
await page.waitForTimeout(500);
console.log('  after dits:', await goal());
await page.waitForTimeout(1600);
console.log('step3 (auto):', await step(), '|', await goal());

// step3: 4+ dahs
await hold('right', 1400);
await page.waitForTimeout(2200);
console.log('step4 (auto):', await step());

// step4: letter A = dit dah
await hold('left', 40); await page.waitForTimeout(60); await hold('right', 150);
await page.waitForTimeout(2600);
console.log('step5 (auto):', await step());
await shot('t2-progress');

// step5: letter N = dah dit
await hold('right', 150); await page.waitForTimeout(60); await hold('left', 40);
await page.waitForTimeout(2600);
console.log('step6 (auto):', await step(), '|', await goal());

// step6 squeeze -> C = -.-.  : press dah, then squeeze, release after 4
await page.mouse.down({button:'right'});
await page.waitForTimeout(30);
await page.mouse.down({button:'left'});
await page.waitForTimeout(520);
await page.mouse.up({button:'left'});
await page.mouse.up({button:'right'});
await page.waitForTimeout(2600);
console.log('step7 (auto):', await step(), '|', await goal());
console.log('  decoded so far:', JSON.stringify((await page.textContent('#keyer-decoded')).trim()));
await shot('t3-squeeze');

// step7: change mode
await page.selectOption('#keyer-mode', 'iambicA');
await page.waitForTimeout(2200);
console.log('step8 (auto):', await step());
console.log('  sample btn visible:', await page.locator('#btn-tutorial-sample').isVisible());

// step8: change speed
await page.locator('#keyer-wpm').fill('16');
await page.locator('#keyer-wpm').dispatchEvent('input');
await hold('left', 400);   // 速度ステップは変更後に打つ必要がある
await page.waitForTimeout(2200);
console.log('step9 (auto):', await step());
await shot('t4-settings');

// jump to callsign step via dots
const dots = await page.locator('.tutorial-dot').count();
console.log('dots:', dots);
await page.locator('.tutorial-dot').nth(11).click();
await page.waitForTimeout(300);
console.log('jumped to:', await step(), '|', await goal());

await page.locator('.tutorial-dot').nth(12).click();
await page.waitForTimeout(200);
console.log('last step:', await step(), '| next btn:', await page.textContent('#btn-tutorial-next'));
await page.click('#btn-tutorial-next');
await page.waitForTimeout(300);
console.log('collapsed:', await page.locator('#tutorial').evaluate(e => e.classList.contains('is-collapsed')));
await shot('t5-collapsed');

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('=== ERRORS ===');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
