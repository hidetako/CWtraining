// 複数の局をトーンの違いで聞き分ける（パイルアップの第 1 段）
//
// 音程の違う局を同時に鳴らし、局を探してデコーダーを並べ、それぞれが
// 自分の相手だけを解読することを見る。限界も測ってあるので、
// 通るべき条件（200 Hz 離れて 20 dB 差まで）が通り続けることを固定する。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({
  args: [
    '--autoplay-policy=no-user-gesture-required',
    // マイクの許可ダイアログを出さず、無音の疑似マイクを渡す。
    // 受信音はページ内で合成してデコーダーの入口へ直接入れる
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  ],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);

/**
 * ページ内で局を鳴らす道具を用意する。
 * key(text, wpm, pitch, gain, into) は発振器をモールスで開閉して into へつなぎ、
 * 鳴り終わるまでの秒数を返す。
 */
await page.evaluate(async () => {
  const { tokenize, computeTiming } = await import('./js/morse.js');
  const cw = window.__cw;
  await cw.player.resume();
  const ctx = cw.player.ctx;
  window.__key = (text, wpm, pitch, gain, into) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = pitch;
    const gate = ctx.createGain();
    gate.gain.value = 0;
    const g = ctx.createGain();
    g.gain.value = gain;
    osc.connect(gate); gate.connect(g); g.connect(into);
    osc.start();
    const timing = computeTiming(wpm, wpm);
    let t = ctx.currentTime + 0.15;
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
    return t - ctx.currentTime;
  };
});

/**
 * 局を鳴らし、探して、並べて、解読を集める。
 * @param stations [{ text, wpm, pitch, gain }]
 * @returns {{ found: number[], lanes: [{ pitch, got, wpm }] }}
 */
const mix = (stations) => page.evaluate(async (stations) => {
  const cw = window.__cw;
  const ctx = cw.player.ctx;
  const bank = new cw.CWDecoderBank(ctx);
  let longest = 0;
  for (const st of stations) longest = Math.max(longest, window.__key(st.text, st.wpm, st.pitch, st.gain, bank.input));

  // 1.5 秒ぶん探す（100 ms おき）。その間の音は解読されないが、
  // 手本は繰り返し鳴らしているわけではないので、探し終えてから並べる
  let peaks = [];
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 100));
    peaks = bank.scan();
  }
  const channels = await bank.setPitches(peaks.map((p) => p.hz));
  const texts = new Map(channels.map((c) => [c.id, '']));
  bank.addEventListener('char', (e) => texts.set(e.detail.id, texts.get(e.detail.id) + e.detail.char));
  bank.addEventListener('word', (e) => texts.set(e.detail.id, texts.get(e.detail.id) + ' '));
  await new Promise((r) => setTimeout(r, (longest - 1.5 + 1.2) * 1000));
  const lanes = channels.map((c) => ({
    pitch: c.pitch, got: texts.get(c.id).replace(/\s+/g, ' ').trim(), wpm: c.decoder.wpm,
  }));
  for (const c of channels) c.decoder.dispose();
  return { found: peaks.map((p) => p.hz), lanes };
}, stations);

/** 探した音程が、鳴らした音程それぞれの近く（±20 Hz）にあるか。 */
const matches = (found, pitches) => pitches.every((p) => found.some((f) => Math.abs(f - p) <= 20));
/** 音程に対応するレーンの解読文（探すのは 1.5 秒後からなので、頭は欠ける）。 */
const laneFor = (lanes, pitch) => lanes.find((l) => Math.abs(l.pitch - pitch) <= 20);
/** 頭が欠けていても、後ろが手本と一致していれば取れている。 */
const tail = (got, want) => want.endsWith(got.slice(-Math.min(got.length, 8))) && got.length >= 5;

