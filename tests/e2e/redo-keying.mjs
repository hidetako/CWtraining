// 打ち直しの導線（パドル欄のボタンと Esc）
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

/** パドル欄の打面を n 回叩く。毎回打面へ戻す（ボタンを押すと位置がずれるため）。 */
const key = async (n = 3) => {
  const b = await page.locator('#pw-left').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < n; i++) {
    await page.mouse.down(); await page.waitForTimeout(40);
    await page.mouse.up(); await page.waitForTimeout(120);
  }
  await page.waitForTimeout(700);
};
const keyed = () => page.evaluate(() => window.__cw.keyer.text);

// ── 打面のすぐ下にボタンがある ────────────────────
const geom = await page.evaluate(() => {
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  const pad = r('#pw-pad');
  const btn = r('#pw-clear');
  const speed = r('.pw-speed');
  return {
    padBottom: pad.bottom, btnTop: btn.top, btnBottom: btn.bottom,
    speedTop: speed.top, gap: btn.top - pad.bottom, btnW: btn.width, railW: r('#paddle-widget').width,
  };
});
console.log('配置:', JSON.stringify(geom));
ok('打面の下にある', geom.btnTop > geom.padBottom);
ok('打面から近い（250px 未満）', geom.gap < 250, `${geom.gap.toFixed(0)}px`);
ok('送信速度より上にある', geom.btnBottom <= geom.speedTop + 1);
ok('押しやすい幅がある', geom.btnW > geom.railW * 0.6, `${geom.btnW.toFixed(0)} / ${geom.railW.toFixed(0)}`);

// ── 課題中は「打ち直す」、それ以外は「消す」──────
ok('課題が無いときは「消す」', (await page.textContent('#pw-clear')).trim() === '消す',
  await page.textContent('#pw-clear'));

await page.locator('.style-option[data-style="live"]').click();
await page.waitForTimeout(150);
await page.click('#btn-qso-start');
await page.waitForTimeout(800);
ok('打鍵ターンでは「打ち直す」', (await page.textContent('#pw-clear')).trim() === '打ち直す',
  await page.textContent('#pw-clear'));
ok('Esc の案内がある', (await page.getAttribute('#pw-clear', 'title') ?? '').includes('Esc'),
  await page.getAttribute('#pw-clear', 'title'));

// ── パドル欄のボタンで打ち直せる ──────────────────
await key();
const first = await keyed();
console.log('打鍵:', JSON.stringify(first));
ok('打鍵が入る', first.trim().length > 0, first);

// 本文側のボタンより近いこと
const dist = await page.evaluate(() => {
  const c = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const d = (a, b) => Math.round(Math.hypot(a.x - b.x, a.y - b.y));
  const pad = c('#pw-pad');
  return { rail: d(pad, c('#pw-clear')), panel: d(pad, c('#btn-live-clear')) };
});
console.log('打面からの距離:', JSON.stringify(dist));
ok('パドル欄のほうが近い', dist.rail < dist.panel, JSON.stringify(dist));

await page.click('#pw-clear');
await page.waitForTimeout(300);
ok('パドル欄のボタンで消える', (await keyed()) === '', JSON.stringify(await keyed()));
await page.screenshot({ path: `${DIR}/r1-redo.png` });

// ── Esc で打ち直せる（交信は続く）────────────────
await key(2);
const second = await keyed();
ok('打ち直したあとも打てる', second.trim().length > 0, second);
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok('Esc で符号が消える', (await keyed()) === '', JSON.stringify(await keyed()));
ok('Esc では交信が終わらない', await page.evaluate(() => !!window.__cw.qsoScript));

// 何も打っていなければ Esc は終了として働く
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
ok('打鍵が無ければ Esc は終了', await page.evaluate(() => window.__cw.qsoScript) === null);
ok('終了後は「消す」に戻る', (await page.textContent('#pw-clear')).trim() === '消す',
  await page.textContent('#pw-clear'));

