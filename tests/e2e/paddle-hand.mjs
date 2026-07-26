// Playwright の場所は環境によって違うため動的に読み込む
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const errors=[];
const browser = await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
const page = await browser.newPage({viewport:{width:1200,height:1000}});
page.on('pageerror', e=>errors.push('pageerror: '+e.message));
page.on('console', m=>{ if(m.type()==='error') errors.push('console: '+m.text()); });
const DIR = process.env.SHOTS ?? '.';

await page.goto(`${BASE}/index.html`);
await page.evaluate(()=>localStorage.clear());
await page.reload();
await page.waitForTimeout(500);
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
await page.selectOption('#keyer-task-type','free');
await page.locator('#keyer-pad').scrollIntoViewIfNeeded();
await page.waitForTimeout(200);

const b = await page.locator('#keyer-pad').boundingBox();
await page.mouse.move(b.x+b.width/2, b.y+b.height/2);
const tap = async (btn,ms)=>{ await page.mouse.down({button:btn}); await page.waitForTimeout(ms); await page.mouse.up({button:btn}); };

// 単一ボタンを押しっぱなしにして、出る要素が短点か長点かを見る
async function probe(button){
  await page.evaluate(()=>window.__cw.keyer.reset());
  // 設定操作でスクロールしている場合があるので、毎回パッド中央に置き直す
  await page.locator('#keyer-pad').scrollIntoViewIfNeeded();
  const bb = await page.locator('#keyer-pad').boundingBox();
  await page.mouse.move(bb.x+bb.width/2, bb.y+bb.height/2);
  await tap(button, 420);
  await page.waitForTimeout(700);
  const els = await page.evaluate(()=>window.__cw.keyer.text);
  // 短点連打なら H/5 など、長点連打なら M/O/0 などになる
  return els.trim();
}

const combos = [
  ['right','dit'], ['left','dit'], ['right','dah'], ['left','dah'],
];
for (const [hand, thumb] of combos){
  await page.selectOption('#keyer-hand', hand);
  await page.locator('#keyer-thumb').setChecked(thumb==='dah');
  await page.waitForTimeout(250);
  const lampL = (await page.textContent('#lamp-left')).trim();
  const lampR = (await page.textContent('#lamp-right')).trim();
  const left = await probe('left');
  const right = await probe('right');
  console.log(`${hand.padEnd(5)}/親指=${thumb} | ${lampL} | ${lampR} | 左押し="${left}" 右押し="${right}"`);
}

// キーボード Z/X も割り当てに追従するか
await page.selectOption('#keyer-hand','left');
await page.waitForTimeout(200);
await page.evaluate(()=>window.__cw.keyer.reset());
await page.locator('#keyer-pad').click();
await page.keyboard.down('z'); await page.waitForTimeout(420); await page.keyboard.up('z');
await page.waitForTimeout(700);
console.log('左手用でZ押しっぱなし (長点になるはず):', JSON.stringify(await page.evaluate(()=>window.__cw.keyer.text.trim())));

console.log('hand hint:', (await page.textContent('#keyer-hand-help')).trim());
console.log('lede:', (await page.textContent('#keyer-hand-current')).trim());
console.log('pad hint:', (await page.textContent('#keyer-pad .pad-hint')).trim());

// 永続化の確認
await page.reload();
await page.waitForTimeout(600);
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(200);
console.log('reload後の利き手:', await page.inputValue('#keyer-hand'), '| swap:', await page.evaluate(()=>window.__cw.keyer.swap));
await page.screenshot({path:`${DIR}/h1-lefthand.png`, fullPage:true});

console.log('\nERRORS:', errors.length?errors.join('\n'):'(none)');
await browser.close();

process.exit(errors.length ? 1 : 0);
