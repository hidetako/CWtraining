// スマートフォン向けの画面（1 列・パドルの引き出し・指で押せる大きさ）
const { chromium, devices } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(700);

const TABS = ['qso', 'drill', 'contest', 'keyer', 'tools', 'glossary', 'settings'];

const sheet = () => page.evaluate(() => {
  const w = document.querySelector('#paddle-widget');
  const r = w.getBoundingClientRect();
  return {
    open: w.classList.contains('is-open'),
    top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
    onScreen: r.top < window.innerHeight - 10,
  };
});

// ═══════════════ 横にはみ出さない ═══════════════
const wide = [];
for (const t of TABS) {
  await page.click(`.tab[data-panel="${t}"]`);
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }));
  if (m.doc > m.win + 1) wide.push({ tab: t, ...m });
}
console.log('横幅:', JSON.stringify(wide.length ? wide : 'すべて収まる'));
ok('どのタブも横にはみ出さない', wide.length === 0, JSON.stringify(wide));

await page.click('.tab[data-panel="qso"]');
await page.waitForTimeout(300);

// ═══════════════ ヘッダーが使える ═══════════════
const head = await page.evaluate(() => {
  const r = (s) => document.querySelector(s).getBoundingClientRect();
  const stop = r('#btn-stop-all');
  return {
    height: Math.round(r('.app-header').height),
    stopInView: stop.right <= window.innerWidth + 1 && stop.left >= -1,
    labelHidden: getComputedStyle(document.querySelector('.t-label')).display === 'none',
    mainHeight: Math.round(r('.app-main').height),
  };
});
console.log('ヘッダー:', JSON.stringify(head));
ok('一時停止・終了が画面内にある', head.stopInView, JSON.stringify(head));
ok('狭い画面では語を省く', head.labelHidden);
ok('ヘッダーが高くなりすぎない', head.height <= 130, `${head.height}px`);
ok('本文の高さが残る', head.mainHeight >= 380, `${head.mainHeight}px`);

// ═══════════════ パドルは下から出す引き出し ═══════════════
let s = await sheet();
ok('最初は畳まれている', s.open === false && s.onScreen === false, JSON.stringify(s));
ok('開くボタンが出ている', await page.isVisible('#btn-paddle-sheet'));
await page.screenshot({ path: `${DIR}/m1-closed.png` });

await page.click('#btn-paddle-sheet');
await page.waitForTimeout(400);
s = await sheet();
console.log('開いた引き出し:', JSON.stringify(s));
ok('ボタンで開く', s.open === true && s.onScreen === true, JSON.stringify(s));
ok('開いている間は開くボタンを隠す', await page.isHidden('#btn-paddle-sheet'));
ok('本文が上に残る', s.top > 100, `${s.top}px`);

// 中身が引き出しに収まっていること（下が切れて操作できない、を防ぐ）
const fits = await page.evaluate(() => {
  const w = document.querySelector('#paddle-widget');
  const wr = w.getBoundingClientRect();
  const b = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().bottom);
  return {
    sheetBottom: Math.round(wr.bottom),
    pad: b('#pw-pad'), clear: b('#pw-clear'), speed: b('.pw-speed'),
    scrolls: w.scrollHeight > w.clientHeight + 1,
  };
});
console.log('収まり:', JSON.stringify(fits));
ok('打面が収まる', fits.pad <= fits.sheetBottom, JSON.stringify(fits));
ok('打ち直すが収まる', fits.clear <= fits.sheetBottom, JSON.stringify(fits));
ok('送信速度が収まる', fits.speed <= fits.sheetBottom, JSON.stringify(fits));
ok('引き出しの中でスクロールしない', fits.scrolls === false, String(fits.scrolls));
await page.screenshot({ path: `${DIR}/m2-open.png` });

