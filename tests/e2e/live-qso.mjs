// Playwright の場所は環境によって違うため動的に読み込む
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const errors=[];
const browser = await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
const page = await browser.newPage({viewport:{width:1240,height:1100}});
page.on('pageerror', e=>errors.push('pageerror: '+e.message));
page.on('console', m=>{ if(m.type()==='error') errors.push('console: '+m.text()); });
const DIR = process.env.SHOTS ?? '.';
const shot=n=>page.screenshot({path:`${DIR}/${n}.png`,fullPage:true});
await page.goto(`${BASE}/index.html`);
await page.evaluate(()=>localStorage.clear());
await page.reload(); await page.waitForTimeout(500);

// ── 1. ウィジェットが常時表示され、どのタブでも打てる
console.log('ウィジェット表示:', await page.locator('#paddle-widget').isVisible());
console.log('ラベル:', (await page.textContent('#pw-left')).trim(), '/', (await page.textContent('#pw-right')).trim());
await page.click('.tab[data-panel="glossary"]'); await page.waitForTimeout(200);
console.log('略語集タブでも表示:', await page.locator('#paddle-widget').isVisible());
// 左半分をクリック → 短点が出る
const pw = await page.locator('#pw-pad').boundingBox();
await page.mouse.move(pw.x + pw.width*0.25, pw.y + pw.height/2);
await page.mouse.down({button:'left'}); await page.waitForTimeout(70); await page.mouse.up({button:'left'});
await page.waitForTimeout(500);
console.log('略語集タブで打鍵 →', JSON.stringify(await page.evaluate(()=>window.__cw.keyer.text + window.__cw.keyer.buffer)));
await shot('L1-widget');

// ── 2. チュートリアル: 縦振りモード警告
await page.click('.tab[data-panel="keyer"]'); await page.waitForTimeout(300);
// チュートリアルは初めからたたんである。中身を触る前に開く
if (await page.locator('#tutorial.is-collapsed').count()) {
  await page.click('#btn-tutorial-toggle'); await page.waitForTimeout(200);
}
await page.selectOption('#keyer-mode','straight'); await page.waitForTimeout(150);
await page.locator('.tutorial-dot').nth(7).click(); await page.waitForTimeout(200); // 速度ステップ
const goal = (await page.textContent('#tutorial-goal')).replace(/\s+/g,' ').trim();
console.log('縦振り時の警告:', goal.slice(0,60));
console.log('戻すボタンあり:', await page.locator('#btn-tutorial-fixmode').count() === 1);
await shot('L2-warning');
await page.click('#btn-tutorial-fixmode'); await page.waitForTimeout(200);
console.log('ボタン後のモード:', await page.evaluate(()=>window.__cw.settings.keyerMode));
console.log('警告解除後のゴール:', (await page.textContent('#tutorial-goal')).replace(/\s+/g,' ').trim().slice(0,70));

// ── 3. 速度ステップ: スライダー変更だけでは進まず、打って進む
await page.locator('#keyer-wpm').evaluate(el=>{ el.value='15'; el.dispatchEvent(new Event('input',{bubbles:true})); });
await page.waitForTimeout(1700);
console.log('スライダーのみ → まだ速度ステップ:', (await page.textContent('#tutorial-title')).includes('速度'));
const pad = await page.locator('#pw-pad');
await pad.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
const b = await pad.boundingBox();
await page.mouse.move(b.x+b.width/2, b.y+b.height/2);
await page.mouse.down({button:'left'}); await page.waitForTimeout(500); await page.mouse.up({button:'left'});
await page.waitForTimeout(1800);
console.log('打鍵後に進んだ:', (await page.textContent('#tutorial-title')).trim());

// ── 4. 実技モード: 通しで運用
await page.click('.tab[data-panel="qso"]'); await page.waitForTimeout(200);
await page.locator('.style-option[data-style="live"]').click();
await page.selectOption('#qso-length','short');
await page.selectOption('#qso-reaction','normal');
await page.click('#btn-qso-start'); await page.waitForTimeout(400);
console.log('実技 第1ターン:', (await page.textContent('.phase-banner')).replace(/\s+/g,' ').trim().slice(0,50));
console.log('打つ内容表示:', await page.locator('#panel-qso .annotated').count() >= 1);
console.log('打鍵欄:', await page.locator('#qso-keyed').count() === 1);

// ウィジェットで数要素打つ（QSOタブで！）
const pw2 = await page.locator('#pw-pad').boundingBox();
await page.mouse.move(pw2.x + pw2.width*0.25, pw2.y + pw2.height/2);
await page.mouse.down({button:'left'}); await page.waitForTimeout(200); await page.mouse.up({button:'left'});
await page.waitForTimeout(600);
const keyed = await page.textContent('#qso-keyed');
console.log('QSOタブでの打鍵が表示に反映:', keyed.trim() !== '' && !keyed.includes('打ち始めて'));
await shot('L3-live-turn');

await page.click('#btn-live-grade'); await page.waitForTimeout(300);
console.log('採点表示:', (await page.textContent('#qso-live-result .big')).trim(), '一致');
await shot('L4-live-grade');
await page.click('#btn-live-next'); await page.waitForTimeout(400);

// 残りターンを進める（dx: reveal→next / me: skip）
for (let i=0;i<16;i++){
  await page.waitForTimeout(250);
  if (await page.locator('#btn-qso-again').count()) { console.log('実技 完了'); break; }
  if (await page.locator('#btn-guide-reveal').count()) { await page.click('#btn-guide-reveal'); await page.waitForTimeout(200); await page.click('#btn-guide-next'); }
  else if (await page.locator('#btn-live-skip').count()) { await page.click('#btn-live-skip'); }
  else if (await page.locator('#btn-guide-next').count()) { await page.click('#btn-guide-next'); }
}
console.log('サマリー:', (await page.textContent('#qso-turn')).replace(/\s+/g,' ').trim().slice(0,80));
await shot('L5-live-summary');

console.log('\nERRORS:', errors.length?errors.join('\n'):'(none)');
await browser.close();

process.exit(errors.length ? 1 : 0);
