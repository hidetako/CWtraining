// 打鍵の反応（詰まっても要素が消えないこと・側音がフェージングを受けないこと）
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(400);

/** scheduleKey を覗いて、各要素が「いつ鳴る予約になったか」を集める。 */
const watchSchedule = () => page.evaluate(() => {
  const pl = window.__cw.player;
  window.__sched = [];
  if (pl.__watched) return;
  pl.__watched = true;
  const orig = pl.scheduleKey.bind(pl);
  pl.scheduleKey = (when, dur) => {
    const now = pl.ctx.currentTime;
    window.__sched.push({
      lead: Math.round((when - now) * 1000),          // 鳴り始めまで（負なら過去）
      endLead: Math.round((when + dur - now) * 1000), // 鳴り終わりまで
    });
    return orig(when, dur);
  };
});

const pad = async (holdMs, stallMs = 0) => {
  const box = await page.locator('#pw-left').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  if (stallMs) {
    await page.evaluate((ms) => {
      const t = performance.now();
      while (performance.now() - t < ms) { /* メインスレッドを詰まらせる */ }
    }, stallMs);
  }
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await page.waitForTimeout(500);
};

// ═══════════════ 押してすぐ鳴る ═══════════════
await watchSchedule();
await page.evaluate(() => { window.__cw.keyer.reset(); window.__sched = []; });
await pad(60);
const quiet = await page.evaluate(() => window.__sched);
console.log('通常時の先出し(ms):', JSON.stringify(quiet.map((s) => s.lead)));
ok('押してすぐ鳴る（20ms 以内）', quiet.length > 0 && quiet.every((s) => s.lead <= 20),
  JSON.stringify(quiet.map((s) => s.lead)));
ok('過去に予約しない', quiet.every((s) => s.lead >= 0), JSON.stringify(quiet.map((s) => s.lead)));

const ctxInfo = await page.evaluate(() => {
  const c = window.__cw.player.ctx;
  return { base: c.baseLatency, out: c.outputLatency, state: c.state };
});
console.log('AudioContext:', JSON.stringify(ctxInfo));
ok('低遅延で動いている', ctxInfo.state === 'running' && ctxInfo.base <= 0.05,
  JSON.stringify(ctxInfo));

// ═══════════════ 詰まっても要素が消えない ═══════════════
// 描画や GC でメインスレッドが止まると、鳴らしたい時刻が過ぎてしまう。
// 過ぎたまま予約すると音量の予約がすべて過去になり、その要素は
// 鳴らずに消える（解読も ＊ になる）
for (const stall of [120, 400]) {
  await page.evaluate(() => { window.__cw.keyer.reset(); window.__sched = []; });
  await pad(400, stall);
  const s = await page.evaluate(() => window.__sched);
  const text = await page.evaluate(() => window.__cw.keyer.text + window.__cw.keyer.buffer);
  const dropped = s.filter((x) => x.endLead < 0).length;
  console.log(`${stall}ms 詰まらせたとき:`, JSON.stringify(s.map((x) => x.lead)),
    '/ 解読:', JSON.stringify(text));
  ok(`${stall}ms 詰まっても要素が消えない`, dropped === 0, `${dropped} 個消えた`);
  ok(`${stall}ms 詰まっても過去に予約しない`, s.every((x) => x.lead >= 0),
    JSON.stringify(s.map((x) => x.lead)));
  ok(`${stall}ms 詰まっても解読できる`, !text.includes('＊'), JSON.stringify(text));
}

// ═══════════════ 側音はフェージングを受けない ═══════════════
// 自分の打鍵音が波打つと、打っている最中に強弱が付いて打ちにくい。
// QSB は相手の電波の話なので、自局の側音には掛けない
const routed = await page.evaluate(async () => {
  const pl = window.__cw.player;
  pl.setSettings({ qsb: 1 });                        // フェージングを最大にする
  await new Promise((r) => setTimeout(r, 400));      // 反映は時定数付きなので待つ
  return {
    bus: pl._keyLine?.bus ?? null,     // 側音をどちらのバスへ流したか
    qsbDepth: Math.round(pl.qsbDepth.gain.value * 1000) / 1000,
  };
});
console.log('側音の経路:', JSON.stringify(routed));
ok('側音は送信バスへ流す', routed.bus === 'tx', JSON.stringify(routed));
ok('受信側のフェージングは効いている', routed.qsbDepth > 0, JSON.stringify(routed));

// フェージングを掛けたまま打っても、打鍵そのものは変わらないこと
await page.evaluate(() => { window.__cw.keyer.reset(); });
await pad(60);
const underQsb = await page.evaluate(() => window.__cw.keyer.text.trim());
ok('フェージング中でも打鍵できる', underQsb === 'E', underQsb);
await page.evaluate(() => window.__cw.player.setSettings({ qsb: 0 }));

// ═══════════════ 打鍵そのものは今までどおり ═══════════════
await page.evaluate(() => window.__cw.keyer.reset());
await pad(60);
await page.waitForTimeout(400);
const dit = await page.evaluate(() => window.__cw.keyer.text.trim());
console.log('短点を 1 つ:', JSON.stringify(dit));
ok('短点が E と解読される', dit === 'E', dit);

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
