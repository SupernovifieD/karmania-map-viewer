/**
 * The colour data of the ramps, as `#rrggbb` written one after the other (seven characters each) and cut apart by
 * `ramps.ts`. Written by a script from the sources below and not by hand; `ramp-data.test.ts` pins the end points
 * and a checksum of every table, so that an edit by mistake is found.
 *
 * viridis and magma: matplotlib 3.10.0, `lib/matplotlib/_cm_listed.py`, `_viridis_data` and `_magma_data` (256
 * colours each), which are the same numbers as the original `colormaps.py` of github.com/BIDS/colormap, by
 * Nathaniel J. Smith, Stefan van der Walt and (viridis) Eric Firing. That file says: "This file and the colormaps
 * in it are released under the CC0 license / public domain dedication. We would appreciate credit if you use or
 * redistribute these colormaps, but do not impose any legal restrictions." Licence: CC0-1.0. Each component is
 * multiplied by 255 and rounded (half up).
 *
 * cividis: matplotlib 3.10.0, `lib/matplotlib/_cm_listed.py`, `_cividis_data` (256 colours), which is the colormap of github.com/pnnl/cmaputil by
 * (described in "Optimizing colormaps with consideration for color vision deficiency to enable accurate interpretation of scientific data",
 * doi:10.1371/journal.pone.0199239), Copyright (c) 2017, Battelle Memorial Institute. **It is not CC0**: it is
 * under Battelle's own permissive licence (use, copy, modify, merge, publish, distribute, sublicense and sell, with the copyright notice and the
 * disclaimers kept, and without using the name of Battelle in any form without its written consent), whose whole text is in
 * `THIRD_PARTY_NOTICES.md`. The owner approved it on 2026-11-08 (decision 16.F14). Each component is multiplied by 255 and rounded (half up),
 * as for viridis and magma, whose tables this rule gives exactly.
 *
 * ColorBrewer: github.com/axismaps/colorbrewer, `export/colorbrewer.js`, whose licence file is the Apache License
 * 2.0 and whose header says: "This product includes color specifications and designs developed by Cynthia Brewer
 * (http://colorbrewer.org/)." Licence: Apache-2.0. The scheme of the most colours is taken (9 for the sequential
 * ramps, 11 for the diverging, 12 for the qualitative one), and `ramps.ts` samples it for other counts.
 */

/** viridis, 256 colours, dark purple to yellow. */
export const VIRIDIS =
  '#440154#440256#450457#450559#46075a#46085c#460a5d#460b5e#470d60#470e61#471063#471164#471365#481467#481668#481769#48186a#481a6c#481b6d#481c6e#481d6f#481f70#482071#482173#482374#482475#482576#482677#482878#482979#472a7a#472c7a#472d7b#472e7c#472f7d#46307e#46327e#46337f#463480#453581#453781#453882#443983#443a83#443b84#433d84#433e85#423f85#424086#424186#414287#414487#404588#404688#3f4788#3f4889#3e4989#3e4a89#3e4c8a#3d4d8a#3d4e8a#3c4f8a#3c508b#3b518b#3b528b#3a538b#3a548c#39558c#39568c#38588c#38598c#375a8c#375b8d#365c8d#365d8d#355e8d#355f8d#34608d#34618d#33628d#33638d#32648e#32658e#31668e#31678e#31688e#30698e#306a8e#2f6b8e#2f6c8e#2e6d8e#2e6e8e#2e6f8e#2d708e#2d718e#2c718e#2c728e#2c738e#2b748e#2b758e#2a768e#2a778e#2a788e#29798e#297a8e#297b8e#287c8e#287d8e#277e8e#277f8e#27808e#26818e#26828e#26828e#25838e#25848e#25858e#24868e#24878e#23888e#23898e#238a8d#228b8d#228c8d#228d8d#218e8d#218f8d#21908d#21918c#20928c#20928c#20938c#1f948c#1f958b#1f968b#1f978b#1f988b#1f998a#1f9a8a#1e9b8a#1e9c89#1e9d89#1f9e89#1f9f88#1fa088#1fa188#1fa187#1fa287#20a386#20a486#21a585#21a685#22a785#22a884#23a983#24aa83#25ab82#25ac82#26ad81#27ad81#28ae80#29af7f#2ab07f#2cb17e#2db27d#2eb37c#2fb47c#31b57b#32b67a#34b679#35b779#37b878#38b977#3aba76#3bbb75#3dbc74#3fbc73#40bd72#42be71#44bf70#46c06f#48c16e#4ac16d#4cc26c#4ec36b#50c46a#52c569#54c568#56c667#58c765#5ac864#5cc863#5ec962#60ca60#63cb5f#65cb5e#67cc5c#69cd5b#6ccd5a#6ece58#70cf57#73d056#75d054#77d153#7ad151#7cd250#7fd34e#81d34d#84d44b#86d549#89d548#8bd646#8ed645#90d743#93d741#95d840#98d83e#9bd93c#9dd93b#a0da39#a2da37#a5db36#a8db34#aadc32#addc30#b0dd2f#b2dd2d#b5de2b#b8de29#bade28#bddf26#c0df25#c2df23#c5e021#c8e020#cae11f#cde11d#d0e11c#d2e21b#d5e21a#d8e219#dae319#dde318#dfe318#e2e418#e5e419#e7e419#eae51a#ece51b#efe51c#f1e51d#f4e61e#f6e620#f8e621#fbe723#fde725';