// ═══════════════ 指で打てる ═══════════════
const pad = await page.locator('#pw-left').boundingBox();
await page.touchscreen.tap(pad.x + pad.width / 2, pad.y + pad.height / 2);
await page.waitForTimeout(900);
const keyed = await page.evaluate(() => window.__cw.keyer.text);
console.log('タップで打鍵:', JSON.stringify(keyed));
ok('打面をタップすると打てる', keyed.trim().length > 0, JSON.stringify(keyed));

const dahBox = await page.locator('#pw-right').boundingBox();
await page.touchscreen.tap(dahBox.x + dahBox.width / 2, dahBox.y + dahBox.height / 2);
await page.waitForTimeout(900);
const both = await page.evaluate(() => window.__cw.keyer.text);
console.log('短点・長点:', JSON.stringify(both));
ok('左右で短点と長点を打ち分けられる', both.trim().length >= 2, JSON.stringify(both));

await page.click('#pw-close');
await page.waitForTimeout(400);
ok('閉じるボタンで畳める', (await sheet()).open === false);
ok('畳むと開くボタンが戻る', await page.isVisible('#btn-paddle-sheet'));

// ═══════════════ 打つ場面では自動で開く ═══════════════
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(700);
ok('パドル送信タブでは自動で開く', (await sheet()).open === true);

// 打面だけ見えても、何を打つのかが隠れていては使えない
const taskVisible = await page.evaluate(() => {
  const t = document.querySelector('#keyer-task-text').getBoundingClientRect();
  const sheetTop = document.querySelector('#paddle-widget').getBoundingClientRect().top;
  const headBottom = document.querySelector('.tabs').getBoundingClientRect().bottom;
  return {
    taskTop: Math.round(t.top), taskBottom: Math.round(t.bottom),
    sheetTop: Math.round(sheetTop), headBottom: Math.round(headBottom),
    visible: t.top >= headBottom - 1 && t.bottom <= sheetTop + 1,
  };
});
console.log('課題の見え方:', JSON.stringify(taskVisible));
ok('開いたとき課題が引き出しに隠れない', taskVisible.visible, JSON.stringify(taskVisible));

// 引き出しに覆われた下のほうまでスクロールで届くこと
const reach = await page.evaluate(() => {
  const m = document.querySelector('.app-main');
  m.scrollTop = m.scrollHeight;
  const g = document.querySelector('#btn-keyer-grade').getBoundingClientRect();
  const sheetTop = document.querySelector('#paddle-widget').getBoundingClientRect().top;
  return { reachable: g.bottom <= sheetTop + 1, gradeBottom: Math.round(g.bottom) };
});
console.log('下まで届くか:', JSON.stringify(reach));
ok('引き出しの下に隠れた操作まで届く', reach.reachable, JSON.stringify(reach));
await page.screenshot({ path: `${DIR}/m3-keyer.png` });

await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(400);
ok('別のタブへ移ると畳む', (await sheet()).open === false);

// 実技の打鍵ターンでも開く
await page.click('.tab[data-panel="qso"]');
await page.waitForTimeout(300);
await page.locator('.style-option[data-style="live"]').click();
await page.waitForTimeout(200);
await page.click('#btn-qso-start');
await page.waitForTimeout(900);
ok('実技の打鍵ターンで開く', (await sheet()).open === true);
await page.evaluate(() => { window.__cw.player.stop(); window.__cw.keyer.reset(); });
await page.click('#pw-close');
await page.waitForTimeout(300);

// ═══════════════ 指で押せる大きさ ═══════════════
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(300);
const small = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('.panel.is-active .btn, .app-header .btn')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;      // 隠れているものは見ない
    if (r.height < 40) out.push({ text: el.textContent.trim().slice(0, 12), h: Math.round(r.height) });
  }
  return out;
});
console.log('小さいボタン:', JSON.stringify(small));
ok('押しにくい大きさのボタンが無い', small.length === 0, JSON.stringify(small));

