// パドル操作とキーヤー設定のチュートリアル
//
// 各ステップは説明文と合格条件を持つ。合格条件は、打った要素・解読文字・
// 設定値を受け取る check() で判定し、満たしたら自動で次へ進む。
//
// check(ctx) の ctx:
//   { elements: 直近に打った要素の配列, text: 解読済み文字列,
//     lastChar: 直前に確定した文字, settings: 現在の設定, touched: 変更した設定名の集合 }

export const TUTORIAL_STEPS = [
  {
    id: 'intro',
    title: 'パドルとエレクトロニックキーヤー',
    body: [
      'パドルは「短点側」と「長点側」の 2 枚のレバーでできています。この環境では左クリックが短点、右クリックが長点に配線されています。',
      '縦振り電鍵と違い、符号の長さはキーヤーが作ります。あなたが決めるのは「どちらを、いつ、どれだけの間押すか」だけです。押している時間の長短で短点と長点を打ち分ける必要はありません。',
      '持ち方は、親指で短点側、人差し指で長点側に軽く触れるのが一般的です。力を入れず、指の腹を添える程度にしてください。',
    ],
    goal: 'まずは読むだけです。「次へ」で進んでください。',
    check: null,
  },
  {
    id: 'dits',
    title: '短点を連続で出す',
    body: [
      '短点側（左ボタン）を押したままにしてください。押している間、キーヤーが正確な間隔で短点を打ち続けます。',
      'これがエレクトロニックキーヤーの一番の利点です。手で刻む必要はありません。',
    ],
    goal: '短点を 5 個以上続けて打つ',
    check: (ctx) => tailRun(ctx.elements, '.') >= 5,
  },
  {
    id: 'dahs',
    title: '長点を連続で出す',
    body: [
      '今度は長点側（右ボタン）を押したままにしてください。長点は短点 3 個分の長さで、こちらも自動で連続します。',
      '短点と長点の長さの違いを、耳でしっかり覚えてください。',
    ],
    goal: '長点を 4 個以上続けて打つ',
    check: (ctx) => tailRun(ctx.elements, '-') >= 4,
  },
  {
    id: 'letter-a',
    title: '1 文字打ってみる — A（・－）',
    body: [
      '短点をひとつ、続けて長点をひとつ打つと A になります。左を軽く 1 回、間を空けずに右を 1 回です。',
      '打ち終えて少し待つと、下の「解読結果」に文字が出ます。文字の区切りは、手を止めた時間でキーヤーが判断しています。',
    ],
    goal: 'A を 1 文字打つ',
    check: (ctx) => ctx.lastChar === 'A',
  },
  {
    id: 'letter-n',
    title: '逆の順で — N（－・）',
    body: [
      '今度は長点が先、短点が後です。A と N は同じ 2 要素でも順序が逆なだけで、耳では紛らわしい組み合わせです。',
      '指がどちらを先に動かすか、意識して打ち分けてください。',
    ],
    goal: 'N を 1 文字打つ',
    check: (ctx) => ctx.lastChar === 'N',
  },
  {
    id: 'squeeze',
    title: 'スクイーズ（両方を握る）',
    body: [
      'アイアンビックキーヤーの本領です。両方のレバーを同時に押さえると、短点と長点が交互に出ます。',
      '先に押したほうが最初の要素になります。長点側を先に押してから両方を握ると、－・－・… と交互に続きます。',
      'C（－・－・）を打ってみましょう。長点側を押す → すぐ両方を握る → 4 要素目で両方を離す、という手順です。',
    ],
    goal: 'C を 1 文字打つ',
    check: (ctx) => ctx.lastChar === 'C',
  },
  {
    id: 'mode',
    title: 'モード A と B の違い',
    body: [
      'スクイーズを解いた瞬間の動きがモードによって変わります。',
      '<strong>アイアンビック B</strong>（多くの市販キーヤーの既定値）は、両方を離した後にもう 1 要素だけ余分に送ります。3 要素目の途中で離しても 4 要素目が出るので、指を早めに離す打ち方ができます。',
      '<strong>アイアンビック A</strong> は余分な要素を出しません。離した時点で送出中の要素を最後に止まります。',
      'ページ下部の設定欄にある「キーヤーモード」を切り替えて、同じスクイーズを試してみてください。どちらが手に合うかは好みです。迷ったら B のままで構いません。',
    ],
    goal: 'キーヤーモードを一度切り替えてみる',
    check: (ctx) => ctx.touched.has('keyerMode'),
  },
  {
    id: 'speed',
    title: '速度（WPM）の合わせ方',
    body: [
      '速度は短点の長さそのものです。20 WPM なら短点は 60 ミリ秒になります。',
      'まずは<strong>正確に打てる速度</strong>まで落としてください。速く打ち崩すより、遅くても崩れないほうが相手に届きます。目安として、自分が余裕を持って聞き取れる速度より 2〜3 WPM 遅いあたりが打ちやすい範囲です。',
      'ページ下部の設定欄にある「送信速度」を動かして、打ちやすい速さを探してください。',
    ],
    goal: '送信速度を変更する',
    check: (ctx) => ctx.touched.has('keyerWpm'),
  },
  {
    id: 'weight',
    title: 'ウェイトの調整',
    body: [
      'ウェイトは、音を出している時間（マーク）と休んでいる時間（スペース）の比率です。50% が標準で、短点と、その後の間が同じ長さになります。',
      '値を上げると符号が重く粘ったような響きになり、下げると軽く歯切れよくなります。全体の速度は変わりません。',
      '極端な値は相手にとって聞き取りにくくなります。実際の交信では 45〜55% の範囲に収めるのが無難です。',
      'ページ下部の設定欄にある「ウェイト」を動かし、同じ文字を打って響きの違いを聞き比べてください。',
    ],
    goal: 'ウェイトを変更して、何か 1 文字打つ',
    check: (ctx) => ctx.touched.has('keyerWeight') && ctx.lastChar != null,
  },
  {
    id: 'swap',
    title: '左右の入れ替え',
    body: [
      '短点と長点をどちらの指に割り当てるかは、利き手や好みで変わります。左利きの方や、逆のほうがしっくりくる方は「左右を入れ替える」を使ってください。',
      '一度決めたら変えないほうが上達します。指が順序を覚えてしまうためです。',
    ],
    goal: '読むだけです。設定はそのままで構いません。',
    check: null,
  },
  {
    id: 'word',
    title: '語を打つ — CQ',
    body: [
      '文字と文字の間は、短点 3 個分ほど手を止めます。キーヤーはこの間で文字の切れ目を判断します。',
      'C（－・－・）と Q（－－・－）を続けて打ってみましょう。焦らず、文字の間でしっかり手を止めるのがコツです。',
    ],
    goal: 'CQ と打つ',
    check: (ctx) => ctx.text.replace(/\s+/g, '').endsWith('CQ'),
  },
  {
    id: 'callsign',
    title: '自局のコールサインを打つ',
    body: [
      '最後に、自分のコールサインを打ってみましょう。交信で最も多く打つ符号です。',
      '手が覚えるまで繰り返す価値があります。打ち終えたら、この下の「課題」機能で他の課題にも挑戦してください。',
    ],
    goal: (settings) => `${settings.callsign} と打つ`,
    check: (ctx) => ctx.text.replace(/\s+/g, '').endsWith(
      String(ctx.settings.callsign || '').toUpperCase(),
    ),
  },
  {
    id: 'done',
    title: '基本は以上です',
    body: [
      'お疲れさまでした。あとは実際に打つ量がものを言います。',
      'この下の「課題」でコールサインや定型文を繰り返し、慣れてきたら「コンテスト運用」タブで実戦的な速さを試してみてください。',
      '設定を変えたくなったら、いつでもこのチュートリアルに戻れます。',
    ],
    goal: '完了',
    check: null,
  },
];

