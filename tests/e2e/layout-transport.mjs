// 右 1/4 のパドル欄と、一時停止・再開・終了
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);

// ── パドル欄が右 1/4 に常置されている ──────────────
const geom = await page.evaluate(() => {
  const r = document.querySelector('#paddle-widget').getBoundingClientRect();
  const tabs = document.querySelector('.tabs').getBoundingClientRect();
  const pad = document.querySelector('#pw-pad').getBoundingClientRect();
  return {
    x: r.x, w: r.width, top: r.top, bottom: r.bottom,
    tabsBottom: tabs.bottom, padH: pad.height, padW: pad.width,
    vw: innerWidth, vh: innerHeight,
  };
});
console.log('パドル欄:', JSON.stringify(geom));
ok('幅が画面の 31%', Math.abs(geom.w / geom.vw - 0.31) < 0.01, `${(geom.w / geom.vw * 100).toFixed(1)}%`);
ok('画面の右端に接している', Math.abs(geom.x + geom.w - geom.vw) < 2);
ok('タブの直下から始まる', Math.abs(geom.top - geom.tabsBottom) < 2, `${geom.top.toFixed(0)} vs ${geom.tabsBottom.toFixed(0)}`);
ok('画面の下端まで届く', Math.abs(geom.bottom - geom.vh) < 2);
ok('打面が十分に大きい', geom.padH >= 300 && geom.padW >= 300, `${geom.padW.toFixed(0)}×${geom.padH.toFixed(0)}`);
ok('本文と重なっていない', await page.evaluate(() => {
  const rail = document.querySelector('#paddle-widget').getBoundingClientRect();
  const body = document.querySelector('.app-main').getBoundingClientRect();
  return body.right <= rail.left + 1;
}));
// 本文を下までスクロールしてもパドル欄は動かない
await page.evaluate(() => { document.querySelector('.app-main').scrollTop = 99999; });
await page.waitForTimeout(200);
ok('スクロールしても位置が変わらない', await page.evaluate((t) => {
  const r = document.querySelector('#paddle-widget').getBoundingClientRect();
  return Math.abs(r.top - t) < 2;
}, geom.top));
await page.evaluate(() => { document.querySelector('.app-main').scrollTop = 0; });
await page.screenshot({ path: `${DIR}/L1-rail.png` });

// たたむ仕組みは持たない（常置）
ok('たたむボタンは無い', await page.locator('#pw-toggle').count() === 0);
ok('モバイル用の要約トグルは無い', await page.locator('#qa-toggle').count() === 0);

// 打面は 1 か所だけ。パドル送信タブに二つ目を置かない
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(250);
ok('パドル送信タブに二つ目の打面が無い', await page.locator('#keyer-pad').count() === 0);
ok('画面全体で打面は 1 つ', await page.locator('.pw-pad').count() === 1);
// それでもキーボード Z/X は効く
await page.evaluate(() => { window.__cw.keyer.reset(); document.activeElement?.blur(); });
await page.keyboard.down('z'); await page.waitForTimeout(300); await page.keyboard.up('z');
await page.waitForTimeout(600);
const zText = await page.evaluate(() => window.__cw.keyer.text.trim());
ok('打面が無くても Z で打てる', zText.length > 0, zText);
await page.evaluate(() => window.__cw.keyer.reset());
await page.click('.tab[data-panel="qso"]');
await page.waitForTimeout(200);

// どのタブに移っても残る
for (const t of ['drill', 'contest', 'keyer', 'tools', 'glossary', 'settings']) {
  await page.click(`.tab[data-panel="${t}"]`);
  await page.waitForTimeout(120);
  if (!(await page.locator('#pw-pad').isVisible())) { ok(`${t} タブでパドル欄が見える`, false); break; }
}
ok('全タブでパドル欄が残る', await page.locator('#pw-pad').isVisible());

// パドル欄から打てて、解読が出る
await page.click('.tab[data-panel="glossary"]');
await page.waitForTimeout(200);
const b = await page.locator('#pw-left').boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.mouse.down(); await page.waitForTimeout(30); await page.mouse.up();
await page.waitForTimeout(700);
const decoded = (await page.textContent('#pw-decoded')).trim();
console.log('略語集タブで打った結果:', JSON.stringify(decoded));
ok('どのタブからでも打てる', decoded === 'E', decoded);
await page.click('#pw-clear');
await page.waitForTimeout(200);
ok('「消す」で消える', (await page.textContent('#pw-decoded')).includes('パドルを操作すると'));

