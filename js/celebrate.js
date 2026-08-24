// 100点＋ を出したときの祝い方。10 種類から選べる。
//
// 「何を出すか」だけをここに書き、見た目は style.css の
// [data-celebrate="…"] 側に置く。粒の飛ぶ向きのように CSS だけでは
// 書けない値は、要素ごとにカスタムプロパティで渡す。
//
// どの祝い方も次の形で作る:
//   - box（採点欄）に data-celebrate と .is-celebrating が付く
//   - 飾りは stage（採点欄に重ねた透明な板）の中だけに置く
//   - ms 経過後に stage ごと片付ける
// 動きを減らす設定のときは stage を作らない。色と音だけで祝う。

/** 飾りの粒などをまとめて作る。 */
function fill(n, make) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) frag.appendChild(make(i, n));
  return frag;
}

/** style 文字列を付けた要素を作る小道具。 */
function el(tag, style, text) {
  const node = document.createElement(tag);
  if (style) node.style.cssText = style;
  if (text != null) node.textContent = text;
  return node;
}

/** 0..1 の乱数を min..max に写す。 */
const between = (min, max) => min + Math.random() * (max - min);

/**
 * 「100点＋」の中心が stage の中でどこに来るか。
 * 札の幅は文字数で変わるので、決め打ちせずに測る。
 */
function badgeCenter(ctx) {
  const { badge, stage } = ctx;
  if (!badge || !stage) return { x: 60, y: 30 };
  const b = badge.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  return { x: b.left - s.left + b.width / 2, y: b.top - s.top + b.height / 2 };
}

/** 扇形に飛ばす粒の向き。上向きを中心に left..right 度へ広げる。 */
function spray(i, n, { speed = [60, 130], spread = 140 } = {}) {
  const deg = -90 - spread / 2 + (spread * i) / Math.max(1, n - 1);
  const rad = deg * (Math.PI / 180);
  const v = between(speed[0], speed[1]);
  return { dx: Math.round(Math.cos(rad) * v), dy: Math.round(Math.sin(rad) * v) };
}

// ═══════════════════════════════════════════ 祝い方の定義

/**
 * 10 種類の祝い方。id は保存する値なので変えないこと。
 * name はそのまま選択肢に出る。note は選んだときの一行説明。
 */
