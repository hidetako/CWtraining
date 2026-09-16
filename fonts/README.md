# fonts

## pc88-zero.woff2 — PC88 Zero

PC-88 風の見た目で、ゼロ（`0`）と英字の O を見分けるための補助フォント。
中身はゼロ 1 文字だけで、CSS の `unicode-range: U+0030` でゼロにだけ当てる。

[DotGothic16](https://github.com/fontworks-fonts/DotGothic16/)
（Copyright 2020 The DotGothic16 Project Authors）のゼロの輪郭に、
同じドットの流儀で左下から右上への斜線を足したもの。DotGothic16 では
ゼロと O が輪郭までまったく同じで、CSS の `slashed-zero` も効かない。

DotGothic16 は SIL Open Font License 1.1（`OFL.txt`）。DotGothic16 は
Reserved Font Name なので、派生物の家族名は「PC88 Zero」にしてある。
この派生フォントも同じ OFL 1.1 で配る。

作り直すときは、DotGothic16 の Latin サブセット（woff2）を fontTools で
読み、`zero` の内側（x 102..400、y 107..653）に 1 ドット幅の階段を 5 段
足してから、U+0030 だけにサブセットして家族名を付け替える。
