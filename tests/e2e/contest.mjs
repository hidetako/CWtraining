// Playwright の場所は環境によって違うため動的に読み込む
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const errors=[];
const browser = await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
const page = await browser.newPage({viewport:{width:1240,height:1100}});
page.on('pageerror', e=>errors.push('pageerror: '+e.message));
page.on('console', m=>{ if(m.type()==='error') errors.push('console: '+m.text()); });
const DIR = process.env.SHOTS ?? '.';
const shot = n=>page.screenshot({path:`${DIR}/${n}.png`, fullPage:true});

await page.goto(`${BASE}/index.html`);
await page.evaluate(()=>localStorage.clear());
await page.reload();
await page.waitForTimeout(500);
await page.click('.tab[data-panel="contest"]');
await page.waitForTimeout(300);

console.log('modes:', await page.locator('#contest-mode option').allTextContents());
await shot('m1-setup');

// ── パイルアップ: 正しく取る / 取り違える / NIL / 重複 を作る
await page.selectOption('#contest-mode','pileup');
await page.selectOption('#contest-minutes','10');
await page.click('#btn-contest-start');
await page.waitForTimeout(2200);

const peek = ()=>page.evaluate(()=>window.__cw.contest.stations.map(s=>({
  call:s.callsign, nr:s.exchangeValue, state:s.state, lid:s.lid, quirks:Object.keys(s.quirks), off:s.offset })));
console.log('callers:', JSON.stringify(await peek()));
console.log('qrm stations:', await page.evaluate(()=>window.__cw.contest.qrmStations.length));

// 1) 正解の交信
let st = (await peek())[0];
await page.fill('#contest-call', st.call);
await page.keyboard.press('F2');
await page.waitForTimeout(1400);
console.log('after F2, current =', await page.evaluate(()=>window.__cw.contest.current?.callsign ?? null));
await page.fill('#contest-exch', st.nr);
await page.keyboard.press('F3');
await page.waitForTimeout(1500);

// 2) ナンバーを間違える
st = (await peek())[0];
if (st){
  await page.fill('#contest-call', st.call);
  await page.keyboard.press('F2'); await page.waitForTimeout(1200);
  await page.fill('#contest-exch', '999');
  await page.keyboard.press('F3'); await page.waitForTimeout(1400);
}

// 3) 存在しないコール = NIL
await page.fill('#contest-call','ZZ9ZZZ');
await page.fill('#contest-exch','001');
await page.keyboard.press('F3');
await page.waitForTimeout(1400);

const log = await page.evaluate(()=>window.__cw.contest.log.qsos.map(q=>({call:q.call,nr:q.nr,err:q.err,truth:q.trueCall,tn:q.trueNr,pfx:q.pfx})));
console.log('LOG:'); log.forEach(q=>console.log('  ', JSON.stringify(q)));
console.log('score:', JSON.stringify(await page.evaluate(()=>window.__cw.contest.score)));
await shot('m2-pileup');

// ── 部分一致(almost)で訂正を促されるか
await page.keyboard.press('F1'); await page.waitForTimeout(1600);
st = (await peek())[0];
if (st){
  const partial = st.call.slice(0,-1)+'X';
  await page.fill('#contest-call', partial);
  await page.keyboard.press('F2');
  await page.waitForTimeout(1200);
  const cur = await page.evaluate(()=>window.__cw.contest.current);
  console.log(`almost test: typed ${partial} vs ${st.call} -> state=`, await page.evaluate(()=>window.__cw.contest.stations.map(s=>s.state)));
}

// ── スペース補完
await page.keyboard.press('F1'); await page.waitForTimeout(1600);
st = (await peek())[0];
if (st){
  await page.fill('#contest-call', st.call.slice(0,4));
  await page.locator('#contest-call').focus();
  await page.keyboard.press(' ');
  await page.waitForTimeout(200);
  console.log(`autocomplete: "${st.call.slice(0,4)}" -> "${await page.inputValue('#contest-call')}" (真値 ${st.call})`);
}

// ── RIT を矢印キーで動かす
await page.locator('#contest-call').focus();
await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
await page.waitForTimeout(200);
console.log('RIT after 2x ArrowUp:', await page.evaluate(()=>window.__cw.player.settings.rit), '/ 表示', await page.textContent('#contest-rit-out'));

// ── 帯域幅と QSK
await page.selectOption('#contest-bandwidth','250');
await page.waitForTimeout(200);
console.log('bandwidth 250 -> filter Q =', await page.evaluate(()=>window.__cw.player.rxFilters[0].Q.value.toFixed(2)));
await page.locator('#contest-qsk').setChecked(false);
console.log('qsk off ->', await page.evaluate(()=>window.__cw.player.settings.qsk));

await page.evaluate(()=>window.__cw.contest.stopSession());
await page.waitForTimeout(600);
console.log('result:', (await page.textContent('#contest-result')).replace(/\s+/g,' ').trim().slice(0,150));
console.log('hist bars:', await page.locator('.rate-bar').count());
await shot('m3-result');

// ── WPX モード: 条件固定 + マルチ
await page.selectOption('#contest-mode','wpx');
await page.waitForTimeout(300);
console.log('wpx: minutes hidden =', await page.locator('#contest-minutes-field').isHidden(), '| conds disabled =', await page.evaluate(()=>document.querySelector('#cond-qrn').disabled));
console.log('wpx note:', (await page.textContent('#contest-cond-note')).trim());
await shot('m4-wpx');

// ── HST モード
await page.selectOption('#contest-mode','hst');
await page.waitForTimeout(200);
console.log('hst note:', (await page.textContent('#contest-cond-note')).trim());

// ── シングルコール: 必ず1局
await page.selectOption('#contest-mode','single');
await page.waitForTimeout(200);
await page.click('#btn-contest-start');
await page.waitForTimeout(1800);
console.log('single mode callers:', await page.evaluate(()=>window.__cw.contest.stations.length));
await page.evaluate(()=>window.__cw.contest.stopSession());

console.log('\nERRORS:', errors.length?errors.join('\n'):'(none)');
await browser.close();

process.exit(errors.length ? 1 : 0);