// ── 採点結果も一緒に片付く ────────────────────────
await page.click('#btn-qso-start');
await page.waitForTimeout(800);
await key(3);
await page.click('#btn-live-grade');
await page.waitForTimeout(400);
ok('採点結果が出る', await page.locator('#qso-live-result .big').count() === 1);
const scores = () => page.evaluate(() => window.__cw.qsoScores);
ok('採点で点が積まれる', (await scores()).length === 1, JSON.stringify(await scores()));

await page.click('#pw-clear');
await page.waitForTimeout(300);
ok('打ち直しで採点結果も消える', (await page.textContent('#qso-live-result')).trim() === '');
ok('打ち直しで点も取り消される', (await scores()).length === 0, JSON.stringify(await scores()));
ok('採点前の状態に戻る', await page.evaluate(() => window.__cw.qsoTurn !== null));

// 続けて押しても、既に取り消した点より先までは消さない
await page.click('#pw-clear');
await page.waitForTimeout(200);
ok('二重の打ち直しで点が減らない', (await scores()).length === 0, JSON.stringify(await scores()));

// 採点して次のターンへ進んだあとの打ち直しで、積んだ点が消えないこと。
// 打鍵ターン以外では取り消し対象が無いため
await key(3);
await page.click('#btn-live-grade');
await page.waitForTimeout(400);
const carried = (await scores()).length;
await page.click('#btn-live-next');
await page.waitForTimeout(1000);
await page.click('#pw-clear');
await page.waitForTimeout(300);
ok('ターンをまたぐと点が消えない', carried === 1 && (await scores()).length === 1,
  `${carried} → ${JSON.stringify(await scores())}`);
await page.evaluate(() => window.__cw.player.stop());
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
ok('交信を終了できる', await page.evaluate(() => window.__cw.qsoScript) === null);

// ── パドル送信タブでも同じボタンが効く ────────────
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
ok('パドル送信タブでも「打ち直す」', (await page.textContent('#pw-clear')).trim() === '打ち直す',
  await page.textContent('#pw-clear'));
await key(2);
ok('打鍵が入る（パドル送信）', (await keyed()).trim().length > 0);
await page.click('#btn-keyer-grade');
await page.waitForTimeout(300);
await page.click('#pw-clear');
await page.waitForTimeout(300);
ok('打鍵と採点結果が消える', (await keyed()) === ''
  && (await page.textContent('#keyer-result')).trim() === '');

// ── 課題が無い画面でも Esc は先に符号を消す ────────
// パドル欄はどのタブでも使えるので、聞き取り練習中に打った符号も
// Esc で消せる必要がある（ボタンの説明もそう書いてある）
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(300);
await page.click('#btn-drill-new');
await page.waitForTimeout(700);
ok('聞き取り練習では「消す」', (await page.textContent('#pw-clear')).trim() === '消す',
  await page.textContent('#pw-clear'));
await key(2);
ok('聞き取り中でも打鍵は入る', (await keyed()).trim().length > 0, await keyed());
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok('課題が無くても Esc で符号が消える', (await keyed()) === '', JSON.stringify(await keyed()));
ok('その Esc では練習が終わらない', await page.evaluate(() => window.__cw.drillProblem !== null));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
ok('打鍵が無ければ Esc で練習が終わる',
  await page.evaluate(() => window.__cw.drillProblem) === null);

// ── コンテスト運用では Esc を奪わない ──────────────
await page.click('.tab[data-panel="contest"]');
await page.selectOption('#contest-minutes', '3');
await page.click('#btn-contest-start');
await page.waitForTimeout(800);
await page.fill('#contest-call', 'JA1ZZZ');
await page.press('#contest-call', 'Escape');
await page.waitForTimeout(300);
ok('コンテストの Esc は入力欄の消去', await page.inputValue('#contest-call') === '');
ok('コンテストは終わっていない', await page.evaluate(() => window.__cw.contest.running) === true);
await page.evaluate(() => window.__cw.contest.stopSession());

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
