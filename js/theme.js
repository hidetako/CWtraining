// 画面の見た目の切り替え
//
// 見た目は <html data-theme="…"> で切り替え、色や角の丸みは CSS の
// カスタムプロパティを差し替える。標準のときは属性を付けない。
//
// 読み込み直後のちらつきを避けるため、index.html の先頭にも同じ属性を
// 付ける小さなスクリプトがある（保存した設定を直接読む）。ここは
// 設定画面での切り替えと、起動時の整合を受け持つ。

export const THEMES = {
  default: { label: '標準', color: '#050505' },
  pc88: {
    label: 'PC-88 風（8 色・ドット文字）',
    color: '#000000',
    // 日本語も出るドット文字。取れなければ等幅で代用する
    font: 'https://fonts.googleapis.com/css2?family=DotGothic16&display=swap',
  },
};

/** 見た目を切り替える。知らない名前は標準として扱う。 */
export function applyTheme(name) {
  const key = THEMES[name] ? name : 'default';
  const root = document.documentElement;
  if (key === 'default') delete root.dataset.theme;
  else root.dataset.theme = key;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEMES[key].color;

  // 使うときだけ字体を取りに行く。標準の見た目では外へ出ない
  const font = THEMES[key].font;
  if (font && !document.querySelector(`link[data-theme-font="${key}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = font;
    link.dataset.themeFont = key;
    document.head.appendChild(link);
  }
  return key;
}