/** magma, 256 colours, black to pale yellow. */
export const MAGMA =
  '#000004#010005#010106#010108#020109#02020b#02020d#03030f#030312#040414#050416#060518#06051a#07061c#08071e#090720#0a0822#0b0924#0c0926#0d0a29#0e0b2b#100b2d#110c2f#120d31#130d34#140e36#150e38#160f3b#180f3d#19103f#1a1042#1c1044#1d1147#1e1149#20114b#21114e#221150#241253#251255#271258#29115a#2a115c#2c115f#2d1161#2f1163#311165#331067#341069#36106b#38106c#390f6e#3b0f70#3d0f71#3f0f72#400f74#420f75#440f76#451077#471078#491078#4a1079#4c117a#4e117b#4f127b#51127c#52137c#54137d#56147d#57157e#59157e#5a167e#5c167f#5d177f#5f187f#601880#621980#641a80#651a80#671b80#681c81#6a1c81#6b1d81#6d1d81#6e1e81#701f81#721f81#732081#752181#762181#782281#792282#7b2382#7c2382#7e2482#802582#812581#832681#842681#862781#882781#892881#8b2981#8c2981#8e2a81#902a81#912b81#932b80#942c80#962c80#982d80#992d80#9b2e7f#9c2e7f#9e2f7f#a02f7f#a1307e#a3307e#a5317e#a6317d#a8327d#aa337d#ab337c#ad347c#ae347b#b0357b#b2357b#b3367a#b5367a#b73779#b83779#ba3878#bc3978#bd3977#bf3a77#c03a76#c23b75#c43c75#c53c74#c73d73#c83e73#ca3e72#cc3f71#cd4071#cf4070#d0416f#d2426f#d3436e#d5446d#d6456c#d8456c#d9466b#db476a#dc4869#de4968#df4a68#e04c67#e24d66#e34e65#e44f64#e55064#e75263#e85362#e95462#ea5661#eb5760#ec5860#ed5a5f#ee5b5e#ef5d5e#f05f5e#f1605d#f2625d#f2645c#f3655c#f4675c#f4695c#f56b5c#f66c5c#f66e5c#f7705c#f7725c#f8745c#f8765c#f9785d#f9795d#f97b5d#fa7d5e#fa7f5e#fa815f#fb835f#fb8560#fb8761#fc8961#fc8a62#fc8c63#fc8e64#fc9065#fd9266#fd9467#fd9668#fd9869#fd9a6a#fd9b6b#fe9d6c#fe9f6d#fea16e#fea36f#fea571#fea772#fea973#feaa74#feac76#feae77#feb078#feb27a#feb47b#feb67c#feb77e#feb97f#febb81#febd82#febf84#fec185#fec287#fec488#fec68a#fec88c#feca8d#fecc8f#fecd90#fecf92#fed194#fed395#fed597#fed799#fed89a#fdda9c#fddc9e#fddea0#fde0a1#fde2a3#fde3a5#fde5a7#fde7a9#fde9aa#fdebac#fcecae#fceeb0#fcf0b2#fcf2b4#fcf4b6#fcf6b8#fcf7b9#fcf9bb#fcfbbd#fcfdbf';

