// Playwright の場所は環境によって違うため動的に読み込む
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const errors=[], fails=[];
const browser = await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
const DIR = process.env.SHOTS ?? '.';
const ok=(l,c,e='')=>{ console.log((c?'✓ ':'✗ ')+l+(e?`  [${e}]`:'')); if(!c) fails.push(l); };

// ── デスクトップ ──
const page = await browser.newPage({viewport:{width:1240,height:1000}});
page.on('pageerror', e=>errors.push('pageerror: '+e.message));
page.on('console', m=>{ if(m.type()==='error') errors.push('console: '+m.text()); });
await page.goto(`${BASE}/index.html`);
/** 出題の数え（3 秒）が終わるのを待つ。終わる前に答えても採点されない。 */
const waitDrillReady = async () => {
  const cd = () => page.waitForFunction(
    (want) => document.querySelector('#drill-countdown').hidden === want,
    null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#drill-countdown').hidden === false,
    null, { timeout: 4000 }).catch(() => {});   // 数えが出る前に終わっていることもある
  await page.waitForFunction(() => document.querySelector('#drill-countdown').hidden === true,
    null, { timeout: 15000 });
};

await page.evaluate(()=>localStorage.clear());
await page.reload(); await page.waitForTimeout(500);

// ⑪ タブ a11y
ok('aria-selected 付与', await page.evaluate(()=>document.querySelector('.tab.is-active').getAttribute('aria-selected'))==='true');
await page.locator('.tab.is-active').focus();
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
ok('→キーで次のタブへ', await page.evaluate(()=>document.querySelector('.tab.is-active').dataset.panel)==='drill');
await page.keyboard.press('End'); await page.waitForTimeout(200);
ok('End で最後のタブへ', await page.evaluate(()=>document.querySelector('.tab.is-active').dataset.panel)==='settings');

// ⑬ 波形・立ち上がり
await page.selectOption('#set-wave','triangle');
await page.selectOption('#set-ramp','8');
await page.waitForTimeout(150);
ok('波形が player に届く', await page.evaluate(()=>window.__cw.player.settings.wave)==='triangle');
ok('立ち上がりが届く', Math.abs(await page.evaluate(()=>window.__cw.player.settings.ramp) - 0.008) < 1e-9);
await page.selectOption('#set-wave','sine');

// ④ 書き出し
const dl = page.waitForEvent('download');
await page.click('#btn-export-data');
const download = await dl;
const path = `${DIR}/export-test.json`;
await download.saveAs(path);
const fs = await import('fs');
const payload = JSON.parse(fs.readFileSync(path,'utf8'));
ok('書き出しJSONに設定と記録', payload.app==='CWtraining' && !!payload.settings && !!payload.stats);

// ⑨⑤ 記録を仕込んでグラフと苦手練習を確認
await page.evaluate(()=>{
  const stats = {
    perChar: { Q:{sent:12,correct:4}, Y:{sent:10,correct:5}, K:{sent:20,correct:19} },
    drills: {attempts:6, chars:150, correct:120},
    qso: {completed:0, fields:0, correct:0},
    keying:{attempts:0,chars:0,correct:0},
    contest:{sessions:0,qsos:0,valid:0,bestRate:0},
    history: [0.9,0.8,0.75,0.7,0.6,0.5].map((a,i)=>({kind:'drill',type:'koch',level:8-i,accuracy:a,total:25,at:Date.now()-i*3600e3})),
  };
  localStorage.setItem('cwtraining.stats.v1', JSON.stringify(stats));
});
await page.reload(); await page.waitForTimeout(500);
await page.click('.tab[data-panel="settings"]'); await page.waitForTimeout(300);
ok('推移グラフが2枚以上', await page.locator('.spark-card').count() >= 2);
ok('折れ線が2px', await page.evaluate(()=>document.querySelector('.spark-card polyline')?.getAttribute('stroke-width'))==='2');
ok('苦手集中ボタン表示', await page.locator('#btn-weak-drill').count()===1);
await page.screenshot({path:`${DIR}/B1-stats.png`, fullPage:false});