export const CELEBRATIONS = [
  // ── 1 ──────────────────────────────────────────
  {
    id: 'confetti',
    name: '紙吹雪',
    note: '「100点＋」から色紙が扇形に散ります。標準の祝い方です。',
    ms: 1600,
    // タタタ ター。既定のファンファーレ
    sound: undefined,
    run(ctx) {
      const c = badgeCenter(ctx);
      const n = 18;
      const colors = ['var(--ok)', 'var(--accent)', 'var(--rx)', 'var(--tx)', '#ffffff'];
      ctx.stage.appendChild(fill(n, (i) => {
        const { dx, dy } = spray(i, n);
        return el('i', `left:${c.x}px; top:${c.y}px;
          --dx:${dx}px; --dy:${dy}px;
          --rot:${Math.round(between(-360, 360))}deg;
          --delay:${between(0, 0.12).toFixed(3)}s;
          background:${colors[i % colors.length]};`);
      }));
    },
  },

  // ── 2 ──────────────────────────────────────────
  {
    id: 'fireworks',
    name: '花火',
    note: '採点欄の三か所で、時間差の光の玉が開きます。',
    ms: 2200,
    sound: {
      notes: [
        // 打ち上げの音（低い所から滑り上がる）と、開いたときの散り音
        { ratio: 0.5, to: 1.6, at: 0,    len: 0.28, gain: 0.22 },
        { ratio: 2,   at: 0.30, len: 0.5, decay: 0.14 },
        { ratio: 5 / 2, at: 0.34, len: 0.45, decay: 0.14, gain: 0.3 },
        { ratio: 0.5, to: 1.8, at: 0.55, len: 0.28, gain: 0.2 },
        { ratio: 3,   at: 0.85, len: 0.5, decay: 0.16 },
        { ratio: 2,   at: 0.88, len: 0.5, decay: 0.16, gain: 0.28 },
        { ratio: 4,   at: 1.30, len: 0.7, decay: 0.22, gain: 0.3 },
        { ratio: 3,   at: 1.30, len: 0.7, decay: 0.22, gain: 0.26 },
      ],
    },
    run(ctx) {
      // 打ち上げ位置は採点欄の幅に対する割合で決める。窓の幅が変わっても
      // 三つが同じ間隔で散る
      [[0.25, 0.35, 0], [0.6, 0.25, 0.5], [0.42, 0.55, 1.0]].forEach(([fx, fy, delay]) => {
        const shell = el('div', `left:${fx * 100}%; top:${fy * 100}%; --delay:${delay}s;`);
        shell.className = 'shell';
        const n = 16;
        shell.appendChild(fill(n, (i) => {
          const deg = (360 * i) / n;
          const rad = deg * (Math.PI / 180);
          const v = between(46, 62);
          return el('i', `--dx:${Math.round(Math.cos(rad) * v)}px;
            --dy:${Math.round(Math.sin(rad) * v)}px;`);
        }));
        ctx.stage.appendChild(shell);
      });
    },
  },

  // ── 3 ──────────────────────────────────────────
  {
    id: 'stamp',
    name: '合格スタンプ',
    note: '「合格」の judge印が勢いよく捺され、採点欄が一度だけ揺れます。',
    ms: 1500,
    sound: {
      notes: [
        // 捺した瞬間の低い衝撃。そのあとに明るい一音
        { ratio: 0.35, at: 0,    len: 0.10, wave: 'triangle', gain: 0.5, decay: 0.05 },
        { ratio: 0.7,  at: 0,    len: 0.12, gain: 0.3, decay: 0.05 },
        { ratio: 2,    at: 0.16, len: 0.45, decay: 0.13 },
        { ratio: 3 / 2, at: 0.16, len: 0.45, decay: 0.13, gain: 0.25 },
      ],
    },
    run(ctx) {
      const stamp = el('div', null, '合格');
      stamp.className = 'stamp';
      ctx.stage.appendChild(stamp);
      const ring = el('div');
      ring.className = 'shock';
      ctx.stage.appendChild(ring);
    },
  },

  // ── 4 ──────────────────────────────────────────
  {
    id: 'medal',
    name: '表彰',
    note: '金メダルがせり上がり、採点欄が金色の枠になります。',
    ms: 2400,
    sound: {
      // ゆったりした三音の呼び出しから、伸ばした主和音へ
      notes: [
        { ratio: 1,     at: 0,    len: 0.16 },
        { ratio: 3 / 2, at: 0.18, len: 0.16 },
        { ratio: 2,     at: 0.36, len: 0.70, decay: 0.2 },
        { ratio: 3 / 2, at: 0.40, len: 0.66, decay: 0.2, gain: 0.26 },
        { ratio: 5 / 4, at: 0.44, len: 0.62, decay: 0.2, gain: 0.22 },
      ],
    },
    run(ctx) {
      const medal = el('div');
      medal.className = 'medal';
      medal.appendChild(el('span', null, '1'));
      const ribbon = el('div');
      ribbon.className = 'ribbon';
      // 光沢が一度だけ横切る
      const sheen = el('div');
      sheen.className = 'sheen';
      ctx.stage.append(ribbon, medal, sheen);
    },
  },

  // ── 5 ──────────────────────────────────────────
  {
    id: 'marquee',
    name: '電光掲示板',
    note: '「100点＋」が一文字ずつ点灯し、枠を光が回ります。',
    ms: 2200,
    sound: {
      // 点灯に合わせた短い電子音を階段状に積む
      notes: [0, 1, 2, 3, 4, 5].map((i) => ({
        ratio: 1 + i * 0.25, at: i * 0.08, len: 0.06,
        wave: 'square', gain: 0.16, decay: 0.02,
      })).concat([
        { ratio: 3, at: 0.55, len: 0.5, wave: 'square', gain: 0.18, decay: 0.14 },
        { ratio: 2, at: 0.55, len: 0.5, wave: 'square', gain: 0.16, decay: 0.14 },
      ]),
    },
    run(ctx) {
      // 一文字ずつ点灯させるため、札の中身を字ごとに包み直す。
      // 文字そのものは変えないので、読み上げには影響しない
      const { badge } = ctx;
      if (badge) {
        const text = badge.textContent;
        badge.textContent = '';
        badge.appendChild(fill([...text].length, (i) => {
          const s = el('span', `--i:${i};`, [...text][i]);
          s.className = 'lit';
          return s;
        }));
      }
      // 枠を回る光
      ['t', 'r', 'b', 'l'].forEach((side) => {
        const bar = el('div');
        bar.className = `chase chase-${side}`;
        ctx.stage.appendChild(bar);
      });
    },
  },

  // ── 6 ──────────────────────────────────────────
  {
    id: 'morse',
    name: 'モールスで祝う',
    note: '「FB」（素晴らしい）を符号で光らせ、そのまま符号の音で鳴らします。',
    ms: 2400,
    sound: {
      // FB = ..-. -... 側音そのものの高さで、実際の符号として鳴らす。
      // 20 WPM 相当（短点 60 ms）
      notes: (() => {
        const dit = 0.06;
        const out = [];
        let t = 0;
        for (const ch of ['..-.', ' ', '-...']) {
          if (ch === ' ') { t += dit * 3; continue; }
          for (const m of ch) {
            const len = m === '-' ? dit * 3 : dit;
            out.push({ ratio: 1, at: t, len, gain: 0.4, decay: 0.012 });
            t += len + dit;
          }
        }
        // 打ち終わりに主和音をひとつ添えて「祝い」にする
        out.push({ ratio: 2, at: t + 0.12, len: 0.5, decay: 0.16 });
        out.push({ ratio: 3 / 2, at: t + 0.12, len: 0.5, decay: 0.16, gain: 0.26 });
        return out;
      })(),
    },
    run(ctx) {
      // 画面にも同じ符号を、音と同じ間合いで光らせる
      const strip = el('div');
      strip.className = 'morse-strip';
      let step = 0;
      for (const ch of ['..-.', ' ', '-...']) {
        if (ch === ' ') {
          const gap = el('span');
          gap.className = 'sp';
          strip.appendChild(gap);
          step += 3;
          continue;
        }
        for (const m of ch) {
          const mark = el('i', `--step:${step};`);
          mark.className = m === '-' ? 'dah' : 'dit';
          strip.appendChild(mark);
          step += m === '-' ? 4 : 2;
        }
      }
      const label = el('span', null, 'FB');
      label.className = 'morse-label';
      strip.appendChild(label);
      ctx.stage.appendChild(strip);
    },
  },

  // ── 7 ──────────────────────────────────────────
  {
    id: 'smeter',
    name: 'Ｓメーター振り切れ',
    note: '針が一気に振り切れて S9+60 で止まります。',
    ms: 2200,
    sound: {
      notes: [
        // 針の駆け上がりを滑る音で、当たった所で「コッ」と止める
        { ratio: 0.6, to: 2.4, at: 0, len: 0.32, gain: 0.3 },
        { ratio: 3, at: 0.33, len: 0.05, wave: 'triangle', gain: 0.4, decay: 0.02 },
        { ratio: 2, at: 0.45, len: 0.55, decay: 0.15 },
        { ratio: 5 / 4, at: 0.45, len: 0.55, decay: 0.15, gain: 0.24 },
      ],
    },
    run(ctx) {
      const meter = el('div');
      meter.className = 'smeter';
      meter.innerHTML = `
        <svg viewBox="0 0 120 62" aria-hidden="true">
          <path class="arc" d="M12 56 A 48 48 0 0 1 108 56" />
          <path class="arc hot" d="M78 22.5 A 48 48 0 0 1 108 56" />
          <g class="needle"><line x1="60" y1="56" x2="60" y2="14" /></g>
          <circle class="hub" cx="60" cy="56" r="3.5" />
        </svg>
        <span class="peg">S9+60</span>`;
      ctx.stage.appendChild(meter);
    },
  },

  // ── 8 ──────────────────────────────────────────
  {
    id: 'sakura',
    name: '桜と朱印',
    note: '朱の丸印が捺され、花びらがゆっくり舞い落ちます。',
    ms: 3200,
    sound: {
      // 澄んだ二音を間を空けて。余韻を長く取る
      notes: [
        { ratio: 2,     at: 0,    len: 0.9, decay: 0.42, gain: 0.34 },
        { ratio: 3,     at: 0,    len: 0.9, decay: 0.38, gain: 0.12 },
        { ratio: 3 / 2, at: 0.42, len: 1.1, decay: 0.5,  gain: 0.3 },
        { ratio: 9 / 4, at: 0.42, len: 1.1, decay: 0.45, gain: 0.1 },
      ],
    },
    run(ctx) {
      const seal = el('div', null, '秀');
      seal.className = 'seal';
      ctx.stage.appendChild(seal);
      const n = 14;
      ctx.stage.appendChild(fill(n, (i) => el('b', `
        left:${between(2, 96).toFixed(1)}%;
        --drift:${Math.round(between(-40, 40))}px;
        --spin:${Math.round(between(-200, 200))}deg;
        --delay:${between(0, 1.1).toFixed(2)}s;
        --dur:${between(2, 2.8).toFixed(2)}s;
        --size:${between(7, 12).toFixed(1)}px;`)));
    },
  },

  // ── 9 ──────────────────────────────────────────
  {
    id: 'arcade',
    name: 'レトロゲーム',
    note: '「PERFECT!!」が飛び出し、画面が短く揺れます。',
    ms: 1800,
    sound: {
      // 8 bit 風。矩形波を速く駆け上がって、上で二回跳ねる
      notes: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
        ratio: 1 * Math.pow(2, i / 6), at: i * 0.045, len: 0.04,
        wave: 'square', gain: 0.2, decay: 0.012,
      })).concat([
        { ratio: 2, at: 0.34, len: 0.06, wave: 'square', gain: 0.24, decay: 0.02 },
        { ratio: 3, at: 0.42, len: 0.06, wave: 'square', gain: 0.24, decay: 0.02 },
        { ratio: 4, at: 0.50, len: 0.30, wave: 'square', gain: 0.22, decay: 0.09 },
      ]),
    },
    run(ctx) {
      const word = el('div');
      word.className = 'arcade-word';
      word.appendChild(fill(9, (i) => el('span', `--i:${i};`, 'PERFECT!!'[i])));
      ctx.stage.appendChild(word);
      // 角ばった火花。8 色だけを使う
      const px = ['#ffffff', '#ffe66d', '#4ecdc4', '#ff6b6b', '#a3e635', '#60a5fa'];
      const n = 12;
      const c = badgeCenter(ctx);
      ctx.stage.appendChild(fill(n, (i) => {
        const { dx, dy } = spray(i, n, { speed: [50, 90], spread: 190 });
        return el('i', `left:${c.x}px; top:${c.y}px;
          --dx:${dx}px; --dy:${dy}px; --delay:${(i * 0.012).toFixed(3)}s;
          background:${px[i % px.length]};`);
      }));
    },
  },

  // ── 10 ─────────────────────────────────────────
  {
    id: 'quiet',
    name: '静かに',
    note: '光がゆっくり一度だけ横切ります。粒も揺れも出しません。',
    ms: 1800,
    sound: {
      // 一音だけ。長く伸ばして静かに消す
      notes: [
        { ratio: 3 / 2, at: 0,    len: 1.0, decay: 0.45, gain: 0.26 },
        { ratio: 2,     at: 0.22, len: 0.9, decay: 0.42, gain: 0.16 },
      ],
    },
    run(ctx) {
      const wave = el('div');
      wave.className = 'ripple';
      ctx.stage.appendChild(wave);
    },
  },
];