// ── 3 局・150 Hz 間隔・速度ばらばら ────────────────
// 探すところから通しで。3 局とも見つかり、それぞれ自分の相手だけを取る
const three = await mix([
  { text: 'CQ CQ DE JA1ABC JA1ABC K', wpm: 18, pitch: 550, gain: 0.3 },
  { text: 'JA1ABC DE DL1XYZ UR 599 599 BK', wpm: 26, pitch: 700, gain: 0.3 },
  { text: 'TNX FER QSO ES 73 73 SK', wpm: 32, pitch: 850, gain: 0.3 },
]);
console.log('3 局:', JSON.stringify(three));
ok('3 局とも見つかる', three.found.length === 3 && matches(three.found, [550, 700, 850]),
  three.found.join(', '));
for (const [pitch, want, wpm] of [[550, 'CQ CQ DE JA1ABC JA1ABC K', 18],
  [700, 'JA1ABC DE DL1XYZ UR 599 599 BK', 26], [850, 'TNX FER QSO ES 73 73 SK', 32]]) {
  const lane = laneFor(three.lanes, pitch);
  ok(`${pitch} Hz の局を取れる`, !!lane && tail(lane.got, want), lane?.got);
  ok(`${pitch} Hz の速度に追従する`, !!lane && Math.abs(lane.wpm - wpm) <= 5, `${lane?.wpm} WPM`);
}

// ── 200 Hz 離れて 20 dB 差 ─────────────────────────
// ここが今回の変更点。以前は 3 倍強い局がいるだけで弱い方が刻まれた
const loud = await mix([
  { text: 'CQ CQ DE JA1ABC JA1ABC K', wpm: 20, pitch: 650, gain: 0.03 },
  { text: 'JA1ABC DE DL1XYZ UR 599 599 BK', wpm: 26, pitch: 850, gain: 0.3 },
]);
console.log('20 dB 差:', JSON.stringify(loud));
ok('20 dB 弱い局も見つかる', matches(loud.found, [650, 850]), loud.found.join(', '));
ok('20 dB 弱い局を取れる（200 Hz 離れ）',
  !!laneFor(loud.lanes, 650) && tail(laneFor(loud.lanes, 650).got, 'CQ CQ DE JA1ABC JA1ABC K'),
  laneFor(loud.lanes, 650)?.got);
ok('強い局も取れる', !!laneFor(loud.lanes, 850)
  && tail(laneFor(loud.lanes, 850).got, 'JA1ABC DE DL1XYZ UR 599 599 BK'), laneFor(loud.lanes, 850)?.got);

// ── 100 Hz 離れて 10 dB 差 ─────────────────────────
const close = await mix([
  { text: 'CQ CQ DE JA1ABC JA1ABC K', wpm: 20, pitch: 650, gain: 0.1 },
  { text: 'JA1ABC DE DL1XYZ UR 599 599 BK', wpm: 26, pitch: 750, gain: 0.3 },
]);
console.log('100 Hz・10 dB:', JSON.stringify(close));
ok('100 Hz 離れて 10 dB 差でも両方取れる',
  !!laneFor(close.lanes, 650) && tail(laneFor(close.lanes, 650).got, 'CQ CQ DE JA1ABC JA1ABC K')
  && !!laneFor(close.lanes, 750) && tail(laneFor(close.lanes, 750).got, 'JA1ABC DE DL1XYZ UR 599 599 BK'),
  JSON.stringify(close.lanes));

// ── 1 局だけなら 1 局しか見つけない ────────────────
// 高調波や裾を別の局と取り違えないこと
const single = await mix([{ text: 'CQ DE JA1ABC', wpm: 20, pitch: 700, gain: 0.3 }]);
console.log('1 局:', JSON.stringify(single));
ok('1 局なら 1 局', single.found.length === 1 && matches(single.found, [700]), single.found.join(', '));

