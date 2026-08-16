// JCC・JCG・区番号のデータ。
//
// 出典: JARL「市郡区番号リスト」（www.jarl.org/Japanese/A_Shiryo/A-2_jcc-jcg/）
// 2026-08 時点の掲載内容をそのまま収録した。都道府県 47・市 890・
// 郡 586・区 207 件（消滅済みを含む。過去のログを引くのに使える）。
// 市町村合併で番号は増減するので、合わないときは JARL の最新表を見ること。
//
// 1 行 = 番号 TAB 名前 TAB ローマ字 TAB 消滅フラグ。
// 桁数が種類を表す: 2=都道府県, 4=JCC（市）, 5=JCG（郡）, 6=区。
// 生の文字列で持ち、使う側で 1 度だけ表に起こす（構築コストを開いたときに寄せない）。
export const JCC_TSV = `01	北海道		
02	青森県		
03	岩手県		
04	秋田県		
05	山形県		
06	宮城県		
07	福島県		
08	新潟県		
09	長野県		
10	東京都		
11	神奈川県		
12	千葉県		
13	埼玉県		
14	茨城県		
15	栃木県		
16	群馬県		
17	山梨県		
18	静岡県		
19	岐阜県		
20	愛知県		
21	三重県		
22	京都府		
23	滋賀県		
24	奈良県		
25	大阪府		
26	和歌山県		
27	兵庫県		
28	富山県		
29	福井県		
30	石川県		
31	岡山県		
32	島根県		
33	山口県		
34	鳥取県		
35	広島県		
36	香川県		
37	徳島県		
38	愛媛県		
39	高知県		
40	福岡県		
41	佐賀県		
42	長崎県		
43	熊本県		
44	大分県		
45	宮崎県		
46	鹿児島県		
47	沖縄県		
01001	阿寒	Akan
01002	足寄	Ashoro
01003	厚岸	Akkeshi
01004	厚田	Atsuta	1
01005	網走	Abashiri
01006	虻田(後志支庁)	Abuta(Shiribeshi)
01007	虻田(胆振支庁)	Abuta(Iburi)
01008	石狩	Ishikari
01009	磯谷	Isoya
0101	札幌	Sapporo
01010	岩内	Iwanai
010101	北海道札幌市中央区	Chuo
010102	北海道札幌市北区	Kita
010103	北海道札幌市東区	Higashi
010104	北海道札幌市白石区	Shiroishi
010105	北海道札幌市豊平区	Toyohira
010106	北海道札幌市南区	Minami
010107	北海道札幌市西区	Nishi
010108	北海道札幌市厚別区	Atsubetsu
010109	北海道札幌市手稲区	Teine
01011	有珠	Usu
010110	北海道札幌市清田区	Kiyota
01012	歌棄	Utasutsu	1
01013	浦河	Urakawa
01014	雨竜（空知支庁）	Uryu(Sorachi)
01015	枝幸	Esashi
01016	奥尻	Okushiri
01017	忍路	Oshoro	1
01018	河西	Kasai
01019	河東	Kato
0102	旭川	Asahikawa
01020	樺戸	Kabato
01021	上磯	Kamiiso
01022	上川(十勝支庁)	Kamikawa(Tokachi)	1
0103	小樽	Otaru
0104	函館	Hakodate
0105	室蘭	Muroran
01051	中川(十勝支庁)	Nakagawa(Tokachi)
01052	新冠	Niikappu
01053	爾志	Nishi
01054	根室	Nemuro	1
01055	野付	Notsuke
01056	花咲	Hanasaki	1
01057	浜益	Hamamasu	1
01058	美国	Bikuni	1
01059	檜山	Hiyama
0106	釧路	Kushiro
01060	広尾	Hiroo
01061	太櫓	Futoro	1
01062	古宇	Furuu
01063	古平	Furubira
01064	幌泉	Horoizumi
01065	幌別	Horobetsu	1
01066	増毛	Mashike
01067	松前	Matsumae
01068	三石	Mitsuishi	1
01069	目梨	Menashi
0107	帯広	Obihiro
01070	紋別	Monbetsu
01071	山越	Yamakoshi
01072	夕張	Yubari
01073	勇払(胆振支庁)	Yufutsu(Iburi)
0108	北見	Kitami
0109	夕張	Yubari
0110	岩見沢	Iwamizawa
0111	網走	Abashiri
0112	留萌	Rumoi
0113	苫小牧	Tomakomai
0114	稚内	Wakkanai
0115	美唄	Bibai
0116	芦別	Ashibetsu
0117	江別	Ebetsu
0118	赤平	Akabira
0119	紋別	Mombetsu
0120	士別	Shibetsu
0121	名寄	Nayoro
0122	三笠	Mikasa
0123	根室	Nemuro
0124	千歳	Chitose
0125	滝川	Takikawa
0126	砂川	Sunagawa
0127	歌志内	Utashinai
0128	深川	Fukagawa
0129	富良野	Furano
0130	登別	Noboribetsu
0131	恵庭	Eniwa
0132	亀田	Kameda	1
0133	伊達	Date
0134	北広島	Kitahiroshima
0135	石狩	Ishikari
0136	北斗	Hokuto
02001	上北	Kamikita
02002	北津軽	Kitatsugaru
02003	三戸	Sannohe
02004	下北	Shimokita
02005	中津軽	Nakatsugaru
02006	西津軽	Nishitsugaru
02007	東津軽	Higashitsugaru
02008	南津軽	Minamitsugaru
0201	青森	Aomori
0202	弘前	Hirosaki
0203	八戸	Hachinohe
0204	黒石	Kuroishi
0205	五所川原	Goshogawara
0206	十和田	Towada
0207	三沢	Misawa
0208	むつ	Mutsu
0209	つがる	Tsugaru
0210	平川	Hirakawa
03001	胆沢	Isawa
03002	岩手	Iwate
03003	江刺	Esashi	1
03004	上閉伊	Kamihei
03005	九戸	Kunohe
03006	気仙	Kesen
03007	下閉伊	Shimohei
03008	紫波	Shiwa
03009	西磐井	Nishiiwai
0301	盛岡	Morioka
03010	二戸	Ninohe
03011	稗貫	Hienuki	1
03012	東磐井	Higashiiwai	1
03013	和賀	Waga
0302	釜石	Kamaishi
0303	宮古	Miyako
0304	一関	Ichinoseki
0305	大船渡	Ofunato
0306	水沢	Mizusawa	1
0307	花巻	Hanamaki
0308	北上	Kitakami
0309	久慈	Kuji
0310	遠野	Tono
0311	陸前高田	Rikuzentakata
0312	江刺	Esashi	1
0313	二戸	Ninohe
0314	八幡平	Hachimantai
0315	奥州	Oshu
0316	滝沢	Takizawa
04001	雄勝	Ogachi
04002	鹿角	Kazuno
04003	河辺	Kawabe	1
04004	北秋田	Kitaakita
04005	仙北	Senboku
04006	平鹿	Hiraka	1
04007	南秋田	Minamiakita
04008	山本	Yamamoto
04009	由利	Yuri	1
0401	秋田	Akita
0402	能代	Noshiro
0403	大館	Odate
0404	横手	Yokote
0405	本荘	Honjo	1
0406	男鹿	Oga
0407	湯沢	Yuzawa
0408	大曲	Omagari	1
0409	鹿角	Kazuno
0410	由利本荘	Yurihonjo
0411	潟上	Katagami
0412	大仙	Daisen
0413	北秋田	Kitaakita
0414	にかほ	Nikaho
0415	仙北	Senboku
05001	飽海	Akumi
05002	北村山	Kitamurayama
05003	西置賜	Nishiokitama
05004	西田川	Nishitagawa	1
05005	西村山	Nishimurayama
05006	東置賜	Higashiokitama
05007	東田川	Higashitagawa
05008	東村山	Higashimurayama
05009	南置賜	Minamiokitama	1
0501	山形	Yamagata
05010	南村山	Minamimurayama	1
05011	最上	Mogami
0502	米沢	Yonezawa
0503	鶴岡	Tsuruoka
0504	酒田	Sakata
0505	新庄	Shinjo
0506	寒河江	Sagae
0507	上山	Kaminoyama
0508	村山	Murayama
0509	長井	Nagai
0510	天童	Tendo
0511	東根	Higashine
0512	尾花沢	Obanazawa
0513	南陽	Nan'yo
06001	伊具	Igu
06002	牡鹿	Oshika
06003	刈田	Katta
06004	加美	Kami
06005	栗原	Kurihara	1
06006	黒川	Kurokawa
06007	志田	Shida	1
06008	柴田	Shibata
06009	玉造	Tamatsukuri	1
0601	仙台	Sendai
06010	遠田	Toda
060101	宮城県仙台市青葉区	Aoba
060102	宮城県仙台市宮城野区	Miyagino
060103	宮城県仙台市若林区	Wakabayashi
060104	宮城県仙台市太白区	Taihaku
060105	宮城県仙台市泉区	Izumi
06011	登米	Tome	1
06012	名取	Natori	1
06013	宮城	Miyagi
06014	本吉	Motoyoshi
06015	桃生	Monou	1
06016	亘理	Watari
0602	石巻	Ishinomaki
0603	塩竈	Shiogama
0604	古川	Furukawa	1
0605	気仙沼	Kesennuma
0606	白石	Shiroishi
0607	名取	Natori
0608	角田	Kakuda
0609	多賀城	Tagajo
0610	泉	Izumi	1
0611	岩沼	Iwanuma
0612	登米	Tome
0613	栗原	Kurihara
0614	東松島	Higashimatsushima
0615	大崎	Osaki
0616	富谷	Tomiya
07001	安積	Asaka	1
07002	安達	Adachi
07003	石川	Ishikawa
07004	石城	Iwaki	1
07005	岩瀬	Iwase
07006	大沼	Onuma
07007	河沼	Kawanuma
07008	北会津	Kitaaizu	1
07009	信夫	Shinobu	1
0701	福島	Fukushima
07010	相馬	Soma
07011	伊達	Date
07012	田村	Tamura
07013	西白河	Nishishirakawa
07014	東白川	Higashishirakawa
07015	双葉	Futaba
07016	南会津	Minamiaizu
07017	耶麻	Yama
0702	会津若松	Aizuwakamatsu
0703	郡山	Koriyama
0704	平	Taira	1
0705	白河	Shirakawa
0706	原町	Haramachi	1
0707	須賀川	Sukagawa
0708	喜多方	Kitakata
0709	常磐	Joban	1
0710	磐城	Iwaki	1
0711	相馬	Soma
0712	内郷	Uchigo	1
0713	勿来	Nakoso	1
0714	二本松	Nihonmatsu
0715	いわき	Iwaki
0716	若松	Wakamatsu	1
0717	田村	Tamura
0718	南相馬	Minamisoma
0719	伊達	Date
0720	本宮	Motomiya
08001	岩船	Iwafune
08002	刈羽	Kariwa
08003	北魚沼	Kitauonuma	1
08004	北蒲原	Kitakanbara
08005	古志	Koshi	1
08006	佐渡	Sado	1
08007	三島	Santo
08008	中魚沼	Nakauonuma
08009	中蒲原	Nakakanbara	1
0801	新潟	Niigata
08010	中頸城	Nakakubiki	1
080101	北	Kita
080102	東	Higashi
080103	中央	Chuo
080104	江南	Konan
080105	秋葉	Akiha
080106	南	Minami
080107	西	Nishi
080108	西蒲	Nishikan
08011	西蒲原	Nishikanbara
08012	西頸城	Nishikubiki	1
08013	東蒲原	Higashikanbara
08014	東頸城	Higashikubiki	1
08015	南魚沼	Minamiuonuma
08016	南蒲原	Minamikanbara
0802	長岡	Nagaoka
0803	高田	Takada	1
0804	三条	Sanjo
0805	柏崎	Kashiwazaki
0806	新発田	Shibata
0807	新津	Niitsu	1
0808	小千谷	Ojiya
0809	加茂	Kamo
0810	十日町	Tokamachi
0811	見附	Mitsuke
0812	村上	Murakami
0813	燕	Tsubame
0814	直江津	Naoetsu	1
0815	栃尾	Tochio	1
0816	糸魚川	Itoigawa
0817	新井	Arai	1
0818	五泉	Gosen
0819	両津	Ryotsu	1
0820	白根	Shirone	1
0821	豊栄	Toyosaka	1
0822	上越	Joetsu
0823	阿賀野	Agano
0824	佐渡	Sado
0825	魚沼	Uonuma
0826	南魚沼	Minamiuonuma
0827	妙高	Myoko
0828	胎内	Tainai
09001	上伊那	Kamiina
09002	上高井	Kamitakai
09003	上水内	Kamiminochi
09004	木曽	Kiso
09005	北安曇	Kitaazumi
09006	北佐久	Kitasaku
09007	更級	Sarashina	1
09008	下伊那	Shimoina
09009	下高井	Shimotakai
0901	長野	Nagano
09010	下水内	Shimominochi
09011	諏訪	Suwa
09012	小県	Chiisagata
09013	(欠番）	(Reserved)
09014	埴科	Hanishina
09015	東筑摩	Higashichikuma
09016	南安曇	Minamiazumi	1
09017	南佐久	Minamisaku
0902	松本	Matsumoto
0903	上田	Ueda
0904	岡谷	Okaya
0905	飯田	Iida
0906	諏訪	Suwa
0907	須坂	Suzaka
0908	小諸	Komoro
0909	伊那	Ina
0910	駒ヶ根	Komagane
0911	中野	Nakano
0912	大町	Omachi
0913	飯山	Iiyama
0914	茅野	Chino
0915	塩尻	Shiojiri
0916	篠ノ井	Shinonoi	1
0917	更埴	Koshoku	1
0918	佐久	Saku
0919	千曲	Chikuma
0920	東御	Toumi
0921	安曇野	Azumino
10001	北多摩	Kitatama	1
10002	西多摩	Nishitama
10003	南多摩	Minamitama	1
10004	大島支庁	Oshima
10005	三宅支庁	Miyake
10006	八丈支庁	Hachijo
1001	東京23区	Tokyo 23-ku	1
100101	東京都千代田区	Chiyoda
100102	東京都中央区	Chuo
100103	東京都港区	Minato
100104	東京都新宿区	Shinjuku
100105	東京都文京区	Bunkyo
100106	東京都台東区	Taito
100107	東京都墨田区	Sumida
100108	東京都江東区	Koto
100109	東京都品川区	Shinagawa
100110	東京都目黒区	Meguro
100111	東京都大田区	Ota
100112	東京都世田谷区	Setagaya
100113	東京都渋谷区	Shibuya
100114	東京都中野区	Nakano
100115	東京都杉並区	Suginami
100116	東京都豊島区	Toshima
100117	東京都北区	Kita
100118	東京都荒川区	Arakawa
100119	東京都板橋区	Itabashi
100120	東京都練馬区	Nerima
100121	東京都足立区	Adachi
100122	東京都葛飾区	Katsushika
100123	東京都江戸川区	Edogawa
1002	八王子	Hachioji
1003	立川	Tachikawa
1004	武蔵野	Musashino
1005	三鷹	Mitaka
1006	青梅	Ome
1007	府中	Fuchu
1008	昭島	Akishima
1009	調布	Chofu
1010	町田	Machida
1011	小金井	Koganei
1012	小平	Kodaira
1013	日野	Hino
1014	東村山	Higashimurayama
1015	国分寺	Kokubunji
1016	国立	Kunitachi
1017	保谷	Hoya	1
1018	田無	Tanashi	1
1019	福生	Fussa
1020	狛江	Komae
1021	東大和	Higashiyamato
1022	清瀬	Kiyose
1023	東久留米	Higashikurume
1024	武蔵村山	Musashimurayama
1025	多摩	Tama
1026	稲城	Inagi
1027	秋川	Akigawa	1
1028	羽村	Hamura
1029	あきる野	Akiruno
1030	西東京	Nishitokyo
11001	愛甲	Aiko
11002	足柄上	Ashigarakami
11003	足柄下	Ashigarashimo
11004	高座	Koza
11005	津久井	Tsukui	1
11006	中	Naka
11007	三浦	Miura
1101	横浜	Yokohama
110101	神奈川県横浜市鶴見区	Tsurumi
110102	神奈川県横浜市神奈川区	Kanagawa
110103	神奈川県横浜市西区	Nishi
110104	神奈川県横浜市中区	Naka
110105	神奈川県横浜市南区	Minami
110106	神奈川県横浜市保土ケ谷区	Hodogaya
110107	神奈川県横浜市磯子区	Isogo
110108	神奈川県横浜市金沢区	Kanazawa
110109	神奈川県横浜市港北区	Kohoku
110110	神奈川県横浜市戸塚区	Totsuka
110111	神奈川県横浜市港南区	Konan
110112	神奈川県横浜市旭区	Asahi
110113	神奈川県横浜市緑区	Midori
110114	神奈川県横浜市瀬谷区	Seya
110115	神奈川県横浜市栄区	Sakae
110116	神奈川県横浜市泉区	Izumi
110117	神奈川県横浜市青葉区	Aoba
110118	神奈川県横浜市都筑区	Tsuzuki
1102	横須賀	Yokosuka
1103	川崎	Kawasaki
110301	神奈川県川崎市川崎区	Kawasaki
110302	神奈川県川崎市幸区	Saiwai
110303	神奈川県川崎市中原区	Nakahara
110304	神奈川県川崎市高津区	Takatsu
110305	神奈川県川崎市多摩区	Tama
110306	神奈川県川崎市宮前区	Miyamae
110307	神奈川県川崎市麻生区	Asao
1104	平塚	Hiratsuka
1105	鎌倉	Kamakura
1106	藤沢	Fujisawa
1107	小田原	Odawara
1108	茅ヶ崎	Chigasaki
1109	逗子	Zushi
1110	相模原	Sagamihara
111001	神奈川県相模原市緑区	Midori
111002	神奈川県相模原市中央区	Chuo
111003	神奈川県相模原市南区	Minami
1111	三浦	Miura
1112	秦野	Hadano
1113	厚木	Atsugi
1114	大和	Yamato
1115	伊勢原	Isehara
1116	海老名	Ebina
1117	座間	Zama
1118	南足柄	Minamiashigara
1119	綾瀬	Ayase
12001	安房	Awa
12002	夷隅	Isumi
12003	市原	Ichihara	1
12004	印旛	Inba
12005	海上	Kaijo	1
12006	香取	Katori
12007	君津	Kimitsu	1
12008	山武	Sanbu
12009	匝瑳	Sosa	1
1201	千葉	Chiba
12010	千葉	Chiba	1
120101	千葉県千葉市中央区	Chuo
120102	千葉県千葉市花見川区	Hanamigawa
120103	千葉県千葉市稲毛区	Inage
120104	千葉県千葉市若葉区	Wakaba
120105	千葉県千葉市緑区	Midori
120106	千葉県千葉市美浜区	Mihama
12011	長生	Chosei
12012	東葛飾	Higashikatsushika	1
1202	銚子	Choshi
1203	市川	Ichikawa
1204	船橋	Funabashi
1205	館山	Tateyama
1206	木更津	Kisarazu
1207	松戸	Matsudo
1208	野田	Noda
1209	佐原	Sawara	1
1210	茂原	Mobara
1211	成田	Narita
1212	佐倉	Sakura
1213	東金	Togane
1214	八日市場	Yokaichiba	1
1215	旭	Asahi
1216	習志野	Narashino
1217	柏	Kashiwa
1218	勝浦	Katsuura
1219	市原	Ichihara
1220	流山	Nagareyama
1221	八千代	Yachiyo
1222	我孫子	Abiko
1223	鴨川	Kamogawa
1224	君津	Kimitsu
1225	鎌ケ谷	Kamagaya
1226	富津	Futtu
1227	浦安	Urayasu
1228	四街道	Yotsukaido
1229	袖ケ浦	Sodegaura
1230	八街	Yachimata
1231	印西	Inzai
1232	白井	Shiroi
1233	富里	Tomisato
1234	南房総	Minamiboso
1235	匝瑳	Sosa
1236	香取	Katori
1237	山武	Sanmu
1238	いすみ	Isumi
1239	大網白里	Oamishirasato
13001	入間	Iruma
13002	大里	Osato
13003	北足立	Kitaadachi
13004	北葛飾	Kitakatsushika
13005	北埼玉	Kitasaitama	1
13006	児玉	Kodama
13007	秩父	Chichibu
13008	比企	Hiki
13009	南埼玉	Minamisaitama
1301	浦和	Urawa	1
1302	川越	Kawagoe
1303	熊谷	Kumagaya
1304	川口	Kawaguchi
1305	大宮	Omiya	1
1306	行田	Gyoda
1307	秩父	Chichibu
1308	所沢	Tokorozawa
1309	飯能	Hanno
1310	加須	Kazo
1311	本庄	Honjo
1312	東松山	Higashimatsuyama
1313	岩槻	Iwatsuki	1
1314	春日部	Kasukabe
1315	狭山	Sayama
1316	羽生	Hanyu
1317	鴻巣	Konosu
1318	深谷	Fukaya
1319	上尾	Ageo
1320	与野	Yono	1
1321	草加	Soka
1322	越谷	Koshigaya
1323	蕨	Warabi
1324	戸田	Toda
1325	入間	Iruma
1326	鳩ヶ谷	Hatogaya	1
1327	朝霞	Asaka
1328	志木	Shiki
1329	和光	Wako
1330	新座	Niiza
1331	桶川	Okegawa
1332	久喜	Kuki
1333	北本	Kitamoto
1334	八潮	Yashio
1335	上福岡	Kamifukuoka	1
1336	富士見	Fujimi
1337	三郷	Misato
1338	蓮田	Hasuda
1339	坂戸	Sakado
1340	幸手	Satte
1341	鶴ヶ島	Tsurugashima
1342	日高	Hidaka
1343	吉川	Yoshikawa
1344	さいたま	Saitama
134401	西	Nishi
134402	北	Kita
134403	大宮	Omiya
134404	見沼	Minuma
134405	中央	Chuo
134406	桜	Sakura
134407	浦和	Urawa
134408	南	Minami
134409	緑	Midori
134410	岩槻	Iwatsuki
1345	ふじみ野	Fujimino
1346	白岡	Shiraoka
14001	稲敷	Inashiki
14002	鹿島	Kashima	1
14003	北相馬	Kitasoma
14004	久慈	Kuji
14005	猿島	Sashima
14006	多賀	Taga	1
14007	筑波	Tsukuba	1
14008	那珂	Naka
14009	行方	Namegata	1
1401	水戸	Mito
14010	新治	Niihari	1
14011	西茨城	Nishiibaraki	1
14012	東茨城	Higashiibaraki
14013	真壁	Makabe	1
14014	結城	Yuki
1402	日立	Hitachi
1403	土浦	Tsuchiura
1404	古河	Koga
1405	石岡	Ishioka
1406	下館	Shimodate	1
1407	結城	Yuki
1408	龍ケ崎	Ryugasaki
1409	那珂湊	Nakaminato	1
1410	下妻	Shimotsuma
1411	水海道	Mitsukaido	1
1412	常陸太田	Hitachiota
1413	勝田	Katsuta	1
1414	高萩	Takahagi
1415	北茨城	Kitaibaraki
1416	笠間	Kasama
1417	取手	Toride
1418	岩井	Iwai	1
1419	牛久	Ushiku
1420	つくば	Tsukuba
1421	ひたちなか	Hitachinaka
1422	鹿嶋	Kashima
1423	潮来	Itako
1424	守谷	Moriya
1425	常陸大宮	Hitachiomiya
1426	那珂	Naka
1427	筑西	Chikusei
1428	坂東	Bandou
1429	稲敷	Inashiki
1430	かすみがうら	Kasumigaura
1431	桜川	Sakuragwa
1432	神栖	Kamisu
1433	行方	Namegata
1434	鉾田	Hokota
1435	常総	Joso
1436	つくばみらい	Tsukubamirai
1437	小美玉	Omitama
15001	足利	Ashikaga	1
15002	安蘇	Aso	1
15003	上都賀	Kamitsuga	1
15004	河内	Kawachi
15005	塩谷	Shioya
15006	下都賀	Shimotsuga
15007	那須	Nasu
15008	芳賀	Haga
1501	宇都宮	Utsunomiya
1502	足利	Ashikaga
1503	栃木	Tochigi
1504	佐野	Sano
1505	鹿沼	Kanuma
1506	日光	Nikko
1507	今市	Imaichi	1
1508	小山	Oyama
1509	真岡	Mooka
1510	大田原	Otawara
1511	矢板	Yaita
1512	黒磯	Kuroiso	1
1513	那須塩原	Nasushiobara
1514	さくら	Sakura
1515	那須烏山	Nasukarasuyama
1516	下野	Shimotsuke
16001	吾妻	Agatsuma
16002	碓氷	Usui	1
16003	邑楽	Ora
16004	甘楽	Kanra
16005	北群馬	Kitagunma
16006	群馬	Gunma	1
16007	佐波	Sawa
16008	勢多	Seta	1
16009	多野	Tano
1601	前橋	Maebashi
16010	利根	Tone
16011	新田	Nitta	1
16012	山田	Yamada	1
1602	高崎	Takasaki
1603	桐生	Kiryu
1604	伊勢崎	Isesaki
1605	太田	Ota
1606	沼田	Numata
1607	館林	Tatebayashi
1608	渋川	Shibukawa
1609	藤岡	Fujioka
1610	富岡	Tomioka
1611	安中	Annaka
1612	みどり	Midori
17001	北巨摩	Kitakoma	1
17002	北都留	Kitatsuru
17003	中巨摩	Nakakoma
17004	西八代	Nishiyatsushiro
17005	東八代	Higashiyatsushiro	1
17006	東山梨	Higashiyamanashi	1
17007	南巨摩	Minamikoma
17008	南都留	Minamitsuru
1701	甲府	Kofu
1702	富士吉田	Fujiyoshida
1703	塩山	Enzan	1
1704	都留	Tsuru
1705	山梨	Yamanashi
1706	大月	Otsuki
1707	韮崎	Nirasaki
1708	南アルプス	Minami-Alps
1709	北杜	Hokuto
1710	甲斐	Kai
1711	笛吹	Fuefuki
1712	上野原	Uenohara
1713	甲州	Koshu
1714	中央	Chuo
18001	安倍	Abe	1
18002	引佐	Inasa	1
18003	庵原	Ihara	1
18004	磐田	Iwata	1
18005	小笠	Ogasa	1
18006	賀茂	Kamo
18007	志太	Shida	1
18008	周智	Shuchi
18009	駿東	Sunto
1801	静岡	Shizuoka
18010	田方	Tagata
180101	葵	Aoi
180102	駿河	Suruga
180103	清水	Shimizu
18011	榛原	Haibara
18012	浜名	Hamana	1
18013	富士	Fuji	1
1802	浜松	Hamamatsu
180201	中	Naka	1
180202	東	Higashi	1
180203	西	Nishi	1
180204	南	Minami	1
180205	北	Kita	1
180206	浜北	Hamakita	1
180207	天竜	Tenryu
180208	中央	Chuo
180209	浜名	Hamana
1803	沼津	Numazu
1804	清水	Shimizu	1
1805	熱海	Atami
1806	三島	Mishima
1807	富士宮	Fujinomiya
1808	伊東	Ito
1809	島田	Shimada
1810	吉原	Yoshiwara	1
1811	磐田	Iwata
1812	焼津	Yaizu
1813	富士	Fuji
1814	掛川	Kakegawa
1815	藤枝	Fujieda
1816	御殿場	Gotemba
1817	袋井	Fukuroi
1818	天竜	Tenryu	1
1819	浜北	Hamakita	1
1820	下田	Shimoda
1821	裾野	Susono
1822	湖西	Kosai
1823	伊豆	Izu
1824	御前崎	Omaezaki
1825	菊川	Kikugawa
1826	伊豆の国	Izunokuni
1827	牧之原	Makinohara
19001	安八	Anpachi
19002	稲葉	Inaba	1
19003	揖斐	Ibi
19004	恵那	Ena	1
19005	大野	Ono
19006	海津	Kaizu	1
19007	可児	Kani
19008	加茂	Kamo
19009	郡上	Gujo	1
1901	岐阜	Gifu
19010	土岐	Toki	1
19011	羽島	Hashima
19012	不破	Fuwa
19013	益田	Mashita	1
19014	武儀	Mugi	1
19015	本巣	Motosu
19016	山県	Yamagata	1
19017	養老	Yoro
19018	吉城	Yoshiki	1
1902	大垣	Ogaki
1903	高山	Takayama
1904	多治見	Tajimi
1905	関	Seki
1906	中津川	Nakatsugawa
1907	美濃	Mino
1908	瑞浪	Mizunami
1909	羽島	Hashima
1910	恵那	Ena
1911	美濃加茂	Minokamo
1912	土岐	Toki
1913	各務原	Kakamigahara
1914	可児	Kani
1915	山県	Yamagata
1916	瑞穂	Mizuho
1917	飛騨	Hida
1918	本巣	Motosu
1919	郡上	Gujo
1920	下呂	Gero
1921	海津	Kaizu
20001	愛知	Aichi
20002	渥美	Atsumi	1
20003	海部	Ama
20004	北設楽	Kitashitara
20005	知多	Chita
20006	中島	Nakashima	1
20007	西春日井	Nishikasugai
20008	西加茂	Nishikamo	1
20009	丹羽	Niwa
2001	名古屋	Nagoya
20010	額田	Nukata
200101	愛知県名古屋市千種区	Chikusa
200102	愛知県名古屋市東区	Higashi
200103	愛知県名古屋市北区	Kita
200104	愛知県名古屋市西区	Nishi
200105	愛知県名古屋市中村区	Nakamura
200106	愛知県名古屋市中区	Naka
200107	愛知県名古屋市昭和区	Showa
200108	愛知県名古屋市瑞穂区	Mizuho
200109	愛知県名古屋市熱田区	Atsuta
20011	葉栗	Haguri	1
200110	愛知県名古屋市中川区	Nakagawa
200111	愛知県名古屋市港区	Minato
200112	愛知県名古屋市南区	Minami
200113	愛知県名古屋市守山区	Moriyama
200114	愛知県名古屋市緑区	Midori
200115	愛知県名古屋市名東区	Meito
200116	愛知県名古屋市天白区	Tenpaku
20012	幡豆	Hazu	1
20013	東春日井	Higashikasugai	1
20014	東加茂	Higashikamo	1
20015	碧海	Hekikai	1
20016	宝飯	Hoi	1
20017	南設楽	Minamishitara	1
20018	八名	Yana	1
2002	豊橋	Toyohashi
2003	岡崎	Okazaki
2004	一宮	Ichinomiya
2005	瀬戸	Seto
2006	半田	Handa
2007	春日井	Kasugai
2008	豊川	Toyokawa
2009	津島	Tsushima
2010	碧南	Hekinan
2011	刈谷	Kariya
2012	豊田	Toyota
2013	安城	Anjo
2014	西尾	Nishio
2015	蒲郡	Gamagori
2016	犬山	Inuyama
2017	常滑	Tokoname
2018	守山	Moriyama	1
2019	江南	Konan
2020	尾西	Bisai	1
2021	小牧	Komaki
2022	稲沢	Inazawa
2023	新城	Shinshiro
2024	東海	Tokai
2025	大府	Obu
2026	知多	Chita
2027	高浜	Takahama
2028	知立	Chiryu
2029	尾張旭	Owariasahi
2030	岩倉	Iwakura
2031	豊明	Toyoake
2032	日進	Nissin
2033	田原	Tahara
2034	愛西	Aisai
2035	清須	Kiyosu
2036	北名古屋	Kitanagoya
2037	弥富	Yatomi
2038	みよし	Miyoshi
2039	あま	Ama
2040	長久手	Nagakute
21001	安芸	Age	1
21002	安濃	Ano	1
21003	阿山	Ayama	1
21004	飯南	Iinan	1
21005	一志	Ichishi	1
21006	員弁	Inabe
21007	河芸	Kawage	1
21008	北牟婁	Kitamuro
21009	桑名	Kuwana
2101	津	Tsu
21010	志摩	Shima	1
21011	鈴鹿	Suzuka	1
21012	多気	Taki
21013	名賀	Naga	1
21014	三重	Mie
21015	南牟婁	Minamimuro
21016	度会	Watarai
2102	四日市	Yokkaichi
2103	伊勢	Ise
2104	松阪	Matsusaka
2105	桑名	Kuwana
2106	上野	Ueno	1
2107	鈴鹿	Suzuka
2108	名張	Nabari
2109	尾鷲	Owase
2110	亀山	Kameyama
2111	鳥羽	Toba
2112	熊野	Kumano
2113	久居	Hisai	1
2114	宇治山田	Ujiyamada	1
2115	いなべ	Inabe
2116	志摩	Shima
2117	伊賀	Iga
22001	天田	Amata	1
22002	何鹿	Ikaruga	1
22003	乙訓	Otokuni
22004	加佐	Kasa	1
22005	北桑田	Kitakuwada	1
22006	久世	Kuse
22007	熊野	Kumano	1
22008	相楽	Soraku
22009	竹野	Takeno	1
2201	京都	Kyoto
22010	綴喜	Tsuzuki
220101	京都府京都市北区	Kita
220102	京都府京都市上京区	Kamigyo
220103	京都府京都市左京区	Sakyo
220104	京都府京都市中京区	Nakagyo
220105	京都府京都市東山区	Higashiyama
220106	京都府京都市下京区	Shimogyo
220107	京都府京都市南区	Minami
220108	京都府京都市右京区	Ukyo
220109	京都府京都市伏見区	Fushimi
22011	中	Naka	1
220110	京都府京都市山科区	Yamashina
220111	京都府京都市西京区	Nishikyo
22012	船井	Funai
22013	南桑田	Minamikuwada	1
22014	与謝	Yosa
2202	福知山	Fukuchiyama
2203	舞鶴	Maizuru
2204	綾部	Ayabe
2205	宇治	Uji
2206	宮津	Miyazu
2207	亀岡	Kameoka
2208	城陽	Joyo
2209	長岡京	Nagaokakyo
2210	向日	Muko
2211	八幡	Yawata
2212	京田辺	Kyotanabe
2213	京丹後	Kyotango
2214	南丹	Nantan
2215	木津川	Kizugawa
23001	伊香	Ika	1
23002	犬上	Inukami
23003	愛知	Echi
23004	蒲生	Gamo
23005	神崎	Kanzaki	1
23006	栗太	Kurita	1
23007	甲賀	Koka	1
23008	坂田	Sakata	1
23009	滋賀	Shiga	1
2301	大津	Otsu
23010	高島	Takashima	1
23011	東浅井	Higashiazai	1
23012	野洲	Yasu	1
2302	彦根	Hikone
2303	長浜	Nagahama
2304	近江八幡	Omihachiman
2305	八日市	Yokaichi	1
2306	草津	Kusatsu
2307	守山	Moriyama
2308	栗東	Ritto
2309	甲賀	Koka
2310	野洲	Yasu
2311	湖南	Konan
2312	高島	Takashima
2313	東近江	Higashioumi
2314	米原	Maibara
24001	生駒	Ikoma
24002	宇陀	Uda
24003	宇智	Uchi	1
24004	北葛城	Kitakatsuragi
24005	磯城	Shiki
24006	添上	Soekami	1
24007	高市	Takaichi
24008	南葛城	Minamikatsuragi	1
24009	山辺	Yamabe
2401	奈良	Nara
24010	吉野	Yoshino
2402	大和高田	Yamatotakada
2403	大和郡山	Yamatokoriyama
2404	天理	Tenri
2405	橿原	Kashihara
2406	桜井	Sakurai
2407	五條	Gojo
2408	御所	Gose
2409	生駒	Ikoma
2410	香芝	Kashiba
2411	葛城	Katsuragi
2412	宇陀	Uda
25001	北河内	Kitakawachi	1
25002	泉南	Sennan
25003	泉北	Senboku
25004	豊能	Toyono
25005	中河内	Nakakawachi	1
25006	三島	Mishima
25007	南河内	Minamikawachi
2501	大阪	Osaka
250101	大阪府大阪市北区	Kita
250102	大阪府大阪市都島区	Miyakojima
250103	大阪府大阪市福島区	Fukushima
250104	大阪府大阪市此花区	Konohana
250105	大阪府大阪市東区	Higashi	1
250106	大阪府大阪市西区	Nishi
250107	大阪府大阪市港区	Minato
250108	大阪府大阪市大正区	Taisho
250109	大阪府大阪市天王寺区	Tennoji
250110	大阪府大阪市南区	Minami	1
250111	大阪府大阪市浪速区	Naniwa
250112	大阪府大阪市大淀区	Oyodo	1
250113	大阪府大阪市西淀川区	Nishiyodogawa
250114	大阪府大阪市東淀川区	Higashiyodogawa
250115	大阪府大阪市東成区	Higashinari
250116	大阪府大阪市生野区	Ikuno
250117	大阪府大阪市旭区	Asahi
250118	大阪府大阪市城東区	Joto
250119	大阪府大阪市阿倍野区	Abeno
250120	大阪府大阪市住吉区	Sumiyoshi
250121	大阪府大阪市東住吉区	Higashisumiyoshi
250122	大阪府大阪市西成区	Nishinari
250123	大阪府大阪市淀川区	Yodogawa
250124	大阪府大阪市鶴見区	Tsurumi
250125	大阪府大阪市住之江区	Suminoe
250126	大阪府大阪市平野区	Hirano
250127	大阪府大阪市中央区	Chuo
2502	堺	Sakai
250201	大阪府堺市堺区	Sakai
250202	大阪府堺市中区	Naka
250203	大阪府堺市東区	Higashi
250204	大阪府堺市西区	Nishi
250205	大阪府堺市南区	Minami
250206	大阪府堺市北区	Kita
250207	大阪府堺市美原区	Mihara
2503	岸和田	Kishiwada
2504	豊中	Toyonaka
2505	布施	Fuse	1
2506	池田	Ikeda
2507	吹田	Suita
2508	泉大津	Izumiotsu
2509	高槻	Takatsuki
2510	貝塚	Kaizuka
2511	守口	Moriguchi
2512	枚方	Hirakata
2513	茨木	Ibaraki
2514	八尾	Yao
2515	泉佐野	Izumisano
2516	富田林	Tondabayashi
2517	寝屋川	Neyagawa
2518	河内長野	Kawachinagano
2519	枚岡	Hiraoka	1
2520	河内	Kawachi	1
2521	松原	Matsubara
2522	大東	Daito
2523	和泉	Izumi
2524	箕面	Mino
2525	柏原	Kashiwara
2526	羽曳野	Habikino
2527	門真	Kadoma
2528	摂津	Settsu
2529	藤井寺	Fujiidera
2530	高石	Takaishi
2531	東大阪	Higashiosaka
2532	泉南	Sennan
2533	四條畷	Shijonawate
2534	交野	Katano
2535	大阪狭山	Osakasayama
2536	阪南	Hannan
26001	有田	Arida
26002	伊都	Ito
26003	海草	Kaiso
26004	那賀	Naga	1
26005	西牟婁	Nishimuro
26006	東牟婁	Higashimuro
26007	日高	Hidaka
2601	和歌山	Wakayama
2602	新宮	Shingu
2603	海南	Kainan
2604	田辺	Tanabe
2605	御坊	Gobo
2606	橋本	Hashimoto
2607	有田	Arida
2608	紀の川	Kinokawa
2609	岩出	Iwade
27001	赤穂	Ako
27002	朝来	Asago	1
27003	有馬	Arima	1
27004	出石	Izushi	1
27005	揖保	Ibo
27006	印南	Innami	1
27007	加古	Kako
27008	加西	Kasai	1
27009	加東	Kato	1
2701	神戸	Kobe
27010	川辺	Kawabe
270101	兵庫県神戸市東灘区	Higashinada
270102	兵庫県神戸市灘区	Nada
270103	兵庫県神戸市兵庫区	Hyogo
270104	兵庫県神戸市長田区	Nagata
270105	兵庫県神戸市須磨区	Suma
270106	兵庫県神戸市垂水区	Tarumi
270107	兵庫県神戸市北区	Kita
270108	兵庫県神戸市中央区	Chuo
270109	兵庫県神戸市西区	Nishi
27011	神崎	Kanzaki
270110	兵庫県神戸市葺合区	Fukiai	1
270111	兵庫県神戸市生田区	Ikuta	1
27012	城崎	Kinosaki	1
27013	佐用	Sayo
27014	飾磨	Shikama	1
27015	宍粟	Shiso	1
27016	多可	Taka
27017	多紀	Taki	1
27018	津名	Tsuna	1
27019	氷上	Hikami	1
2702	姫路	Himeji
27020	美方	Mikata
27021	美嚢	Mino	1
27022	三原	Mihara	1
27023	武庫	Muko	1
27024	養父	Yabu	1
2703	尼崎	Amagasaki
2704	明石	Akashi
2705	西宮	Nishinomiya
2706	洲本	Sumoto
2707	芦屋	Ashiya
2708	伊丹	Itami
2709	相生	Aioi
2710	豊岡	Toyooka
2711	加古川	Kakogawa
2712	龍野	Tatsuno	1
2713	赤穂	Ako
2714	西脇	Nishiwaki
2715	宝塚	Takarazuka
2716	三木	Miki
2717	高砂	Takasago
2718	川西	Kawanishi
2719	小野	Ono
2720	三田	Sanda
2721	加西	Kasai
2722	篠山	Sasayama	1
2723	養父	Yabu
2724	丹波	Tanba
2725	南あわじ	Minamiawaji
2726	朝来	Asago
2727	淡路	Awaji
2728	宍粟	Shiso
2729	加東	Kato
2730	たつの	Tatsuno
2731	丹波篠山	Tanbasasayama
28001	射水	Imizu	1
28002	上新川	Kaminiikawa	1
28003	下新川	Shimoniikawa
28004	中新川	Nakaniikawa
28005	西砺波	Nishitonami	1
28006	婦負	Nei	1
28007	氷見	Himi	1
28008	東砺波	Higashitonami	1
2801	富山	Toyama
2802	高岡	Takaoka
2803	新湊	Shinminato	1
2804	魚津	Uozu
2805	氷見	Himi
2806	滑川	Namerikawa
2807	黒部	Kurobe
2808	砺波	Tonami
2809	小矢部	Oyabe
2810	南砺	Nanto
2811	射水	Imizu
29001	足羽	Asuwa	1
29002	今立	Imadate
29003	大飯	Oi
29004	大野	Ono	1
29005	遠敷	Onyu	1
29006	坂井	Sakai	1
29007	敦賀	Tsuruga	1
29008	南条	Nanjo
29009	丹生	Nyu
2901	福井	Fukui
29010	三方	Mikata
29011	吉田	Yoshida
29012	三方上中	Mikatakaminaka
2902	敦賀	Tsuruga
2903	武生	Takefu	1
2904	小浜	Obama
2905	大野	Ono
2906	勝山	Katsuyama
2907	鯖江	Sabae
2908	あわら	Awara
2909	越前	Echizen
2910	坂井	Sakai
30001	石川	Ishikawa	1
30002	江沼	Enuma	1
30003	鹿島	Kashima
30004	河北	Kahoku
30005	珠洲	Suzu	1
30006	能美	Nomi
30007	羽咋	Hakui
30008	鳳至	Fugeshi	1
30009	鳳珠	Hosu
3001	金沢	Kanazawa
3002	七尾	Nanao
3003	小松	Komatsu
3004	輪島	Wajima
3005	珠洲	Suzu
3006	加賀	Kaga
3007	羽咋	Hakui
3008	松任	Matsuto	1
3009	かほく	Kahoku
3010	白山	Hakusan
3011	能美	Nomi	1
31001	英田	Aida
31002	赤磐	Akaiwa	1
31003	浅口	Asakuchi
31004	阿哲	Atetsu	1
31005	邑久	Oku	1
31006	小田	Oda
31007	勝田	Katsuta
31008	川上	Kawakami	1
31009	吉備	Kibi	1
3101	岡山	Okayama
31010	久米	Kume
310101	北	kita
310102	中	Naka
310103	東	Higashi
310104	南	Minami
31011	児島	Kojima	1
31012	後月	Shitsuki	1
31013	上道	Joto	1
31014	上房	Jobo	1
31015	都窪	Tsukubo
31016	苫田	Tomata
31017	真庭	Maniwa
31018	御津	Mitsu	1
31019	和気	Wake
3102	倉敷	Kurashiki
31020	加賀	Kaga
3103	津山	Tsuyama
3104	玉野	Tamano
3105	児島	Kojima	1
3106	玉島	Tamashima	1
3107	笠岡	Kasaoka
3108	西大寺	saidaiji	1
3109	井原	Ibara
3110	総社	Soja
3111	高梁	Takahashi
3112	新見	Niimi
3113	備前	Bizen
3114	瀬戸内	Setouchi
3115	赤磐	Akaiwa
3116	真庭	Maniwa
3117	美作	Mimasaka
3118	浅口	Asakuchi
32001	安濃	Ano	1
32002	海士	Ama	1
32003	飯石	Iishi
32004	邑智	Ochi
32005	大原	Ohara	1
32006	隠岐	Oki
32007	隠地	Ochi	1
32008	鹿足	Kanoashi
32009	周吉	Suki	1
3201	松江	Matsue
32010	知夫	Chibu	1
32011	那賀	Naka	1
32012	仁多	Nita
32013	迩摩	Nima	1
32014	能義	Nogi	1
32015	簸川	Hikawa	1
32016	美濃	Mino	1
32017	八束	Yatsuka	1
3202	浜田	Hamada
3203	出雲	Izumo
3204	益田	Masuda
3205	大田	Oda
3206	安来	Yasugi
3207	江津	Gotsu
3208	平田	Hirata	1
3209	雲南	Unnan
33001	厚狭	Asa	1
33002	阿武	Abu
33003	大島	Oshima
33004	大津	Otsu	1
33005	玖珂	Kuga
33006	熊毛	Kumage
33007	佐波	Saba	1
33008	都濃	Tsuno	1
33009	豊浦	Toyoura	1
3301	山口	Yamaguchi
33010	美祢	Mine	1
33011	吉敷	Yoshiki	1
3302	下関	Shimonoseki
3303	宇部	Ube
3304	萩	Hagi
3305	徳山	Tokuyama	1
3306	防府	Hofu
3307	下松	Kudamatsu
3308	岩国	Iwakuni
3309	小野田	Onoda	1
3310	光	Hikari
3311	長門	Nagato
3312	柳井	Yanai
3313	美祢	Mine
3314	新南陽	Shinnan'yo	1
3315	周南	Shunan
3316	山陽小野田	San'youonoda
34001	岩美	Iwami
34002	気高	Ketaka	1
34003	西伯	Saihaku
34004	東伯	Tohaku
34005	日野	Hino
34006	八頭	Yazu
3401	鳥取	Tottori
3402	倉吉	Kurayoshi
3403	米子	Yonago
3404	境港	Sakaiminato
35001	安芸	Aki
35002	安佐	Asa	1
35003	芦品	Ashina	1
35004	賀茂	Kamo	1
35005	甲奴	Konu	1
35006	佐伯	Saeki	1
35007	神石	Jinseki
35008	世羅	Sera
35009	高田	Takata	1
3501	広島	Hiroshima
35010	豊田	Toyota
350101	広島県広島市中区	Naka
350102	広島県広島市東区	Higashi
350103	広島県広島市南区	Minami
350104	広島県広島市西区	Nishi
350105	広島県広島市安佐南区	Asaminami
350106	広島県広島市安佐北区	Asakita
350107	広島県広島市安芸区	Aki
350108	広島県広島市佐伯区	Saeki
35011	沼隈	Numakuma	1
35012	比婆	Hiba	1
35013	深安	Fukayasu	1
35014	双三	Futami	1
35015	御調	Mitsugi	1
35016	山県	Yamagata
3502	呉	Kure
3503	竹原	Takehara
3504	三原	Mihara
3505	尾道	Onomichi
3506	因島	Innoshima	1
3507	松永	Matsunaga	1
3508	福山	Fukuyama
3509	府中	Fuchu
3510	三次	Miyoshi
3511	庄原	Syoubara
3512	大竹	Otake
3513	東広島	Higashihiroshima
3514	廿日市	Hatsukaichi
3515	安芸高田	Akitakata
3516	江田島	Etajima
36001	綾歌	Ayauta
36002	大川	Okawa	1
36003	香川	Kagawa
36004	木田	Kita
36005	小豆	Shozu
36006	仲多度	Nakatado
36007	三豊	Mitoyo	1
3601	高松	Takamatsu
3602	丸亀	Marugame
3603	坂出	Sakaide
3604	善通寺	Zentsuji
3605	観音寺	Kan'onji
3606	さぬき	Sanuki
3607	東かがわ	Higashikagawa
3608	三豊	Mitoyo
37001	阿波	Awa	1
37002	板野	Itano
37003	麻植	Oe	1
37004	海部	Kaifu
37005	勝浦	Katsuura
37006	那賀	Naka
37007	名西	Myozai
37008	名東	Myodo
37009	美馬	Mima
3701	徳島	Tokushima
37010	三好	Miyoshi
3702	鳴門	Naruto
3703	小松島	Komatsushima
3704	阿南	Anan
3705	吉野川	Yoshinogawa
3706	阿波	Awa
3707	美馬	Mima
3708	三好	Miyoshi
38001	伊予	Iyo
38002	宇摩	Uma	1
38003	越智	Ochi
38004	温泉	Onsen	1
38005	上浮穴	Kamiukena
38006	喜多	Kita
38007	北宇和	Kitauwa
38008	周桑	Shuso	1
38009	新居	Nii	1
3801	松山	Matsuyama
38010	西宇和	Nishiuwa
38011	東宇和	Higashiuwa	1
38012	南宇和	Minamiuwa
3802	今治	Imabari
3803	宇和島	Uwajima
3804	八幡浜	Yawatahama
3805	新居浜	Niihama
3806	西条	Saijo
3807	大洲	Ozu
3808	伊予三島	Iyomishima	1
3809	川之江	Kawanoe	1
3810	伊予	Iyo
3811	北条	Hojo	1
3812	東予	Toyo	1
3813	四国中央	Shikokuchuo
3814	西予	Seiyo
3815	東温	Toon
39001	吾川	Agawa
39002	安芸	Aki
39003	香美	Kami	1
39004	高岡	Takaoka
39005	土佐	Tosa
39006	長岡	Nagaoka
39007	幡多	Hata
3901	高知	Kochi
3902	室戸	Muroto
3903	安芸	Aki
3904	土佐	Tosa
3905	須崎	Susaki
3906	中村	Nakamura	1
3907	宿毛	Sukumo
3908	土佐清水	Tosashimizu
3909	南国	Nankoku
3910	四万十	Shimanto
3911	香南	Konan
3912	香美	Kami
40001	朝倉	Asakura
40002	糸島	Itoshima	1
40003	浮羽	Ukiha	1
40004	遠賀	Onga
40005	糟屋	Kasuya
40006	嘉穂	Kaho
40007	鞍手	Kurate
40008	早良	Sawara	1
40009	田川	Tagawa
4001	福岡	Fukuoka
40010	筑紫	Chikushi	1
400101	福岡県福岡市東区	Higashi
400102	福岡県福岡市博多区	Hakata
400103	福岡県福岡市中央区	Chuo
400104	福岡県福岡市南区	Minami
400105	福岡県福岡市西区	Nishi
400106	福岡県福岡市城南区	Jonan
400107	福岡県福岡市早良区	Sawara
40011	築上	Chikujo
40012	三井	Mii
40013	三池	Miike	1
40014	三潴	Mizuma
40015	京都	Miyako
40016	宗像	Munakata	1
40017	山門	Yamato	1
40018	八女	Yame
4002	小倉	Kokura	1
4003	門司	Moji	1
4004	八幡	Yahata	1
4005	戸畑	Tobata	1
4006	若松	Wakamatsu	1
4007	久留米	Kurume
4008	大牟田	Omuta
4009	直方	Noogata
4010	飯塚	Iizuka
4011	田川	Tagawa
4012	柳川	Yanagawa
4013	甘木	Amagi	1
4014	山田	Yamada	1
4015	八女	Yame
4016	筑後	Chikugo
4017	大川	Okawa
4018	行橋	Yukuhashi
4019	豊前	Buzen
4020	中間	Nakama
4021	北九州	Kitakyushu
402101	福岡県北九州市門司区	Moji
402102	福岡県北九州市若松区	Wakamatsu
402103	福岡県北九州市戸畑区	Tobata
402104	福岡県北九州市小倉北区	Kokurakita
402105	福岡県北九州市小倉南区	Kokuraminami
402106	福岡県北九州市八幡東区	Yahatahigashi
402107	福岡県北九州市八幡西区	Yahatanishi
402108	福岡県北九州市八幡区	Yahata	1
402109	福岡県北九州市小倉区	Kokura	1
4022	小郡	Ogoori
4023	春日	Kasuga
4024	筑紫野	Chikushino
4025	大野城	Onojo
4026	宗像	Munakata
4027	太宰府	Dazaifu
4028	前原	Maebaru	1
4029	古賀	Koga
4030	福津	Fukutsu
4031	うきは	Ukiha
4032	宮若	Miyawaka
4033	嘉麻	Kama
4034	朝倉	Asakura
4035	みやま	Miyama
4036	糸島	Itoshima
4037	那珂川	Nakagawa
41001	小城	Ogi	1
41002	神埼	Kanzaki
41003	杵島	Kishima
41004	佐賀	Saga	1
41005	西松浦	Nishimatsuura
41006	東松浦	Higashimatsuura
41007	藤津	Fujitsu
41008	三養基	Miyaki
4101	佐賀	Saga
4102	唐津	Karatsu
4103	鳥栖	Tosu
4104	多久	Taku
4105	伊万里	Imari
4106	武雄	Takeo
4107	鹿島	Kashima
4108	小城	Ogi
4109	嬉野	Ureshino
4110	神埼	Kanzaki
42001	壱岐	Iki	1
42002	上県	Kamiagata	1
42003	北高来	Kitatakaki	1
42004	北松浦	Kitamatsuura
42005	下県	Shimoagata	1
42006	西彼杵	Nishisonogi
42007	東彼杵	Higashisonogi
42008	南高来	Minamitakaki	1
42009	南松浦	Minamimatsuura
4201	長崎	Nagasaki
4202	佐世保	Sasebo
4203	島原	Shimabara
4204	諫早	Isahaya
4205	大村	Omura
4206	福江	Fukue	1
4207	平戸	Hirado
4208	松浦	Matsuura
4209	対馬	Tsushima
4210	壱岐	Iki
4211	五島	Goto
4212	西海	Saikai
4213	雲仙	Unzen
4214	南島原	Minamishimabara
43001	葦北	Ashikita
43002	阿蘇	Aso
43003	天草	Amakusa
43004	宇土	Uto	1
43005	上益城	Kamimashiki
43006	鹿本	Kamoto	1
43007	菊池	Kikuchi
43008	球磨	Kuma
43009	下益城	Shimomashiki
4301	熊本	Kumamoto
43010	玉名	Tamana
430101	中央	Chuo
430102	東	Higashi
430103	西	Nishi
430104	南	Minami
430105	北	Kita
43011	飽託	Hotaku	1
43012	八代	Yatsushiro
4302	八代	Yatsushiro
4303	人吉	Hitoyoshi
4304	荒尾	Arao
4305	水俣	Minamata
4306	玉名	Tamana
4307	本渡	Hondo	1
4308	山鹿	Yamaga
4309	牛深	Ushibuka	1
4310	菊池	Kikuchi
4311	宇土	Uto
4312	上天草	Kamiamakusa
4313	宇城	Uki
4314	阿蘇	Aso
4315	天草	Amakusa
4316	合志	Koshi
44001	宇佐	Usa	1
44002	大分	Oita	1
44003	大野	Ono	1
44004	北海部	Kitaamabe	1
44005	玖珠	kusu
44006	下毛	Shimoge	1
44007	直入	Naoiri	1
44008	西国東	Nishikunisaki	1
44009	速見	Hayami
4401	大分	Oita
44010	東国東	Higashikunisaki
44011	日田	hita	1
44012	南海部	Minamiamabe	1
4402	別府	Beppu
4403	中津	Nakatsu
4404	日田	Hita
4405	佐伯	Saiki
4406	臼杵	Usuki
4407	津久見	Tsukumi
4408	竹田	Taketa
4409	鶴崎	Tsurusaki	1
4410	豊後高田	Bungotakada
4411	杵築	Kitsuki
4412	宇佐	Usa
4413	豊後大野	Bungoono
4414	由布	Yufu
4415	国東	Kunisaki
45001	北諸県	Kitamorokata
45002	児湯	Koyu
45003	西臼杵	Nishiusuki
45004	西諸県	Nishimorokata
45005	東臼杵	Higashiusuki
45006	東諸県	Higashimorokata
45007	南那珂	Minaminaka	1
45008	宮崎	Miyazaki	1
4501	宮崎	Miyazaki
4502	都城	Miyakonojo
4503	延岡	Nobeoka
4504	日南	Nichinan
4505	小林	Kobayashi
4506	日向	Hyuga
4507	串間	Kushima
4508	西都	Saito
4509	えびの	Ebino
46001	姶良	Aira
46002	伊佐	Isa	1
46003	出水	Izumi
46004	揖宿	Ibusuki	1
46005	大島	Oshima
46006	鹿児島	Kagoshima
46007	川辺	Kawanabe	1
46008	肝属	Kimotsuki
46009	熊毛	Kumage
4601	鹿児島	Kagoshima
46010	薩摩	Satsuma
46011	曽於	Soo
46012	日置	Hioki	1
4602	川内	Sendai	1
4603	鹿屋	Kanoya
4604	枕崎	Makurazaki
4605	串木野	Kushikino	1
4606	阿久根	Akune
4607	出水	Izumi
4608	名瀬	Naze	1
4609	大口	Okuchi	1
4610	指宿	Ibusuki
4611	加世田	Kaseda	1
4612	国分	Kokubu	1
4613	谷山	Taniyama	1
4614	西之表	Nishinoomote
4615	垂水	Tarumizu
4616	薩摩川内	Satsumasendai
4617	日置	Hioki
4618	曽於	Soo
4619	霧島	Kirishima
4620	いちき串木野	Ichikikushikino
4621	南さつま	Minamisatsuma
4622	志布志	Shibushi
4623	奄美	Amami
4624	南九州	Minamikyushu
4625	伊佐	Isa
4626	姶良	Aira
47001	国頭	Kunigami
47002	島尻	Shimajiri
47003	中頭	Nakagami
47004	宮古	Miyako
47005	八重山	Yaeyama
4701	那覇	Naha
4702	石川	Ishikawa	1
4703	平良	Hirara	1
4704	石垣	Ishigaki
4705	コザ	Koza	1
4706	宜野湾	Ginowan
4707	具志川	Gushikawa	1
4708	名護	Nago
4709	浦添	Urasoe
4710	糸満	Itoman
4711	沖縄	Okinawa
4712	豊見城	Tomigusuku
4713	うるま	Uruma
4714	宮古島	Miyakojima
4715	南城	Nanjo`;
