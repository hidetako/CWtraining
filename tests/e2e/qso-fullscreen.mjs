// 交信シミュレータで打つ番は、パソコンでは画面全体が打面になり、パドル欄は隠れる
//
// ・打つ番が来たら（#qso-keyed が出たら）パドル欄が隠れて本文が全幅になる
// ・本文のどこでも左クリックで打てる。ボタンの上は普通に押せる（打鍵にならない）
// ・キーボード（Z/X）が二重に効かない（交信タブは自前の Z/X を持つ）
// ・相手の番・終了・別のタブではパドル欄が戻る
// ・パドル送信タブは従来どおり（画面全体で打て、パドル欄は残る）
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

const layout = () => page.evaluate(() => {
  const rail = document.querySelector('#paddle-widget');
  const main = document.querySelector('.app-main').getBoundingClientRect();
  return {
    railShown: rail.offsetParent !== null && rail.getBoundingClientRect().width > 0,
    mainWidth: Math.round(main.width),
    winWidth: window.innerWidth,
    global: document.body.classList.contains('is-paddle-global'),
  };
});
const keyed = () => page.evaluate(() => window.__cw.keyer.text + window.__cw.keyer.buffer);
const clickAt = async (sel, ms = 60) => {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
};

// ═══════════════ 交信タブ、始める前 ═══════════════
let l = await layout();
ok('始める前はパドル欄が見える', l.railShown && !l.global, JSON.stringify(l));
const mainBefore = l.mainWidth;

// 本文をクリックしても打鍵にならない（まだ打つ番ではない）
await page.evaluate(() => window.__cw.keyer.reset());
await clickAt('.panel.is-active .panel-head');
await page.waitForTimeout(500);
ok('打つ番でなければ本文のクリックは打鍵にならない', (await keyed()) === '', await keyed());

// ═══════════════ 実技を始める → 打つ番 ═══════════════
await page.locator('.style-option[data-style="live"]').click();
await page.selectOption('#qso-length', 'short');
await page.selectOption('#qso-reaction', 'normal');
await page.click('#btn-qso-start');
await page.waitForTimeout(700);
ok('打つ番になった', await page.locator('#qso-keyed').count() === 1);
l = await layout();
console.log('打つ番のレイアウト:', JSON.stringify(l), '始める前の本文幅:', mainBefore);
ok('打つ番はパドル欄が隠れる', !l.railShown && l.global, JSON.stringify(l));
ok('本文が全幅になる', l.mainWidth > mainBefore + 200 && l.mainWidth >= l.winWidth - 2, `${mainBefore} → ${l.mainWidth} / ${l.winWidth}`);
await page.screenshot({ path: `${DIR}/fs1-turn.png` });

// 本文のどこでも打てる
await page.evaluate(() => window.__cw.keyer.reset());
await clickAt('.panel.is-active .panel-head');
await page.waitForTimeout(700);
const k1 = await keyed();
ok('本文の見出しの上で打てる', k1.trim().length > 0, JSON.stringify(k1));
ok('打った符号が打鍵欄に出る', !(await page.textContent('#qso-keyed')).includes('打ち始めて'));

// 右ボタンは長点、コンテキストメニューは出ない
await page.evaluate(() => window.__cw.keyer.reset());
const b = await page.locator('#qso-keyed').boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.mouse.down({ button: 'right' }); await page.waitForTimeout(60); await page.mouse.up({ button: 'right' });
await page.waitForTimeout(700);
ok('右ボタンで長点（T）', (await keyed()).trim() === 'T', await keyed());

// ボタンの上は普通に押せる（打鍵にならない）
await page.evaluate(() => window.__cw.keyer.reset());
await page.click('#btn-live-clear');
await page.waitForTimeout(500);
ok('ボタンの上のクリックは打鍵にならない', (await keyed()) === '', await keyed());

// キーボード Z は 1 回分だけ（交信タブの Z/X と全画面のキーボードが二重に効かない）
await page.evaluate(() => { window.__cw.keyer.reset(); document.activeElement?.blur(); });
await page.keyboard.down('KeyZ'); await page.waitForTimeout(40); await page.keyboard.up('KeyZ');
await page.waitForTimeout(700);
ok('Z で短点 1 つ（E）だけ', (await keyed()).trim() === 'E', await keyed());

// ═══════════════ 採点して相手の番 → パドル欄が戻る ═══════════════
await clickAt('#qso-keyed', 60);
await page.waitForTimeout(600);
await page.click('#btn-live-grade'); await page.waitForTimeout(300);
await page.click('#btn-live-next'); await page.waitForTimeout(600);
if (await page.locator('#qso-keyed').count() === 0) {
  l = await layout();
  ok('相手の番はパドル欄が戻る', l.railShown && !l.global, JSON.stringify(l));
  await page.evaluate(() => window.__cw.keyer.reset());
  await clickAt('.panel.is-active .panel-head');
  await page.waitForTimeout(500);
  ok('相手の番は本文のクリックが打鍵にならない', (await keyed()) === '', await keyed());
} else {
  console.log('次も打つ番だったので、相手の番の検査は飛ばす');
}

// 終了でも戻る
await page.evaluate(() => window.__cw.player.stop());
await page.click('#btn-stop-all');
await page.waitForTimeout(500);
l = await layout();
ok('終了するとパドル欄が戻る', l.railShown && !l.global, JSON.stringify(l));

// ═══════════════ 自由に打つ（模擬交信）も同じ ═══════════════
await page.locator('.style-option[data-style="free"]').click();
await page.waitForTimeout(200);
await page.click('#btn-qso-start');
await page.waitForTimeout(700);
l = await layout();
ok('模擬交信でも打つ番はパドル欄が隠れる', (await page.locator('#qso-keyed').count()) === 1 && !l.railShown, JSON.stringify(l));
await page.evaluate(() => window.__cw.keyer.reset());
await clickAt('.panel.is-active .panel-head');
await page.waitForTimeout(700);
ok('模擬交信でも本文の上で打てる', (await keyed()).trim().length > 0, await keyed());
await page.screenshot({ path: `${DIR}/fs2-free.png` });

// ═══════════════ 別のタブへ移るとパドル欄が戻る／パドル送信タブは従来どおり ═══════════════
await page.click('.tab[data-panel="glossary"]');
await page.waitForTimeout(300);
l = await layout();
ok('別のタブではパドル欄が戻る', l.railShown && !l.global, JSON.stringify(l));
await page.evaluate(() => window.__cw.keyer.reset());
await clickAt('.panel.is-active .panel-head');
await page.waitForTimeout(500);
ok('別のタブでは本文のクリックが打鍵にならない', (await keyed()) === '', await keyed());

await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
l = await layout();
ok('パドル送信タブではパドル欄が残る', l.railShown && !l.global, JSON.stringify(l));
await page.evaluate(() => window.__cw.keyer.reset());
await clickAt('.panel.is-active .panel-head');
await page.waitForTimeout(700);
ok('パドル送信タブは従来どおり画面全体で打てる', (await keyed()).trim().length > 0, await keyed());

// 戻ってきた交信タブ（交信はまだ続いている）では、また全画面になる
await page.click('.tab[data-panel="qso"]');
await page.waitForTimeout(300);
l = await layout();
ok('交信タブに戻れば、打つ番なら再び全画面', (await page.locator('#qso-keyed').count()) === 0 || (!l.railShown && l.global), JSON.stringify(l));

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
