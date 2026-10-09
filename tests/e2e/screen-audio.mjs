// 交信サポート: 「画面の音を拾う」で、画面共有の音（YouTube のタブなど）を解読できること
//
// 本物の画面共有はブラウザの選択画面が要るので、getDisplayMedia を差し替えて
// モールスを鳴らした MediaStream を返す。
// ・映像つきで頼み、音声の流れをデコーダーにつなぎ、解読が流れる
// ・音声にチェックが無い（音声トラックなし）なら、その旨を出して開かない
// ・止めれば音が止まり、ブラウザ側で共有を止めても（ended）閉じる
// ・マイクと同時には開かない（片方を開けばもう片方は閉じる）
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);
await page.click('.tab[data-panel="support"]');
await page.waitForTimeout(300);

// 画面共有の差し替え。window.__stream を返す（無ければ「許可しなかった」）
await page.evaluate(async () => {
  const { tokenize, computeTiming } = await import('./js/morse.js');
  const cw = window.__cw;
  await cw.player.resume();
  const ctx = cw.player.ctx;
  window.__makeStream = (text, wpm, pitch) => {
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    osc.frequency.value = pitch;
    const gate = ctx.createGain();
    gate.gain.value = 0;
    osc.connect(gate); gate.connect(dest);
    osc.start();
    const timing = computeTiming(wpm, wpm);
    let t = ctx.currentTime + 0.3;
    let prevWasSpace = true;
    for (const token of tokenize(text)) {
      if (token.type === 'space') { t += timing.wordGap; prevWasSpace = true; continue; }
      if (!prevWasSpace) t += timing.charGap;
      prevWasSpace = false;
      for (const el of token.pattern) {
        const dur = el === '.' ? timing.dit : timing.dah;
        gate.gain.setTargetAtTime(1, t, 0.002);
        gate.gain.setTargetAtTime(0, t + dur, 0.002);
        t += dur + timing.elementGap;
      }
    }
    osc.stop(t + 0.5);
    return dest.stream;
  };
  window.__calls = [];
  navigator.mediaDevices.getDisplayMedia = async (c) => {
    window.__calls.push(c);
    if (!window.__stream) throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    return window.__stream;
  };
});

const state = () => page.evaluate(() => ({
  source: window.__cw.supportSource,
  screenBtn: document.querySelector('#btn-sup-screen').textContent.trim(),
  micBtn: document.querySelector('#btn-sup-mic').textContent.trim(),
  note: document.querySelector('#sup-source-note').hidden ? '' : document.querySelector('#sup-source-note').textContent,
  autopitch: !document.querySelector('#btn-sup-autopitch').disabled,
  decoded: document.querySelector('#sup-decoded').textContent.trim(),
}));

// ═══════════════ 音声にチェックが無い ═══════════════
await page.evaluate(() => { window.__stream = new MediaStream(); });
await page.click('#btn-sup-screen');
await page.waitForTimeout(400);
let s = await state();
console.log('音声なし:', JSON.stringify(s));
ok('音声が無ければ開かず、その旨を出す', s.source === '' && /音声が共有されていません/.test(s.decoded) && s.screenBtn === '画面の音を拾う', JSON.stringify(s));

// ═══════════════ 許可しなかった ═══════════════
await page.evaluate(() => { window.__stream = null; });
await page.click('#btn-sup-screen');
await page.waitForTimeout(300);
s = await state();
ok('許可しなければ何も起きない（文句も出さない）', s.source === '' && !/取れませんでした/.test(s.decoded), JSON.stringify(s));

// ═══════════════ 画面の音を解読する ═══════════════
await page.evaluate(() => { window.__stream = window.__makeStream('CQ CQ DE JA1ABC', 20, 700); });
await page.click('#btn-sup-screen');
await page.waitForTimeout(500);
s = await state();
console.log('開いた:', JSON.stringify({ ...s, decoded: s.decoded.slice(0, 40) }));
ok('画面の音を拾っている', s.source === 'screen' && s.screenBtn === '画面の音を止める' && /画面の音を解読/.test(s.note) && s.autopitch, JSON.stringify(s));
const req = await page.evaluate(() => window.__calls.at(-1));
ok('映像つきで頼む（ブラウザは映像なしを許さない）', req && req.video === true && !!req.audio, JSON.stringify(req));
await page.waitForTimeout(7000);
s = await state();
console.log('解読:', JSON.stringify(s.decoded.slice(0, 60)));
ok('画面の音から解読した文字が流れる', /CQ/.test(s.decoded.replace(/\s+/g, '')) || /JA1ABC/.test(s.decoded.replace(/\s+/g, '')), s.decoded.slice(0, 60));
await page.screenshot({ path: `${DIR}/screen-audio.png` });

// ═══════════════ 止める ═══════════════
await page.click('#btn-sup-screen');
await page.waitForTimeout(300);
s = await state();
const trackState = await page.evaluate(() => window.__stream.getAudioTracks()[0].readyState);
ok('止めれば閉じて、音の流れも止める', s.source === '' && s.screenBtn === '画面の音を拾う' && s.note === '' && !s.autopitch && trackState === 'ended', JSON.stringify({ ...s, trackState }));

// ═══════════════ ブラウザ側で共有を止めたとき ═══════════════
await page.evaluate(() => { window.__stream = window.__makeStream('TEST', 20, 700); });
await page.click('#btn-sup-screen');
await page.waitForTimeout(400);
ok('もう一度開ける', (await state()).source === 'screen');
await page.evaluate(() => { window.__stream.getAudioTracks()[0].dispatchEvent(new Event('ended')); });
await page.waitForTimeout(300);
s = await state();
ok('ブラウザの「共有を停止」でも閉じる', s.source === '' && s.screenBtn === '画面の音を拾う', JSON.stringify(s));

// ═══════════════ マイクと排他 ═══════════════
await page.click('#btn-sup-mic');     // --use-fake-device でマイクは開ける
await page.waitForTimeout(500);
s = await state();
ok('マイクを開ける', s.source === 'mic' && s.micBtn === 'マイクを閉じる', JSON.stringify(s));
await page.evaluate(() => { window.__stream = window.__makeStream('E', 20, 700); });
await page.click('#btn-sup-screen');
await page.waitForTimeout(400);
s = await state();
ok('画面の音を拾うとマイクは閉じる', s.source === 'screen' && s.micBtn === 'マイクを開く' && s.screenBtn === '画面の音を止める', JSON.stringify(s));
await page.click('#btn-sup-mic');
await page.waitForTimeout(500);
s = await state();
ok('マイクを開くと画面の音は止まる', s.source === 'mic' && s.screenBtn === '画面の音を拾う', JSON.stringify(s));
await page.click('#btn-sup-mic');
await page.waitForTimeout(200);
ok('マイクを閉じられる', (await state()).source === '');

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