await page.click('#btn-weak-drill'); await page.waitForTimeout(500);
ok('ドリルタブへ遷移', await page.evaluate(()=>document.querySelector('.tab.is-active').dataset.panel)==='drill');
ok('苦手集中が選択', await page.inputValue('#drill-type')==='weak');
const prob = await page.evaluate(()=>window.__cw.drillProblem?.answer || '');
ok('出題が苦手文字中心', /^[QYK\s]+$/.test(prob), prob.slice(0,20));
await page.evaluate(()=>window.__cw.player.stop());

// ⑥ 連続出題（3問に設定できないので5問で・答えを流し込み）
await page.selectOption('#drill-count','5');
await page.selectOption('#drill-type','koch'); await page.waitForTimeout(150);
await page.click('#btn-drill-new'); await waitDrillReady();
for (let i=0;i<5;i++){
  const ans = await page.evaluate(()=>window.__cw.drillProblem.answer);
  await page.fill('#drill-answer', ans);
  await page.press('#drill-answer','Enter');       // 採点
  // 採点の直後の Enter は取らない作り。人が読む分だけ間を置く
  await page.waitForTimeout(900);
  if (i<4){
    await page.press('#drill-answer','Enter');       // 次へ
    await waitDrillReady();                          // 次の出題も 3 秒数える
  }
}
ok('セッションまとめ表示', (await page.textContent('#drill-result')).includes('セッション終了'));
ok('進行表示 5/5', (await page.textContent('#drill-result')).includes('5 / 5'));
await page.screenshot({path:`${DIR}/B2-session.png`, fullPage:false});
await page.evaluate(()=>window.__cw.player.stop());

// ⑦ 実技のキーボード打鍵
await page.click('.tab[data-panel="qso"]'); await page.waitForTimeout(200);
await page.locator('.style-option[data-style="live"]').click();
await page.selectOption('#qso-length','short');
await page.click('#btn-qso-start'); await page.waitForTimeout(400);
await page.keyboard.down('z'); await page.waitForTimeout(150); await page.keyboard.up('z');
await page.waitForTimeout(600);
const keyed = await page.evaluate(()=>window.__cw.keyer.text + window.__cw.keyer.buffer);
ok('Zキーで打鍵できる', keyed.trim().length>0, JSON.stringify(keyed));
await page.evaluate(()=>{ window.__cw.player.stop(); });

// ⑧ コンテスト速度
await page.click('.tab[data-panel="contest"]'); await page.waitForTimeout(200);
await page.selectOption('#contest-mode','single');
await page.click('#btn-contest-start'); await page.waitForTimeout(800);
const w0 = await page.evaluate(()=>window.__cw.contest.opts.myWpm);
await page.keyboard.press('PageUp'); await page.waitForTimeout(150);
const w1 = await page.evaluate(()=>window.__cw.contest.opts.myWpm);
ok('PgUp で +2', w1===w0+2, `${w0}→${w1}`);
await page.click('#btn-wpm-down'); await page.waitForTimeout(150);
ok('ボタンで −2', await page.evaluate(()=>window.__cw.contest.opts.myWpm)===w0);
ok('表示も追従', (await page.textContent('#contest-wpm-out')).includes(String(w0)));
await page.evaluate(()=>window.__cw.contest.stopSession());

// ── タブ影（背景指定が効いているかだけ確認）──
ok('タブにスクロール影の指定', (await page.evaluate(()=>getComputedStyle(document.querySelector('.tabs')).backgroundImage)).includes('radial-gradient'));
await page.close();

console.log('\n失敗:', fails.length?fails.join(' / '):'なし');
console.log('ERRORS:', errors.length?errors.join('\n'):'(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