// 送信速度のつまみが両方で揃う
await page.evaluate(() => {
  const el = document.querySelector('#pw-wpm');
  el.value = '24';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(200);
ok('パドル欄のつまみが設定に効く', await page.evaluate(() => window.__cw.settings.keyerWpm) === 24);
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(250);
ok('パドル送信タブのつまみも 24', await page.evaluate(() => Number(document.querySelector('#keyer-wpm').value)) === 24);

// ── 聞き取りでは相手の送信を出さないのが既定 ──────
await page.click('.tab[data-panel="qso"]');
await page.locator('.style-option[data-style="copy"]').click();
await page.waitForTimeout(200);
ok('既定で表示しない', await page.evaluate(() => window.__cw.settings.copyReveal) === false);
ok('切り替えは聞き取りでだけ出る', await page.locator('#copy-reveal-row').isVisible());
ok('チェックは外れている', !(await page.isChecked('#qso-copy-reveal')));

// 相手が送信するターンまで進める
const toRxTurn = async () => {
  for (let i = 0; i < 8; i++) {
    if (await page.locator('#btn-turn-rx').count()) return true;
    if (await page.locator('#btn-turn-skip').count()) await page.click('#btn-turn-skip');
    else if (await page.locator('#btn-turn-next').count()) await page.click('#btn-turn-next');
    else return false;
    await page.waitForTimeout(300);
  }
  return false;
};

await page.click('#btn-qso-start');
await page.waitForTimeout(400);
ok('受信ターンまで進める', await toRxTurn());
await page.click('#btn-turn-rx');
await page.waitForTimeout(1600);
// 表示しない設定では、空欄を置くのではなく表示欄ごと出さない
// （空のまま残すと書き取り欄がその分だけ下に押し下げられる）
console.log('受信中の表示欄:', await page.locator('#qso-playing').count(), '個');
ok('受信中に文字が出ない', await page.locator('#qso-playing').count() === 0);
ok('意味の解説も出ない', await page.locator('#qso-explain').count() === 0);
await page.screenshot({ path: `${DIR}/L2-copy-hidden.png` });

// 入にすると出る
await page.evaluate(() => window.__cw.player.stop());
await page.check('#qso-copy-reveal');
await page.waitForTimeout(150);
await page.click('#btn-qso-start');
await page.waitForTimeout(400);
await toRxTurn();
await page.click('#btn-turn-rx');
await page.waitForTimeout(1600);
const shown2 = (await page.textContent('#qso-playing')).trim();
console.log('入にしたときの表示:', JSON.stringify(shown2));
ok('入にすると文字が出る', shown2.length > 0, shown2);
await page.evaluate(() => window.__cw.player.stop());
await page.uncheck('#qso-copy-reveal');

// ── 一時停止・再開・終了 ────────────────────────
await page.click('.tab[data-panel="tools"]');
await page.fill('#tool-text', 'CQ CQ DE JA1ABC K');
await page.click('#btn-tool-play');
await page.waitForTimeout(500);
ok('再生中は動いている', await page.evaluate(() => window.__cw.player.ctx.state) === 'running');

await page.click('#btn-pause-all');
await page.waitForTimeout(300);
ok('一時停止で音が止まる', await page.evaluate(() => window.__cw.player.ctx.state) === 'suspended');
ok('paused が立つ', await page.evaluate(() => window.__cw.player.paused) === true);
ok('ボタンが「再開」になる', (await page.textContent('#btn-pause-all')).includes('再開'));
await page.screenshot({ path: `${DIR}/L3-paused.png` });

// 一時停止中は時間が進まない
const t1 = await page.evaluate(() => window.__cw.player.ctx.currentTime);
await page.waitForTimeout(600);
const t2 = await page.evaluate(() => window.__cw.player.ctx.currentTime);
ok('停止中は時計が進まない', Math.abs(t2 - t1) < 0.01, `${t1.toFixed(3)}→${t2.toFixed(3)}`);

await page.click('#btn-pause-all');
await page.waitForTimeout(300);
ok('再開で動き出す', await page.evaluate(() => window.__cw.player.ctx.state) === 'running');
ok('ボタンが「一時停止」に戻る', (await page.textContent('#btn-pause-all')).includes('一時停止'));
const t3 = await page.evaluate(() => window.__cw.player.ctx.currentTime);
await page.waitForTimeout(400);
ok('再開後は時計が進む', await page.evaluate(() => window.__cw.player.ctx.currentTime) > t3);

// Space でも効く（入力欄やボタンの上では効かせないので、本文に焦点を移す）
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Space');
await page.waitForTimeout(300);
ok('Space で一時停止', await page.evaluate(() => window.__cw.player.paused) === true);
await page.keyboard.press('Space');
await page.waitForTimeout(300);
ok('Space で再開', await page.evaluate(() => window.__cw.player.paused) === false);
await page.evaluate(() => window.__cw.player.stop());

// 終了：交信シミュレーター
await page.click('.tab[data-panel="qso"]');
await page.click('#btn-qso-start');
await page.waitForTimeout(600);
ok('交信が始まっている', !(await page.locator('#qso-stage').isHidden()));
await page.click('#btn-stop-all');
await page.waitForTimeout(300);
ok('終了で交信が畳まれる', await page.locator('#qso-stage').isHidden());
ok('台本も消える', await page.evaluate(() => window.__cw.qsoScript) === null);

// 終了：聞き取りドリル
await page.click('.tab[data-panel="drill"]');
await page.click('#btn-drill-new');
await page.waitForTimeout(500);
ok('ドリルが始まっている', await page.evaluate(() => !!window.__cw.drillProblem));
await page.click('#btn-stop-all');
await page.waitForTimeout(300);
ok('終了で問題が消える', await page.evaluate(() => window.__cw.drillProblem) === null);
ok('もう一度ボタンが無効に', await page.isDisabled('#btn-drill-replay'));

// 終了：コンテスト運用
await page.click('.tab[data-panel="contest"]');
await page.selectOption('#contest-minutes', '3');
await page.click('#btn-contest-start');
await page.waitForTimeout(800);
ok('コンテストが動いている', await page.evaluate(() => window.__cw.contest.running) === true);
await page.click('#btn-stop-all');
await page.waitForTimeout(400);
ok('終了でコンテストが止まる', await page.evaluate(() => window.__cw.contest.running) === false);

// 終了：パドル送信
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
await page.evaluate(() => { window.__cw.keyer.reset(); });
const pad = await page.locator('#pw-left').boundingBox();
await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
await page.mouse.down(); await page.waitForTimeout(30); await page.mouse.up();
await page.waitForTimeout(600);
ok('打鍵が入っている', (await page.evaluate(() => window.__cw.keyer.text)).length > 0);
await page.click('#btn-stop-all');
await page.waitForTimeout(300);
ok('終了で打鍵が消える', (await page.evaluate(() => window.__cw.keyer.text)) === '');
await page.screenshot({ path: `${DIR}/L4-keyer.png` });

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