/** 配列の末尾に value が何個連続しているかを数える。 */
function tailRun(elements, value) {
  let n = 0;
  for (let i = elements.length - 1; i >= 0 && elements[i] === value; i--) n += 1;
  return n;
}

/** チュートリアルの進行状態を持つ小さなコントローラー。 */
export class Tutorial {
  constructor() {
    this.index = 0;
    this.elements = [];
    this.text = '';
    this.lastChar = null;
    this.touched = new Set();
  }

  get step() {
    return TUTORIAL_STEPS[this.index];
  }

  get total() {
    return TUTORIAL_STEPS.length;
  }

  get isLast() {
    return this.index >= TUTORIAL_STEPS.length - 1;
  }

  goto(index) {
    this.index = Math.max(0, Math.min(index, TUTORIAL_STEPS.length - 1));
    this.clearInput();
  }

  next() { this.goto(this.index + 1); }
  prev() { this.goto(this.index - 1); }

  clearInput() {
    this.elements = [];
    this.text = '';
    this.lastChar = null;
    this.touched.clear();
  }

  pushElement(element) {
    this.elements.push(element);
    if (this.elements.length > 200) this.elements.shift();
  }

  pushChar(char) {
    this.lastChar = char;
    if (char) this.text += char;
  }

  markTouched(name) {
    this.touched.add(name);
  }

  /** 現在のステップの合格条件を満たしているか。 */
  isCleared(settings) {
    const step = this.step;
    if (!step?.check) return false;
    return !!step.check({
      elements: this.elements,
      text: this.text,
      lastChar: this.lastChar,
      settings,
      touched: this.touched,
    });
  }

  goalText(settings) {
    const goal = this.step?.goal;
    return typeof goal === 'function' ? goal(settings) : goal || '';
  }
}