/** cividis, 256 colours, dark blue to yellow, made to be read by people with the common kinds of colour blindness. */
export const CIVIDIS =
  '#00224e#00234f#002451#002553#002554#002656#002758#002859#00285b#00295d#002a5f#002a61#002b62#002c64#002c66#002d68#002e6a#002e6c#002f6d#00306f#003070#003170#003171#013271#053371#083370#0c3470#0f3570#123570#143670#163770#18376f#1a386f#1c396f#1e3a6f#203a6f#213b6e#233c6e#243c6e#263d6e#273e6e#293f6e#2a3f6d#2b406d#2d416d#2e416d#2f426d#31436d#32436d#33446d#34456c#35456c#36466c#38476c#39486c#3a486c#3b496c#3c4a6c#3d4a6c#3e4b6c#3f4c6c#404c6c#414d6c#424e6c#434e6c#444f6c#45506c#46516c#47516c#48526c#49536c#4a536c#4b546c#4c556c#4d556c#4e566c#4f576c#50576c#51586d#52596d#535a6d#545a6d#555b6d#555c6d#565c6d#575d6d#585e6d#595e6e#5a5f6e#5b606e#5c616e#5d616e#5e626e#5e636f#5f636f#60646f#61656f#62656f#636670#646770#656870#656870#666970#676a71#686a71#696b71#6a6c71#6b6d72#6c6d72#6c6e72#6d6f72#6e6f73#6f7073#707173#717274#727274#727374#737475#747475#757575#767676#777776#777777#787877#797977#7a7a78#7b7a78#7c7b78#7d7c78#7e7c78#7e7d78#7f7e78#807f78#817f78#828079#838179#848279#858279#868379#878478#888578#898578#8a8678#8b8778#8c8878#8d8878#8e8978#8f8a78#908b78#918b78#928c78#928d78#938e78#948e77#958f77#969077#979177#989277#999277#9a9376#9b9476#9c9576#9d9576#9e9676#9f9775#a09875#a19975#a29975#a39a74#a49b74#a59c74#a69c74#a79d73#a89e73#a99f73#aaa073#aba072#aca172#ada272#aea371#afa471#b0a571#b1a570#b3a670#b4a76f#b5a86f#b6a96f#b7a96e#b8aa6e#b9ab6d#baac6d#bbad6d#bcae6c#bdae6c#beaf6b#bfb06b#c0b16a#c1b26a#c2b369#c3b369#c4b468#c5b568#c6b667#c7b767#c8b866#c9b965#cbb965#ccba64#cdbb63#cebc63#cfbd62#d0be62#d1bf61#d2c060#d3c05f#d4c15f#d5c25e#d6c35d#d7c45c#d9c55c#dac65b#dbc75a#dcc859#ddc858#dec958#dfca57#e0cb56#e1cc55#e2cd54#e4ce53#e5cf52#e6d051#e7d150#e8d24f#e9d34e#ead34c#ebd44b#edd54a#eed649#efd748#f0d846#f1d945#f2da44#f3db42#f5dc41#f6dd3f#f7de3e#f8df3c#f9e03a#fbe138#fce236#fde334#fee434#fee535#fee636#fee838';

/** ColorBrewer sequential schemes, 9 colours, light to dark. */
export const BREWER_SEQUENTIAL = {
  blues: '#f7fbff#deebf7#c6dbef#9ecae1#6baed6#4292c6#2171b5#08519c#08306b',
  greens: '#f7fcf5#e5f5e0#c7e9c0#a1d99b#74c476#41ab5d#238b45#006d2c#00441b',
  oranges: '#fff5eb#fee6ce#fdd0a2#fdae6b#fd8d3c#f16913#d94801#a63603#7f2704',
  reds: '#fff5f0#fee0d2#fcbba1#fc9272#fb6a4a#ef3b2c#cb181d#a50f15#67000d',
  purples: '#fcfbfd#efedf5#dadaeb#bcbddc#9e9ac8#807dba#6a51a3#54278f#3f007d',
  ylgnbu: '#ffffd9#edf8b1#c7e9b4#7fcdbb#41b6c4#1d91c0#225ea8#253494#081d58',
  ylorrd: '#ffffcc#ffeda0#fed976#feb24c#fd8d3c#fc4e2a#e31a1c#bd0026#800026',
} as const;

/** ColorBrewer diverging schemes, 11 colours, one end to the other through a light middle. */
export const BREWER_DIVERGING = {
  rdbu: '#67001f#b2182b#d6604d#f4a582#fddbc7#f7f7f7#d1e5f0#92c5de#4393c3#2166ac#053061',
  puor: '#7f3b08#b35806#e08214#fdb863#fee0b6#f7f7f7#d8daeb#b2abd2#8073ac#542788#2d004b',
  brbg: '#543005#8c510a#bf812d#dfc27d#f6e8c3#f5f5f5#c7eae5#80cdc1#35978f#01665e#003c30',
} as const;

/** The ColorBrewer qualitative scheme Paired, 12 colours. */
export const BREWER_PAIRED =
  '#a6cee3#1f78b4#b2df8a#33a02c#fb9a99#e31a1c#fdbf6f#ff7f00#cab2d6#6a3d9a#ffff99#b15928';
