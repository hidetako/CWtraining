// レバーが押されたままになって鳴り続けないこと
//
// 報告: パドルに触っていないのに、短点（または長点）が延々と入り続ける。
// 原因は「離す」の合図が届かない経路。キーヤーはレバーが握られたままだと
// 思って出し続けるので、届かない経路を塞ぎ、塞ぎ忘れに備えて見張りも置く。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(400);

const state = () => page.evaluate(() => {
  const k = window.__cw.keyer;
  return { ditDown: k.ditDown, dahDown: k.dahDown, sending: k.sending, len: (k.text + k.buffer).length };
});
const reset = async () => {
  await page.evaluate(() => window.__cw.keyer.reset());
  await page.waitForTimeout(150);
};

const pad = await page.locator('#pw-pad').boundingBox();

// ── A) マウスを押したままウィンドウが焦点を失う ──────
// 別のアプリへ切り替えた、ブラウザの外でボタンを離した、通知に焦点を
// 取られた。どれも mouseup が届かない
await reset();
await page.mouse.move(pad.x + pad.width * 0.25, pad.y + pad.height / 2);
await page.mouse.down();
await page.waitForTimeout(600);
const held = await state();
ok('押している間は鳴っている', held.sending && held.ditDown, JSON.stringify(held));

await page.evaluate(() => window.dispatchEvent(new Event('blur')));
await page.waitForTimeout(1200);
const afterBlur = await state();
console.log('  blur の 1.2 秒後:', JSON.stringify(afterBlur));
ok('焦点を失えばレバーが離れる', !afterBlur.ditDown && !afterBlur.dahDown, JSON.stringify(afterBlur));
ok('焦点を失えば鳴り止む', !afterBlur.sending, JSON.stringify(afterBlur));
await page.mouse.up();

// ── B) タッチで押した側と違う側で離す ────────────────
// 指を滑らせて反対の半分で離すと、押していない側を離すことになり、
// 押したままの側が残って鳴り続けていた
await reset();
await page.evaluate(() => {
  const el = document.querySelector('#pw-pad');
  const r = el.getBoundingClientRect();
  const touch = (x) => ({ identifier: 1, clientX: x, clientY: r.top + r.height / 2, target: el });
  const start = new Event('touchstart', { bubbles: true, cancelable: true });
  start.changedTouches = [touch(r.left + r.width * 0.25)];   // 左半分＝短点で押す
  el.dispatchEvent(start);
  setTimeout(() => {
    const end = new Event('touchend', { bubbles: true, cancelable: true });
    end.changedTouches = [touch(r.left + r.width * 0.75)];   // 右半分で離す
    el.dispatchEvent(end);
  }, 400);
});
await page.waitForTimeout(1600);
const afterSlide = await state();
console.log('  指を滑らせて離した 1.2 秒後:', JSON.stringify(afterSlide));
ok('滑らせて離してもレバーが残らない',
  !afterSlide.ditDown && !afterSlide.dahDown, JSON.stringify(afterSlide));
ok('滑らせて離せば鳴り止む', !afterSlide.sending, JSON.stringify(afterSlide));

// ── C) キーボードを押したままウィンドウが焦点を失う ──
await reset();
await page.keyboard.down('KeyZ');
await page.waitForTimeout(500);
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
await page.waitForTimeout(1200);
const afterKeyBlur = await state();
console.log('  Z 押下中に blur、その 1.2 秒後:', JSON.stringify(afterKeyBlur));
ok('キーボードでも焦点を失えば止まる',
  !afterKeyBlur.ditDown && !afterKeyBlur.sending, JSON.stringify(afterKeyBlur));
await page.keyboard.up('KeyZ');

// ── D) タブが隠れたときも止まること ──────────────────
await reset();
await page.mouse.move(pad.x + pad.width * 0.25, pad.y + pad.height / 2);
await page.mouse.down();
await page.waitForTimeout(500);
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(1000);
const afterHide = await state();
ok('タブが隠れたら止まる', !afterHide.ditDown && !afterHide.sending, JSON.stringify(afterHide));
await page.mouse.up();
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

// ── E) 見張り（塞ぎ忘れの経路に備えた最後の砦） ──────
// 経路を 1 つでも塞ぎ忘れると同じことが起きるので、押されたままが
// 続いたら止める。ここでは経路を通さず、直接その状態を作って確かめる
await reset();
await page.mouse.move(pad.x + pad.width * 0.25, pad.y + pad.height / 2);
await page.mouse.down();
await page.waitForTimeout(120);
await page.mouse.up();
await page.waitForTimeout(600);

await page.evaluate(() => {
  const k = window.__cw.keyer;
  k._lastInput = Date.now() - 20000;   // 20 秒前から動いていないことにする
  k.ditDown = true;
  if (!k.sending) k._begin();
});
await page.waitForTimeout(1500);
const afterWatch = await state();
console.log('  見張りの結果:', JSON.stringify(afterWatch));
ok('押されたままが続けば見張りが止める',
  !afterWatch.ditDown && !afterWatch.sending, JSON.stringify(afterWatch));

const note = await page.evaluate(() => {
  const n = document.querySelector('#pw-note');
  return { hidden: n.hidden, text: n.textContent.trim() };
});
console.log('  画面の断り書き:', JSON.stringify(note));
ok('止めたことを画面で知らせる', note.hidden === false && note.text.length > 0, JSON.stringify(note));
ok('断り書きに消し方が書いてある', /打ち直す|Esc/.test(note.text), note.text);
await page.screenshot({ path: `${DIR}/ks1-stuck.png`, fullPage: true });

// ── F) ふつうの打鍵は止められないこと ────────────────
// 見張りが厳しすぎると、押している最中に切られてしまう
await reset();
await page.evaluate(() => { document.querySelector('#pw-note').hidden = true; });
await page.mouse.move(pad.x + pad.width * 0.25, pad.y + pad.height / 2);
await page.mouse.down();
await page.waitForTimeout(2500);          // 2.5 秒押しっぱなしにする
const during = await state();
await page.mouse.up();
await page.waitForTimeout(400);
const after = await state();
console.log('  2.5 秒の連続送出:', JSON.stringify(during), '→ 離した後:', JSON.stringify(after));
ok('押している間は切られない', during.sending && during.ditDown, JSON.stringify(during));
ok('たくさん出ている', during.len >= 5, `${during.len} 要素`);
ok('離せば止まる', !after.sending && !after.ditDown, JSON.stringify(after));
ok('ふつうの打鍵で断り書きは出ない',
  await page.evaluate(() => document.querySelector('#pw-note').hidden === true));

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