// ── 合っていない音程には反応しない ────────────────
// ゲートを緩めても、離れたトーンだけの音を拾ってはいけない
const lone = await page.evaluate(async () => {
  const cw = window.__cw;
  const ctx = cw.player.ctx;
  const bank = new cw.CWDecoderBank(ctx);
  const [ch] = await bank.setPitches([1000]);   // 1000 Hz を待つ
  let out = '';
  bank.addEventListener('char', (e) => { out += e.detail.char; });
  const dur = window.__key('EEEEE TTT', 20, 700, 0.3, bank.input);   // 鳴るのは 700 Hz
  await new Promise((r) => setTimeout(r, (dur + 1.0) * 1000));
  ch.decoder.dispose();
  return out;
});
console.log('300 Hz 離れたトーン:', JSON.stringify(lone));
ok('合っていないトーンは拾わない', lone === '', lone);

// ── 画面から通しで ────────────────────────────────
// マイクを開く（疑似マイク）→ 局を探す → レーンが並ぶ → 局を選ぶ →
// 受信欄と「相手の情報」がその局のものになる
await page.click('.tab[data-panel="support"]');
await page.waitForTimeout(300);
await page.click('#btn-sup-mic');
await page.waitForTimeout(800);
const micState = await page.evaluate(() => ({
  open: window.__cw.supportState.micOpen,
  scanEnabled: !document.querySelector('#btn-sup-scan').disabled,
  lanes: window.__cw.supportState.lanes.length,
  lanesHidden: document.querySelector('#sup-lanes').hidden,
}));
console.log('マイク:', JSON.stringify(micState));
ok('マイクを開くと「局を探す」が押せる', micState.open && micState.scanEnabled, JSON.stringify(micState));
ok('1 局のうちはレーンを見せない', micState.lanes === 1 && micState.lanesHidden, JSON.stringify(micState));

// 3 局を束の入口へ直接入れ、鳴っている間に「局を探す」を押す
const uiStations = [
  { text: 'CQ CQ CQ DE JA1ABC JA1ABC K', wpm: 18, pitch: 550, gain: 0.3 },
  { text: 'JA1ABC DE DL1XYZ DL1XYZ UR 599 599 BK', wpm: 26, pitch: 700, gain: 0.3 },
  { text: 'JA1ABC DE W1AW W1AW UR 579 579 K', wpm: 22, pitch: 850, gain: 0.3 },
];
const uiDur = await page.evaluate((stations) => {
  const bank = window.__cw.supportState.bank;
  let longest = 0;
  for (const st of stations) longest = Math.max(longest, window.__key(st.text, st.wpm, st.pitch, st.gain, bank.input));
  return longest;
}, uiStations);
await page.click('#btn-sup-scan');
await page.waitForTimeout(2600);   // 探すのに 2 秒
const afterScan = await page.evaluate(() => ({
  lanes: [...document.querySelectorAll('.sup-lane')].map((el) => ({
    hz: el.querySelector('.hz').textContent, selected: el.classList.contains('is-selected'),
  })),
  note: document.querySelector('#sup-scan-note').textContent,
  hidden: document.querySelector('#sup-lanes').hidden,
}));
console.log('探した後:', JSON.stringify(afterScan));
ok('3 局のレーンが並ぶ', afterScan.lanes.length === 3 && !afterScan.hidden, JSON.stringify(afterScan.lanes));
ok('どれか 1 局が選ばれている', afterScan.lanes.filter((l) => l.selected).length === 1);
ok('見つけた局を知らせる', /3 局/.test(afterScan.note), afterScan.note);
await page.screenshot({ path: `${DIR}/pileup-lanes.png`, fullPage: true });

