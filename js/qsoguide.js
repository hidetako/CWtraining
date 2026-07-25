// ラバースタンプ交信の「型」の知識
//
// 交信シミュレーターのガイド付きモードで使う。各段階が何のためにあるのか、
// そこで何を送るのか、相手の反応をどう読むのかを説明する。

/**
 * 交信の段階。CQ を出す側・応答する側のどちらでも、
 * 「呼び出し → 応答 → 第 1 交換 → 第 2 交換 → 締め」の流れは変わらない。
 */
export const PHASES = {
  cq: {
    title: '呼び出し（CQ）',
    purpose: '誰でもいいので交信相手を探す送信です。',
    tip: 'CQ を 3 回、自分のコールサインを 2〜3 回。最後は K（どうぞ）で締めます。'
      + '出す前に QRL?（この周波数は使用中ですか）を打って確認するのが礼儀です。',
  },
  call: {
    title: '応答（相手を呼ぶ）',
    purpose: '出ている CQ に対して、自分の存在を知らせます。',
    tip: '相手のコールサイン → DE → 自分のコールサイン、の順です。'
      + 'パイルアップでなければ自分のコールを 2 回打つと取ってもらいやすくなります。',
  },
  pickup: {
    title: '応答を受ける',
    purpose: '呼んできた局のコールサインを正確に取ります。',
    tip: 'ここで取り違えると後が全部ずれます。自信が無ければ ? や AGN? で聞き直して構いません。',
  },
  exchange1: {
    title: '第 1 交換（レポート・名前・QTH）',
    purpose: '交信の中身です。信号の状態・名前・運用地を伝えます。',
    tip: 'UR RST 599 → NAME → QTH の順が定番。大事な語は 2 回繰り返します。'
      + '最後に HW?（いかがですか）を付けて相手に返します。',
  },
  exchange2: {
    title: '第 2 交換（了解と設備）',
    purpose: '相手の内容を受け取ったことを示し、自分の設備を伝えます。',
    tip: 'R R（了解）から始めるのが定番。相手の名前を呼ぶと丁寧です。'
      + 'RIG・PWR・ANT を伝え、TNX FER QSO で締めに向かいます。',
  },
  close: {
    title: '締め（73）',
    purpose: '交信を終わらせます。',
    tip: '73（敬意を込めて）と CUAGN（また会いましょう）が定番。'
      + '最後は SK（交信終了）のプロサインで閉じます。',
  },
};

/**
 * 型の早見表。ガイド画面と、いつでも開けるチートシートで共用する。
 * `送信例` の <MY> <DX> は自局・相手局のコールサインに置き換える。
 */
