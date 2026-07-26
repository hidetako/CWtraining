// Playwright の場所は環境によって違うため動的に読み込む
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const errors=[];
const browser = await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
const page = await browser.newPage({viewport:{width:1240,height:1100}});
page.on('pageerror', e=>errors.push('pageerror: '+e.message));
page.on('console', m=>{ if(m.type()==='error') errors.push('console: '+m.text()); });
await page.goto(`${BASE}/index.html`);
await page.evaluate(()=>localStorage.clear());
await page.reload(); await page.waitForTimeout(500);
await page.click('.tab[data-panel="keyer"]'); await page.waitForTimeout(300);

// スライダー → 設定とプレイヤーに届くか
await page.locator('#keyer-freq').evaluate(el=>{ el.value='520'; el.dispatchEvent(new Event('input',{bubbles:true})); });
await page.waitForTimeout(150);
console.log('設定:', await page.evaluate(()=>window.__cw.settings.keyerFreq),
            '/ player:', await page.evaluate(()=>window.__cw.player.settings.keyerFreq),
            '/ 表示:', await page.textContent('#keyer-freq-out'));

// 打鍵ラインの実周波数
const pad = page.locator('#keyer-pad');
await pad.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
const b = await pad.boundingBox();
await page.mouse.move(b.x+b.width/2, b.y+b.height/2);
await page.mouse.down({button:'left'}); await page.waitForTimeout(80); await page.mouse.up({button:'left'});
await page.waitForTimeout(300);
console.log('キーライン周波数:', await page.evaluate(()=>window.__cw.player._keyLine?.osc.frequency.value));

// 打鍵中の変更が即時反映されるか
await page.locator('#keyer-freq').evaluate(el=>{ el.value='840'; el.dispatchEvent(new Event('input',{bubbles:true})); });
await page.waitForTimeout(300);
console.log('変更後のキーライン周波数（目標840へ遷移中）:', (await page.evaluate(()=>window.__cw.player._keyLine?.osc.frequency.value)).toFixed(0));

// 受信の高さと独立か
console.log('受信側 freq は不変:', await page.evaluate(()=>window.__cw.player.settings.freq));

// リロード後も保持
await page.reload(); await page.waitForTimeout(500);
console.log('リロード後の設定:', await page.evaluate(()=>window.__cw.settings.keyerFreq));

console.log('\nERRORS:', errors.length?errors.join('\n'):'(none)');
await browser.close();

process.exit(errors.length ? 1 : 0);