// iOS は 16px 未満の入力欄で画面を拡大してしまう
const tiny = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('input[type=text], input[type=number], select, textarea')) {
    if (!el.offsetParent) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 16) out.push({ id: el.id, size });
  }
  return out;
});
console.log('小さい文字の入力欄:', JSON.stringify(tiny));
ok('入力欄の文字が 16px 以上', tiny.length === 0, JSON.stringify(tiny));

// ═══════════════ 横向きでも操作が画面内に収まる ═══════════════
// スマートフォンを横にすると幅は 800〜900px になるが高さは 400px 前後しかない。
// 幅だけで判断すると 2 列のまま縦に潰れ、送信速度などがはみ出す
for (const vp of [
  { name: 'iPhone 横', width: 844, height: 390 },
  { name: '小さめ横', width: 740, height: 360 },
  { name: 'Android 横', width: 915, height: 412 },
]) {
  const land = await browser.newPage({
    viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true,
  });
  await land.goto(`${BASE}/index.html`);
  await land.waitForTimeout(600);
  await land.click('#btn-paddle-sheet');
  await land.waitForTimeout(450);

  const r = await land.evaluate(() => {
    const w = document.querySelector('#paddle-widget');
    const wr = w.getBoundingClientRect();
    const b = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().bottom);
    return {
      isSheet: getComputedStyle(w).position === 'fixed',
      sheetBottom: Math.round(wr.bottom),
      speed: b('.pw-speed'), clear: b('#pw-clear'),
      winH: window.innerHeight,
      scrolls: w.scrollHeight > w.clientHeight + 1,
    };
  });
  console.log(`${vp.name} ${vp.width}x${vp.height}:`, JSON.stringify(r));
  ok(`${vp.name}: 引き出しになる`, r.isSheet, JSON.stringify(r));
  ok(`${vp.name}: 送信速度が画面内`, r.speed <= r.winH, `${r.speed} / ${r.winH}`);
  ok(`${vp.name}: 打ち直すが画面内`, r.clear <= r.winH, `${r.clear} / ${r.winH}`);
  ok(`${vp.name}: 中でスクロールしない`, r.scrolls === false, String(r.scrolls));
  await land.close();
}

// ═══════════════ 広い画面では従来どおり ═══════════════
const deskPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await deskPage.goto(`${BASE}/index.html`);
await deskPage.waitForTimeout(600);
const desk = await deskPage.evaluate(() => {
  const rail = document.querySelector('#paddle-widget').getBoundingClientRect();
  return {
    fabHidden: getComputedStyle(document.querySelector('#btn-paddle-sheet')).display === 'none',
    closeHidden: getComputedStyle(document.querySelector('#pw-close')).display === 'none',
    labelShown: getComputedStyle(document.querySelector('.t-label')).display !== 'none',
    railRight: Math.round(rail.right),
    railLeft: Math.round(rail.left),
    winW: window.innerWidth,
  };
});
console.log('広い画面:', JSON.stringify(desk));
ok('広い画面では開くボタンを出さない', desk.fabHidden);
ok('広い画面では閉じるボタンも出さない', desk.closeHidden);
ok('広い画面では語を省かない', desk.labelShown);
ok('広い画面ではパドルが右に常置', desk.railRight === desk.winW && desk.railLeft > desk.winW / 2,
  JSON.stringify(desk));
await deskPage.close();

// 低いだけのパソコンの窓（指で操作していない）は、これまでどおり 2 列
const shortDesk = await browser.newPage({ viewport: { width: 1400, height: 500 } });
await shortDesk.goto(`${BASE}/index.html`);
await shortDesk.waitForTimeout(600);
const shortInfo = await shortDesk.evaluate(() => ({
  isSheet: getComputedStyle(document.querySelector('#paddle-widget')).position === 'fixed',
  coarse: matchMedia('(pointer: coarse)').matches,
}));
console.log('低いパソコンの窓:', JSON.stringify(shortInfo));
ok('低いだけのパソコンは 2 列のまま', shortInfo.isSheet === false, JSON.stringify(shortInfo));
await shortDesk.close();

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