/** 「おまかせ」を表す id。祝うたびに 10 種類から選び直す。 */
export const RANDOM_ID = 'random';

/** 直前に出した祝い方。おまかせで 2 回続けて同じものを出さないために覚える。 */
let lastPicked = null;

/**
 * id から祝い方を引く。
 *
 * おまかせのときは毎回選び直す。ただし直前と同じものは避ける。
 * 続けて同じものが出ると「おまかせが効いていない」と見えるため。
 * 知らない id は既定（紙吹雪）に落とす。
 */
export function celebrationById(id) {
  if (id === RANDOM_ID) {
    const pool = CELEBRATIONS.length > 1
      ? CELEBRATIONS.filter((c) => c.id !== lastPicked)
      : CELEBRATIONS;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    lastPicked = picked.id;
    return picked;
  }
  return CELEBRATIONS.find((c) => c.id === id) ?? CELEBRATIONS[0];
}

/** いま動いている祝いの後片付け。祝い方ごとに 1 つだけ動かす。 */
const running = new WeakMap();

/**
 * 採点欄で祝う。
 *
 * @param {HTMLElement} box     採点結果の器（設定画面の見本でも使う）
 * @param {object} opts
 * @param {string} opts.id      祝い方の id
 * @param {(p?: object) => Promise<void>} [opts.play] 音を鳴らす関数
 * @param {boolean} [opts.motion] 動きを出してよいか（既定は OS 設定に従う）
 * @returns {object|undefined} 実際に出した祝い方（おまかせのときはその回の 1 つ）
 */
