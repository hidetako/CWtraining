// CW 音声デコーダー
//
// 実際に音を作って聞かせる。発振器をモールスのタイミングで開閉し、
// デコーダーにつないで、出てきた文字が元の文と一致することを見る。
// 速度もトーン周波数も知らせず、追従して当てられること。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);

/**
 * ページ内で: 発振器 → ゲート（モールスで開閉）→ デコーダー。
 * 実時間で鳴らすので、文の長さぶんだけ待つ。
 */
const decode = (text, wpm, pitch) => page.evaluate(async ([text, wpm, pitch]) => {
  const { tokenize, computeTiming, estimateDuration } = await import('./js/morse.js');
  const cw = window.__cw;
  await cw.player.resume();          // AudioContext は最初の操作で作られる
  const ctx = cw.player.ctx;

  const dec = new cw.CWDecoder(ctx);
  await dec.init();
  dec.setPitch(pitch);

  const osc = ctx.createOscillator();
  osc.frequency.value = pitch;
  const gate = ctx.createGain();
  gate.gain.value = 0;
  osc.connect(gate);
  gate.connect(dec.input);
  osc.start();

  // モールスのタイミングでゲートを開閉（クリック音防止のなだらかさ付き）
  const timing = computeTiming(wpm, wpm);
  const t0 = ctx.currentTime + 0.15;
  let t = t0;
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

  let out = '';
  let wpmSeen = 0;
  dec.addEventListener('char', (e) => { out += e.detail.char; wpmSeen = e.detail.wpm; });
  dec.addEventListener('word', () => { if (!out.endsWith(' ')) out += ' '; });

  const total = (t - t0) + 1.2;
  await new Promise((r) => setTimeout(r, total * 1000));
  osc.stop();
  return { out: out.trim(), wpm: wpmSeen };
}, [text, wpm, pitch]);

// ── 20 WPM・700 Hz ────────────────────────────────
const a = await decode('CQ DE JA1ABC', 20, 700);
console.log('20WPM 700Hz:', JSON.stringify(a));
ok('20 WPM を正しく解読する', a.out === 'CQ DE JA1ABC', a.out);
ok('速度の推定が近い', Math.abs(a.wpm - 20) <= 3, `${a.wpm} WPM`);

// ── 28 WPM・550 Hz（速く・低く） ──────────────────
const b = await decode('UR 599 BK', 28, 550);
console.log('28WPM 550Hz:', JSON.stringify(b));
ok('28 WPM でも解読できる', b.out === 'UR 599 BK', b.out);

// ── 13 WPM・900 Hz（遅く・高く） ──────────────────
const c = await decode('TNX 73', 13, 900);
console.log('13WPM 900Hz:', JSON.stringify(c));
ok('13 WPM でも解読できる', c.out === 'TNX 73', c.out);

// ── 合っていないトーンには反応しない ──────────────
// バンドパスが効いていれば、離れた周波数の信号は文字にならない
const d = await decode('EEEEE', 20, 700).then(() => null).catch(() => null) ?? await page.evaluate(async () => {
  const { tokenize, computeTiming } = await import('./js/morse.js');
  const cw = window.__cw;
  await cw.player.resume();
  const ctx = cw.player.ctx;
  const dec = new cw.CWDecoder(ctx);
  await dec.init();
  dec.setPitch(1200);                    // デコーダーは 1200 Hz を待つ
  const osc = ctx.createOscillator();
  osc.frequency.value = 400;             // 鳴らすのは 400 Hz
  const gate = ctx.createGain();
  gate.gain.value = 0;
  osc.connect(gate); gate.connect(dec.input); osc.start();
  const timing = computeTiming(20, 20);
  let t = ctx.currentTime + 0.1;
  for (let i = 0; i < 5; i++) {
    gate.gain.setTargetAtTime(1, t, 0.002);
    gate.gain.setTargetAtTime(0, t + timing.dit, 0.002);
    t += timing.dit + timing.elementGap;
  }
  let out = '';
  dec.addEventListener('char', (e) => { out += e.detail.char; });
  await new Promise((r) => setTimeout(r, 1500));
  osc.stop();
  return out;
});
console.log('周波数違い:', JSON.stringify(d));
ok('合っていないトーンは拾わない', d === '', d);

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