// 鳴り終わるまで待ってから、850 Hz の局（W1AW）を選ぶ
await page.waitForTimeout((uiDur - 2.6 + 1.2) * 1000);
const laneTexts = await page.evaluate(() => window.__cw.supportState.lanes.map((l) => ({ pitch: l.pitch, text: l.text.trim() })));
console.log('レーンの中身:', JSON.stringify(laneTexts));
const w1aw = laneTexts.find((l) => Math.abs(l.pitch - 850) <= 20);
ok('レーンごとに自分の相手だけが流れる',
  laneTexts.every((l) => l.text.length > 5) && w1aw && /W1AW/.test(w1aw.text) && !/DL1XYZ/.test(w1aw.text),
  JSON.stringify(laneTexts));

await page.evaluate(() => {
  const lane = window.__cw.supportState.lanes.find((l) => Math.abs(l.pitch - 850) <= 20);
  document.querySelector(`.sup-lane[data-id="${lane.id}"]`).click();
});
await page.waitForTimeout(300);
const picked = await page.evaluate(() => ({
  decoded: document.querySelector('#sup-decoded').textContent.trim(),
  dxcall: document.querySelector('#sup-dxcall').value,
  rst: document.querySelector('#sup-rstr').value,
  pitch: document.querySelector('#sup-pitch').value,
  selected: window.__cw.supportState.selected,
  lanePitch: window.__cw.supportState.bank.channel(window.__cw.supportState.selected)?.pitch,
}));
console.log('選んだ後:', JSON.stringify(picked));
ok('選んだ局の文字が受信欄に入れ替わる', /W1AW/.test(picked.decoded) && !/DL1XYZ/.test(picked.decoded), picked.decoded);
ok('選んだ局から相手の情報が埋まる', picked.dxcall === 'W1AW' && picked.rst === '579', `${picked.dxcall} / ${picked.rst}`);
ok('つまみが選んだ局の音程になる', Math.abs(Number(picked.pitch) - 850) <= 20, picked.pitch);

// つまみを回すと、選んでいる局の音程だけが動く
await page.evaluate(() => {
  const s = document.querySelector('#sup-pitch');
  s.value = '900'; s.dispatchEvent(new Event('input', { bubbles: true }));
});
const retuned = await page.evaluate(() => {
  const st = window.__cw.supportState;
  return st.bank.channels.map((c) => c.pitch);
});
console.log('回した後:', JSON.stringify(retuned));
ok('つまみは選んでいる局だけを動かす', retuned.includes(900) && retuned.filter((p) => p !== 900).length === 2, retuned.join(', '));

// 鳴り終わった局は、探し直しても出てこない。
// アナライザーの平滑化は呼び出しごとに前回と混ぜるので、しばらく読まずに
// いると鳴り終わった局が -6 dB で残って見える。これを拾っていた
// （疑似マイク自身が 400 Hz 付近で鳴っているので、それは局として出てよい）
await page.click('#btn-sup-scan');
await page.waitForTimeout(2600);
const rescan = await page.evaluate(() => ({
  found: window.__cw.supportState.lanes.map((l) => l.pitch),
  note: document.querySelector('#sup-scan-note').textContent,
}));
console.log('鳴り終わってから探す:', JSON.stringify(rescan));
ok('鳴り終わった局は見つからない',
  rescan.found.every((hz) => [550, 700, 850, 900].every((old) => Math.abs(hz - old) > 20)),
  rescan.found.join(', '));

// マイクを閉じて（無音）探すと、そう言ってレーンは残す
await page.click('#btn-sup-mic');
await page.waitForTimeout(300);
const silent = await page.evaluate(async () => {
  const before = window.__cw.supportState.lanes.length;
  const peaks = await window.__cw.scanSupportStations();
  return { peaks, before, after: window.__cw.supportState.lanes.length,
    note: document.querySelector('#sup-scan-note').textContent };
});
console.log('無音で探す:', JSON.stringify(silent));
ok('何も鳴っていなければそう言い、レーンは残す',
  silent.peaks.length === 0 && /見つかりません/.test(silent.note) && silent.after === silent.before,
  JSON.stringify(silent));
await page.screenshot({ path: `${DIR}/pileup-picked.png`, fullPage: true });

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