export const PATTERN_SHEET = [
  {
    phase: 'cq',
    who: '自分',
    example: 'QRL? / CQ CQ CQ DE <MY> <MY> <MY> PSE K',
    parts: [
      ['QRL?', 'この周波数は使用中ですか（CQ を出す前の確認）'],
      ['CQ', '誰でもどうぞ、という一般呼出し'],
      ['DE', 'こちらは（差出人を示す）'],
      ['PSE K', 'どうぞ送信してください'],
    ],
  },
  {
    phase: 'call',
    who: '相手',
    example: '<MY> DE <DX> <DX> K',
    parts: [
      ['<MY>', 'あなたのコールサイン＝誰に向けて打っているか'],
      ['DE <DX>', 'こちらは（呼んできた局）'],
      ['K', 'どうぞ'],
    ],
  },
  {
    phase: 'exchange1',
    who: '自分',
    example: '<DX> DE <MY> = GE OM TNX FER CALL = UR RST 599 599 '
      + '= NAME TARO TARO = QTH TOKYO TOKYO = HW? <DX> DE <MY> K',
    parts: [
      ['=', '区切り（BT）。話題の切れ目に打つ'],
      ['GE OM', 'こんばんは、男性局へ（GM 朝 / GA 昼 / GE 夜）'],
      ['TNX FER CALL', '呼んでくれてありがとう'],
      ['UR RST 599', 'あなたの信号は 599 です'],
      ['NAME / QTH', '名前 / 運用地。大事な語は 2 回打つ'],
      ['HW?', 'いかがですか（相手に返す合図）'],
    ],
  },
  {
    phase: 'exchange2',
    who: '相手',
    example: '<MY> DE <DX> = R R FB = UR RST 599 = NAME BOB = QTH BERLIN '
      + '= RIG IC-7300 PWR 100W = ANT DP = HW? <MY> DE <DX> K',
    parts: [
      ['R R', '了解しました'],
      ['FB', '素晴らしい（fine business）'],
      ['RIG / PWR / ANT', '無線機 / 出力 / アンテナ'],
    ],
  },
  {
    phase: 'exchange2',
    who: '自分',
    example: '<DX> DE <MY> = R R FB BOB ALL SOLID = MY RIG IC-7300 PWR 50W '
      + '= ANT DP = TNX FER NICE QSO ES 73 = <DX> DE <MY> K',
    parts: [
      ['ALL SOLID', '全部完全に取れました'],
      ['MY RIG …', '自分の設備を伝える'],
      ['TNX FER NICE QSO', '良い交信をありがとう（締めへの合図）'],
    ],
  },
  {
    phase: 'close',
    who: '両方',
    example: '<DX> DE <MY> R TU 73 ES CUAGN <SK>',
    parts: [
      ['TU', 'ありがとう'],
      ['73', '敬意を込めて（さようなら）'],
      ['CUAGN', 'また会いましょう'],
      ['<SK>', '交信終了のプロサイン'],
    ],
  },
];

/** 相手局が返してくる典型的な反応と、その読み方・返し方。 */
export const DX_REACTIONS = {
  normal: {
    label: '通常の応答',
    meaning: '型どおりに返してきました。',
    whatToDo: 'こちらも型どおりに返します。',
  },
  qrz: {
    label: 'QRZ?（誰が呼んだ？）',
    trigger: 'QRZ?',
    meaning: 'あなたのコールサインを取れなかった、という意味です。',
    whatToDo: '自分のコールサインをもう一度、ゆっくり 2 回打ちます。',
  },
  agn: {
    label: 'AGN?（もう一度）',
    trigger: 'AGN?',
    meaning: '直前の内容が取れなかったので繰り返してほしい、という意味です。',
    whatToDo: '取れなかったであろう部分を、2 回ずつ繰り返して送り直します。',
  },
  qrs: {
    label: 'QRS PSE（もっとゆっくり）',
    trigger: 'QRS',
    meaning: '速すぎて取れない、という意味です。相手を責める意図はありません。',
    whatToDo: '速度を落として送り直します。実際の運用では相手に合わせるのが礼儀です。',
  },
  wrongCall: {
    label: 'コールサインの取り違え',
    meaning: '相手があなたのコールサインを間違えて打っています。',
    whatToDo: '自分のコールサインを繰り返して訂正します。放置すると相手のログが誤ったまま残ります。',
  },
  hurried: {
    label: '短く切り上げたい',
    trigger: 'QRU',
    meaning: 'パイルアップや時間の都合で、手短に終わらせたい様子です。',
    whatToDo: '設備の話は省いて、レポートを返してすぐ 73 に向かいます。',
  },
  nameQuery: {
    label: 'NAME AGN?（名前をもう一度）',
    trigger: 'NAME AGN?',
    meaning: '名前だけが取れなかった、という意味です。',
    whatToDo: '名前だけを 2〜3 回繰り返します。全部送り直す必要はありません。',
  },
};

/**
 * 自局の送信に対する選択肢を作る。
 * 正解の文面を意図的に崩して、初心者がやりがちな誤りを選択肢にする。
 *
 * @param {object} turn   { text, phase }
 * @param {object} script buildScript の返り値
 * @returns {Array<{ text, correct, why }>}
 */
