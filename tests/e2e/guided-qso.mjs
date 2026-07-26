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

// 型の早見表
await page.click('#btn-pattern-toggle'); await page.waitForTimeout(300);
console.log('早見表ステップ数:', await page.locator('.pattern-step').count());
console.log('早見表 1件目:', (await page.locator('.pattern-step').first().textContent()).replace(/\s+/g,' ').trim().slice(0,90));
await shot('g1-pattern');
await page.click('#btn-pattern-toggle');

// ガイド付きモードが既定か
console.log('既定スタイル:', await page.evaluate(()=>window.__cw.settings.qsoStyle));
console.log('反応の選択肢:', await page.locator('#qso-reaction option').allTextContents());

// ── ガイド付きで最後まで通す（毎回正解を選ぶ）
await page.click('#btn-qso-start'); await page.waitForTimeout(600);
console.log('phase 1:', (await page.textContent('.phase-banner')).replace(/\s+/g,' ').trim());
console.log('選択肢数:', await page.locator('.choice').count());
await shot('g2-choices');

for (let step=0; step<26; step++){
  await page.waitForTimeout(250);
  if (await page.locator('#btn-qso-again').count()) { console.log(`完了 step=${step}`); break; }
  if (await page.locator('#btn-guide-reveal').count()){
    await page.click('#btn-guide-reveal'); await page.waitForTimeout(250);
    if (step===1){ console.log('相手の反応説明:', (await page.textContent('.reaction-note')).replace(/\s+/g,' ').trim().slice(0,80)); await shot('g3-dx'); }
    await page.click('#btn-guide-next');
  } else if (await page.locator('.choice:not([disabled])').count()){
    // 正解の選択肢を選ぶ
    const idx = await page.evaluate(()=>window.__cw.qsoOptions.findIndex(o=>o.correct));
    await page.locator('.choice').nth(idx).click();
    await page.waitForTimeout(250);
    if (step===0) { console.log('正解時の判定:', (await page.locator('.choice.is-correct .verdict').first().textContent()).trim()); await shot('g4-answered'); }
    await page.click('#btn-guide-skip');
  } else if (await page.locator('#btn-guide-next').count()){
    await page.click('#btn-guide-next');
  }
}
console.log('サマリー:', (await page.textContent('#qso-turn')).replace(/\s+/g,' ').trim().slice(0,110));
await shot('g5-summary');

// ── 誤答したときの説明
await page.click('#btn-qso-start'); await page.waitForTimeout(500);
const wrongIdx = await page.evaluate(()=>window.__cw.qsoOptions.findIndex(o=>!o.correct));
await page.locator('.choice').nth(wrongIdx).click();
await page.waitForTimeout(300);
console.log('誤答の理由:', (await page.locator('.choice.is-wrong .verdict').first().textContent()).trim().slice(0,90));
await shot('g6-wrong');

// ── 相手の反応バリエーション
for (const r of ['nameQuery','qrs','wrongCall','qrz','hurried']){
  await page.selectOption('#qso-reaction', r);
  await page.click('#btn-qso-start'); await page.waitForTimeout(400);
  const info = await page.evaluate(()=>{
    const s = window.__cw.qsoScript;
    return { reaction:s.reaction, turns:s.turns.length,
             dx:s.turns.filter(t=>t.reaction).map(t=>t.text.slice(0,46)) };
  });
  console.log(`${r}: turns=${info.turns} 差し込み="${info.dx[0]||'-'}"`);
}

// ── 聞き取りモードに切り替わるか
await page.locator('.style-option[data-style="copy"]').click();
await page.waitForTimeout(200);
await page.selectOption('#qso-reaction','normal');
await page.click('#btn-qso-start'); await page.waitForTimeout(600);
console.log('聞き取りモード: ログシート =', await page.locator('.logsheet').count(), '/ 選択肢 =', await page.locator('.choice').count());
await shot('g7-copy');

console.log('\nERRORS:', errors.length?errors.join('\n'):'(none)');
await browser.close();

process.exit(errors.length ? 1 : 0);