export function runCelebration(box, { id, play, motion } = {}) {
  if (!box) return undefined;
  const style = celebrationById(id);

  clearTimeout(running.get(box));
  box.querySelector('.celebrate-stage')?.remove();

  // 続けて出したとき、アニメーションが 2 回目から効かなくなる。
  // クラスを外して強制的に再計算させてから付け直す
  box.classList.remove('is-celebrating');
  void box.offsetWidth;
  box.dataset.celebrate = style.id;
  box.classList.add('is-celebrating');

  // 音が出せない環境（AudioContext 不可・無音設定）でも見た目の祝いは続ける
  if (play) play(style.sound)?.catch?.(() => {});

  const allowed = motion ?? !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!allowed) return style;

  const stage = el('div');
  stage.className = 'celebrate-stage';
  stage.setAttribute('aria-hidden', 'true');   // 読み上げには関係がない飾り
  box.appendChild(stage);

  style.run({ box, stage, badge: box.querySelector('.big.is-plus') });

  // 終わったら片付ける。残しておくと次の採点でごみが積もる
  running.set(box, setTimeout(() => {
    stage.remove();
    running.delete(box);
  }, style.ms));

  return style;
}

/** 祝いの跡を消す（打ち直す・次の課題へ進むとき）。 */
export function clearCelebration(box) {
  if (!box) return;
  clearTimeout(running.get(box));
  running.delete(box);
  box.querySelector('.celebrate-stage')?.remove();
  box.classList.remove('is-celebrating');
  delete box.dataset.celebrate;
}