export function makeReplyOptions(turn, script) {
  const my = script.profile.callsign;
  const dx = script.station.callsign;
  const correct = { text: turn.text, correct: true, why: '' };

  const distractors = [];

  // 1) 相手のコールサインを付けずに送ってしまう
  if (turn.text.startsWith(`${dx} DE `)) {
    distractors.push({
      text: turn.text.replace(`${dx} DE ${my}`, `DE ${my}`),
      correct: false,
      why: '相手のコールサインが抜けています。誰に向けた送信か分からないため、'
        + '混信のある状況では別の局が応答してしまいます。',
    });
  }

  // 2) DE と自分のコールサインを落とす
  if (turn.text.includes(`DE ${my}`)) {
    distractors.push({
      text: turn.text.replace(new RegExp(`\\s*DE ${escapeRe(my)}`, 'g'), ''),
      correct: false,
      why: '自分のコールサインが入っていません。誰が送信しているか分からず、'
        + '電波法上も定期的な識別が必要です。',
    });
  }

  // 3) 締めのプロサインを取り違える
  if (/\bK$/.test(turn.text)) {
    distractors.push({
      text: `${turn.text.replace(/\bK$/, '')}<SK>`,
      correct: false,
      why: '<SK> は交信終了の符号です。まだ続くところで打つと、'
        + '相手は交信が終わったと解釈します。ここは K（どうぞ）です。',
    });
  } else if (/<SK>$/.test(turn.text)) {
    distractors.push({
      text: turn.text.replace(/<SK>$/, 'K'),
      correct: false,
      why: 'K は「どうぞ」なので、相手はまだ続きがあると受け取ります。'
        + '交信を終えるときは <SK> を打ちます。',
    });
  }

  // 4) 段階を飛ばして 73 を出してしまう
  if (turn.phase === 'exchange1') {
    distractors.push({
      text: `${dx} DE ${my} TU 73 ES CUAGN <SK>`,
      correct: false,
      why: 'まだレポートも名前も交換していません。ここで 73 を打つと、'
        + '相手は何も受け取らないまま交信が終わってしまいます。',
    });
  }

  // 5) 呼び出しの段階で、いきなり交換内容を送ってしまう
  if (turn.phase === 'call') {
    distractors.push({
      text: `${dx} DE ${my} UR RST 599 599 = NAME ${script.profile.name} = QTH ${script.profile.qth} K`,
      correct: false,
      why: 'まだ相手に取ってもらえたか分かりません。呼ぶ段階では'
        + 'コールサインだけを送り、応答をもらってから中身に入ります。',
    });
  }

  // 6) CQ で自分のコールサインを 1 回しか打たない
  if (turn.phase === 'cq') {
    distractors.push({
      text: `CQ CQ CQ DE ${my} K`,
      correct: false,
      why: '間違いではありませんが、コールサインが 1 回だけだと'
        + '取り逃されやすくなります。CQ では 2〜3 回繰り返すのが通例です。',
    });
    distractors.push({
      text: `CQ CQ CQ DE ${my} ${my} ${my} PSE <SK>`,
      correct: false,
      why: '<SK> は交信終了の符号です。CQ の最後は K（どうぞ）で締めます。',
    });
  }

  // 選択肢は 3 つに絞る
  const picked = shuffle(distractors).slice(0, 2);
  return shuffle([correct, ...picked]);
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 相手の送信が何を意味し、次に何をすべきかを返す。 */
export function readDxTurn(turn) {
  const text = String(turn.text || '').toUpperCase();

  for (const [key, info] of Object.entries(DX_REACTIONS)) {
    if (info.trigger && text.includes(info.trigger)) {
      return { key, ...info };
    }
  }
  if (turn.reaction && DX_REACTIONS[turn.reaction]) {
    return { key: turn.reaction, ...DX_REACTIONS[turn.reaction] };
  }
  return { key: 'normal', ...DX_REACTIONS.normal };
}
