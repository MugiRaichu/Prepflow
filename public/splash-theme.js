/*
  起動の絵と、そのあとの背景の透かし。

  **開くたびに変わり、季節でも変わる。**毎日開くものなので、同じ演出が
  毎回だと3日で飽きる。四季それぞれに10種類、あわせて40種類を用意して、
  いまの季節の10種類からどれかを出す。

  40通りを手で書くと必ず破綻するので、**形と動きの組み合わせをデータで持つ**。
  形は9つ（花・花びら・葉・粒・輪・茎・湯気・しずく・星）、
  動きは6つ（伸びる・散る・昇る・降る・ふくらむ・またたく）。
  テーマはその組み合わせと色と数の指定でしかない。

  選んだテーマは**そのままアプリの背景の透かしになる**。同じ形を、
  動かさず、うんと薄く敷く。起動の絵が消えたあと何も残らないと、
  さっきのは何だったのか、という置き去りが出る。

  ここで作るのは DOM だけで、**起動は止めない**（要素は多くて150ほど）。
  動きが苦手な人（prefers-reduced-motion）には、起動の絵は作らない
  （透かしは静止画なので敷く）。
  色は食材の色だけを使う。飾りの色は持ち込まない——この絵は食のためのもの。
*/
(function () {
  var bloom = document.getElementById('pf-bloom');
  var mark = document.getElementById('pf-watermark');
  if (!bloom && !mark) return;

  /*
    出すかどうかの設定。**小さい丸が並ぶ絵が苦手な人がいる。**

    集合体恐怖症（トライポフォビア）は、小さい丸や粒が密に集まった形で
    起きる。粉雪・星あかり・蛍のような絵は、その形そのものになりうる。
    動きが苦手な人向けの設定（prefers-reduced-motion）とは別の話で、
    そちらを入れていない人にも起きる。**別に切れるようにする。**

    localStorage に置くのは、この判断が**本体より先に要る**ため。
    DB を待つと、待っているあいだに絵が出てしまう。端末ごとの見た目の
    設定なので、持ち出す必要もない。

      on    … 動きあり（既定）
      still … 動かさない。背景の透かしだけ
      off   … 何も出さない
  */
  var pref = 'on';
  try { pref = localStorage.getItem('pf-bloom') || 'on'; } catch (e) { pref = 'on'; }
  if (pref === 'off') return;

  var NS = 'http://www.w3.org/2000/svg';
  var W = 400, H = 800, CX = 200, CY = 400;
  var C = {
    akane: '#8c463c', fish: '#4a6c8c', meat: '#9c5a4a', grain: '#b98c4a',
    egg: '#c9a227', veg: '#6e8b5b', soy: '#8a7a5c', cream: '#e8e0d2'
  };
  var R = Math.random;
  function pick(a) { return a[(R() * a.length) | 0]; }
  function rnd(a, b) { return a + R() * (b - a); }
  function n0(v) { return v.toFixed(0); }
  function n1(v) { return v.toFixed(1); }

  var host = bloom, frozen = false;

  /*
    出す時刻。**2段構えにして、早くから始める。**

    直す前は 2450ms から出て 3600ms で消えていたので、見えるのは1.1秒だけ。
    伸びきる前に画面が変わっていた（本人指摘）。
      1段目 700ms  … 下地（草・湯気・遠くのもの）。印を描いている裏で始まる
      2段目 1500ms … 主役（花・実・雪）。名前が出るのと同じ拍で立ち上がる
    起動画面は 3.7秒まで（main.tsx）。**全体を0.7秒短くした**ぶん、
    出す時刻も前へずらして、絵が見える幅を保っている。
  */
  var STAGE1 = 700, STAGE2 = 1500;

  function put(node, motion, style, delay) {
    if (!frozen && motion) {
      node.setAttribute('class', 'm-' + motion);
      node.setAttribute('style', style + ';animation-delay:' + delay + 'ms');
    } else {
      // 透かしは動かさない。開始状態ではなく、着地したあとの姿で置く
      node.setAttribute('style', style.replace(/--[a-z]+:[^;]*;?/g, ''));
    }
    host.appendChild(node);
    return node;
  }
  function svg(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /** 名前と印が乗る帯。ここには置かない（Prepflow が読めなくなる） */
  function onText(x, y) { return y > 300 && y < 452 && x > 40 && x < 360; }
  /** 中央の小さな輪。散るものはここから出る（1点だと噴水に見える） */
  function fromCenter(x, y) {
    var a = Math.atan2(y - CY, x - CX), d = rnd(20, 48);
    return [CX + Math.cos(a) * d, CY + Math.sin(a) * d];
  }

  // --- 形 -----------------------------------------------------------------
  /*
    小さい丸を、密に置かない。

    集合体恐怖症は「小さい丸が規則的に密集した形」で起きる。
    数を減らすだけでなく、**近すぎるものは置かない**（最低でも48だけ離す）。
    格子に沿って並ぶのも避けたいので、ゆらぎは残したまま間引く。
  */
  var placed = [];
  function tooClose(x, y, min) {
    for (var i = 0; i < placed.length; i++) {
      var dx = placed[i][0] - x, dy = placed[i][1] - y;
      if (dx * dx + dy * dy < min * min) return true;
    }
    return false;
  }

  var SHAPE = {
    /** 5弁の花 */
    blossom: function (x, y, r, col) {
      var g = svg('g', { fill: col });
      for (var i = 0; i < 5; i++) {
        var a = (i * 72) * Math.PI / 180;
        var px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        g.appendChild(svg('ellipse', {
          cx: n0(px), cy: n0(py), rx: n1(r * 0.8), ry: n1(r * 0.52),
          transform: 'rotate(' + n0(i * 72) + ' ' + n0(px) + ' ' + n0(py) + ')'
        }));
      }
      g.appendChild(svg('circle', { cx: n0(x), cy: n0(y), r: n1(r * 0.4), fill: C.cream }));
      return g;
    },
    petal: function (x, y, r, col) {
      return svg('path', {
        d: 'M0 0 c ' + n1(r * 0.5) + ' ' + n1(-r * 0.6) + ', ' + n1(r * 1.1) + ' ' + n1(-r * 0.3) +
           ', ' + n1(r * 0.9) + ' ' + n1(r * 0.4) + ' c ' + n1(-r * 0.2) + ' ' + n1(r * 0.6) +
           ', ' + n1(-r * 0.8) + ' ' + n1(r * 0.6) + ', ' + n1(-r * 0.9) + ' ' + n1(-r * 0.4) + ' z',
        fill: col, transform: 'translate(' + n0(x) + ' ' + n0(y) + ') rotate(' + n0(rnd(0, 360)) + ')'
      });
    },
    leaf: function (x, y, r, col) {
      return svg('ellipse', {
        cx: n0(x), cy: n0(y), rx: n1(r), ry: n1(r * 0.45), fill: col,
        transform: 'rotate(' + n0(rnd(0, 360)) + ' ' + n0(x) + ' ' + n0(y) + ')'
      });
    },
    dot: function (x, y, r, col) {
      return svg('circle', { cx: n0(x), cy: n0(y), r: n1(r), fill: col });
    },
    ring: function (x, y, r, col) {
      return svg('circle', { cx: n0(x), cy: n0(y), r: n1(r), fill: 'none', stroke: col, 'stroke-width': '1.6' });
    },
    /**
     * 茎。**必ず緑。**茶色い線が1本伸びるだけだと、何の絵か分からず
     * 気持ちのよいものにならなかった（本人指摘）。茎は緑で、
     * 先に付くものの形で「何なのか」を言う（下の ear / bud）。
     */
    stalk: function (x, y, r, col) {
      var h = r * 6;
      return svg('path', {
        d: 'M' + n0(x) + ' ' + n0(y) + ' c 0 ' + n0(-h / 2) + ', ' + n0(rnd(-14, 14)) + ' ' +
           n0(-h * 0.7) + ', 0 ' + n0(-h),
        stroke: C.veg, 'stroke-width': n1(r * 0.28), fill: 'none', 'stroke-linecap': 'round'
      });
    },
    /** 穂。緑の茎の上半分に粒が並ぶ。稲・麦・すすきはこれで分かる */
    ear: function (x, y, r, col) {
      var h = r * 6, g = svg('g', {});
      g.appendChild(svg('path', {
        d: 'M' + n0(x) + ' ' + n0(y) + ' c 0 ' + n0(-h / 2) + ', ' + n0(rnd(-10, 10)) + ' ' +
           n0(-h * 0.7) + ', ' + n0(rnd(-6, 6)) + ' ' + n0(-h),
        stroke: C.veg, 'stroke-width': n1(r * 0.22), fill: 'none', 'stroke-linecap': 'round'
      }));
      for (var i = 0; i < 7; i++) {
        var t = 0.42 + i * 0.085;
        var px = x + (i % 2 ? 1 : -1) * r * 0.34;
        var py = y - h * t;
        g.appendChild(svg('ellipse', {
          cx: n0(px), cy: n0(py), rx: n1(r * 0.3), ry: n1(r * 0.16), fill: col,
          transform: 'rotate(' + (i % 2 ? 34 : -34) + ' ' + n0(px) + ' ' + n0(py) + ')'
        }));
      }
      return g;
    },
    /** 芽。緑の茎の先に、ふくらんだ頭が付く。つくし・冬芽 */
    bud: function (x, y, r, col) {
      var h = r * 5, g = svg('g', {});
      g.appendChild(svg('path', {
        d: 'M' + n0(x) + ' ' + n0(y) + ' c 0 ' + n0(-h / 2) + ', ' + n0(rnd(-8, 8)) + ' ' +
           n0(-h * 0.7) + ', 0 ' + n0(-h),
        stroke: C.veg, 'stroke-width': n1(r * 0.24), fill: 'none', 'stroke-linecap': 'round'
      }));
      g.appendChild(svg('ellipse', {
        cx: n0(x), cy: n1(y - h - r * 0.3), rx: n1(r * 0.4), ry: n1(r * 0.62), fill: col
      }));
      return g;
    },
    /** 湯気。左右に振れながら立つ */
    steam: function (x, y, r, col) {
      var h = r * 14;
      return svg('path', {
        d: 'M' + n0(x) + ' ' + n0(y) + ' c ' + n0(rnd(-30, 30)) + ' ' + n0(-h / 3) + ', ' +
           n0(rnd(-30, 30)) + ' ' + n0(-h * 2 / 3) + ', 0 ' + n0(-h),
        stroke: col, 'stroke-width': n1(r * 0.34), fill: 'none', 'stroke-linecap': 'round'
      });
    },
    drop: function (x, y, r, col) {
      return svg('path', {
        d: 'M' + n0(x) + ' ' + n0(y - r * 1.6) + ' q ' + n1(r) + ' ' + n1(r * 1.6) + ' 0 ' +
           n1(r * 2.2) + ' q ' + n1(-r) + ' ' + n1(-r * 0.6) + ' 0 ' + n1(-r * 2.2) + ' z',
        fill: col
      });
    },
    // --- 幾何のかたち -----------------------------------------------------
    /*
      **まるいものだけ。**

      弧・扇・への字・三角・棒も作ってみたが、向きがばらけると
      さすまたのような妙な形に見えた（本人指摘）。とがった端と
      折れた線は、小さく薄くすると意図が読めない。

      残したのは、丸・輪・半円・角の丸い四角の4つ。どれも輪郭に
      向きが無いので、どう並べても落ち着く。

      温かみは**ぼかしと重なり**で出す。輪郭をぼかすと版画のように
      にじみ、重なったところが濃くなる（mix-blend-mode: multiply）。
      **くっきりした均一な塗りが、いちばん冷たい。**
    */
    /** 丸。いちばん基本の形 */
    disc: function (x, y, r, col) {
      return svg('circle', { cx: n1(x), cy: n1(y), r: n1(r), fill: col });
    },
    /** 輪。中が抜けた丸 */
    band: function (x, y, r, col) {
      return svg('circle', {
        cx: n1(x), cy: n1(y), r: n1(r), fill: 'none', stroke: col, 'stroke-width': n1(r * 0.34)
      });
    },
    /** 半円。向きは4方向のどれか */
    halfDisc: function (x, y, r, col) {
      return svg('path', {
        d: 'M' + n1(x - r) + ' ' + n1(y) + ' A ' + n1(r) + ' ' + n1(r) + ' 0 0 1 ' +
           n1(x + r) + ' ' + n1(y) + ' Z',
        fill: col, transform: 'rotate(' + n0(pick([0, 90, 180, 270])) + ' ' + n0(x) + ' ' + n0(y) + ')'
      });
    },
    /** 角の丸い四角。ほとんど丸だが、少しだけ角がある */
    squircle: function (x, y, r, col) {
      return svg('rect', {
        x: n1(x - r), y: n1(y - r), width: n1(r * 2), height: n1(r * 2),
        rx: n1(r * 0.62), fill: col,
        transform: 'rotate(' + n0(rnd(-8, 8)) + ' ' + n0(x) + ' ' + n0(y) + ')'
      });
    },

    /** 四芒星。またたきに使う */
    star: function (x, y, r, col) {
      return svg('path', {
        d: 'M' + n0(x) + ' ' + n1(y - r) + ' Q' + n0(x) + ' ' + n0(y) + ' ' + n1(x + r) + ' ' + n0(y) +
           ' Q' + n0(x) + ' ' + n0(y) + ' ' + n0(x) + ' ' + n1(y + r) +
           ' Q' + n0(x) + ' ' + n0(y) + ' ' + n1(x - r) + ' ' + n0(y) +
           ' Q' + n0(x) + ' ' + n0(y) + ' ' + n0(x) + ' ' + n1(y - r) + ' z',
        fill: col
      });
    }
  };

  // --- 動き ---------------------------------------------------------------
  function style(motion, x, y, o) {
    var base = '--o:' + o + ';transform-origin:' + n0(x) + 'px ' + n0(y) + 'px';
    if (motion === 'burst') {
      var f = fromCenter(x, y);
      return base + ';--dx:' + n0(f[0] - x) + 'px;--dy:' + n0(f[1] - y) + 'px';
    }
    // 横の振れ幅。まっすぐ落ちる/昇るものは、紙吹雪か煙突に見える
    if (motion === 'rise') {
      return base + ';--dy:' + n0(rnd(40, 110)) + 'px;--sway:' + n0(rnd(-26, 26)) + 'px';
    }
    // 風。横から入って、ひと吹きで流れていく
    if (motion === 'wind') {
      return base + ';--dx:-' + n0(rnd(200, 340)) + 'px;--sway:' + n0(rnd(-30, 30)) +
             'px;--rot:' + n0(rnd(80, 320)) + 'deg';
    }
    if (motion === 'fall') {
      return base + ';--dy:-' + n0(rnd(120, 260)) + 'px;--sway:' + n0(rnd(-34, 34)) +
             'px;--rot:' + n0(rnd(120, 520)) + 'deg';
    }
    return base;
  }

  /**
   * 1層ぶんを描く。テーマはこの指定の並びでしかない。
   * shape 形 / motion 動き / n 数 / r 大きさ / cols,rows 配り方 / band 縦の帯 / avoidText 文字を避ける
   */
  function layer(sp) {
    var i, x, y, k = 0;
    var cols = sp.cols || 0;
    if (cols) {
      for (var ix = 0; ix < cols; ix++) {
        for (var iy = 0; iy < sp.rows; iy++) {
          if (R() < (sp.skip || 0.24)) continue;
          x = (ix + 0.5) * (W / cols) + rnd(-22, 22);
          y = (iy + 0.5) * (H / sp.rows) + rnd(-24, 24);
          if (sp.avoidText && onText(x, y)) continue;
          one(sp, x, y, k++);
        }
      }
      return;
    }
    for (i = 0; i < sp.n; i++) {
      x = rnd(sp.x0 == null ? 0 : sp.x0, sp.x1 == null ? W : sp.x1);
      y = rnd(sp.y0 == null ? 0 : sp.y0, sp.y1 == null ? H : sp.y1);
      if (sp.avoidText && onText(x, y)) continue;
      one(sp, x, y, i);
    }
  }
  /*
    奥行き。遠いものは小さく・遅く・薄く、近いものは大きく・速く・濃く。
    **視差で「景色」に見せる。**全部が同じ速さだと紙吹雪にしか見えない。
  */
  var DEPTH = [
    { cls: 'far', s: 0.6, o: 0.45 },
    { cls: 'mid', s: 0.85, o: 0.8 },
    { cls: 'near', s: 1.15, o: 1 }
  ];

  /*
    リズム。**等間隔に出すと機械に見える。**

    どれも「k番目のものを何ms遅らせるか」を返すだけ。動きの種類ごとに
    似合うリズムが違うので、既定を決めつつテーマ側で上書きできる。

      even   … 等間隔。静かなもの（またたき）に
      beat   … 4つずつのまとまり（タタタタ、タタタタ）
      swing  … 長short長short。跳ねる感じが出る
      accel  … だんだん速く。伸びるもの（草・穂）が一斉に立ち上がる
      decel  … だんだん遅く。落ち着いていく
      wave   … 波。風がひと吹きするたびに、まとまって降る
      three  … 3回のかたまり。ドンッ、ドンッ、ドンッ
      drift  … ゆらぎ。自然物はきっちり並ばない
  */
  var RHYTHM = {
    even: function (k, st) { return k * st; },
    beat: function (k, st) { return ((k / 4) | 0) * (st * 5) + (k % 4) * st; },
    swing: function (k, st) { return ((k / 2) | 0) * (st * 3) + (k % 2) * (st * 1.8); },
    accel: function (k, st) { return st * 9 * Math.sqrt(k) - k * st * 0.25; },
    decel: function (k, st) { return k * st * (1 + k * 0.045); },
    wave: function (k, st) { return k * st + Math.sin(k * 0.7) * st * 5; },
    three: function (k, st) { return ((k % 3) * st * 0.9) + ((k / 3) | 0) * st * 0.8 + (k % 3) * 260; },
    drift: function (k, st) { return k * st + (Math.sin(k * 2.3) + Math.sin(k * 0.9)) * st * 2.2; }
  };
  /** 動きごとの既定。似合うものを最初から当てる */
  var BY_MOTION = {
    fall: 'wave', rise: 'swing', burst: 'three', grow: 'accel', pop: 'beat',
    twinkle: 'drift', wind: 'wave'
  };

  function one(sp, x, y, k) {
    // 小さい丸だけは、間隔を空ける（集合体に見せない）
    if ((sp.shape === 'dot' || sp.shape === 'star') && sp.r[1] <= 9) {
      if (tooClose(x, y, 48)) return;
      placed.push([x, y]);
    }
    var d = DEPTH[(R() * DEPTH.length) | 0];
    var r = rnd(sp.r[0], sp.r[1]) * d.s;
    var node = SHAPE[sp.shape](x, y, r, pick(sp.col));
    var st = style(sp.motion, x, y, ((sp.o || 0.5) * d.o).toFixed(2));
    /*
      輪郭のぼかし。**ここが温かみの半分。**
      くっきりした丸は図形にしか見えないが、にじませると光や絵の具に見える。
      奥のものほど強くぼかす（近いものは形が残る）。
      style に混ぜるのは、put が style ごと書き換えるため。
    */
    if (sp.blur) st += ';filter:blur(' + (sp.blur * (2 - d.s)).toFixed(1) + 'px)';
    var fn = RHYTHM[sp.beat || BY_MOTION[sp.motion] || 'beat'] || RHYTHM.beat;
    var delay = (sp.at || STAGE2) + fn(k, sp.step || 30);
    put(node, sp.motion, st, delay);
    if (!frozen && node.setAttribute) {
      node.setAttribute('class', (node.getAttribute('class') || '') + ' ' + d.cls);
    }
  }

  // --- 40のテーマ ---------------------------------------------------------
  // 名前 / 層の指定。同じ形でも、動きと色と密度で別の景色になる
  var V = [C.veg], AK = [C.akane, C.meat], GR = [C.grain, C.egg];
  var SEASON = {
    spring: [
      ['桜吹雪', [{ shape: 'petal', motion: 'fall', n: 30, r: [8, 14], col: AK, o: 0.5, step: 34 }]],
      ['菜の花畑', [{ at: STAGE1, shape: 'stalk', motion: 'grow', cols: 5, rows: 10, r: [7, 14], col: V, step: 45 },
                    { shape: 'blossom', motion: 'burst', cols: 6, rows: 11, r: [6, 11], col: [C.egg], avoidText: 1, o: 0.6, step: 18 }]],
      ['芽ぶき', [{ at: STAGE1, shape: 'stalk', motion: 'grow', n: 30, r: [6, 12], col: V, y0: 200, step: 55 },
                  { shape: 'leaf', motion: 'pop', n: 30, r: [5, 9], col: V, y0: 200, at: 2750, step: 55 }]],
      ['つくし', [{ at: STAGE1, shape: 'bud', motion: 'grow', n: 26, r: [9, 16], col: [C.soy, C.meat], y0: 300, step: 60 }]],
      ['春がすみ', [{ shape: 'dot', motion: 'pop', cols: 4, rows: 8, r: [22, 52], col: [C.cream, C.egg], o: 0.26, step: 45 }]],
      ['若葉', [{ shape: 'leaf', motion: 'pop', cols: 6, rows: 12, r: [7, 14], col: V, o: 0.45, step: 28 }]],
      ['すみれ', [{ shape: 'blossom', motion: 'burst', cols: 5, rows: 10, r: [6, 11], col: [C.fish, C.soy], avoidText: 1, o: 0.55, step: 20 }]],
      ['たんぽぽの綿毛', [{ shape: 'dot', motion: 'rise', n: 26, r: [3.5, 7], col: [C.cream, C.soy], o: 0.5, step: 40 }]],
      ['雨あがり', [{ shape: 'ring', motion: 'pop', n: 26, r: [10, 34], col: [C.fish], o: 0.4, step: 45 }]],
      ['春一番', [{ shape: 'petal', motion: 'wind', n: 30, r: [8, 14], col: [C.akane, C.meat, C.cream], o: 0.5, step: 26 },
                  { shape: 'leaf', motion: 'wind', n: 14, r: [9, 15], col: V, o: 0.4, step: 30 }]],
      ['花畑', [{ at: STAGE1, shape: 'stalk', motion: 'grow', cols: 5, rows: 10, r: [7, 13], col: V, step: 45 },
                { shape: 'blossom', motion: 'burst', cols: 6, rows: 12, r: [7, 12], col: [C.akane, C.fish, C.meat, C.grain, C.egg, C.veg, C.soy], avoidText: 1, o: 0.62, step: 18 }]]
    ],
    summer: [
      ['青葉', [{ shape: 'leaf', motion: 'pop', cols: 6, rows: 12, r: [9, 17], col: V, o: 0.42, step: 26 }]],
      ['木漏れ日', [{ shape: 'dot', motion: 'pop', cols: 5, rows: 9, r: [14, 46], col: [C.egg, C.grain, C.cream], o: 0.3, step: 40 }]],
      ['ひまわり', [{ shape: 'blossom', motion: 'burst', cols: 4, rows: 8, r: [11, 20], col: GR, avoidText: 1, o: 0.55, step: 30 }]],
      ['夕立', [{ shape: 'drop', motion: 'fall', n: 32, r: [5, 9], col: [C.fish], o: 0.45, step: 20 }]],
      ['涼風', [{ shape: 'ring', motion: 'rise', n: 24, r: [10, 30], col: [C.fish], o: 0.4, step: 70 }]],
      ['蛍', [{ shape: 'dot', motion: 'twinkle', n: 26, r: [3.5, 7], col: [C.egg, C.grain], o: 0.7, step: 45 }]],
      ['麦の穂', [{ at: STAGE1, shape: 'ear', motion: 'grow', n: 30, r: [10, 18], col: GR, y0: 180, step: 45 }]],
      ['打ち水', [{ shape: 'ring', motion: 'pop', n: 30, r: [8, 30], col: [C.fish, C.cream], o: 0.38, step: 38 }]],
      ['朝顔', [{ shape: 'blossom', motion: 'burst', cols: 5, rows: 10, r: [8, 14], col: [C.fish, C.akane], avoidText: 1, o: 0.55, step: 22 }]],
      ['青嵐', [{ shape: 'leaf', motion: 'wind', n: 28, r: [10, 17], col: V, o: 0.45, step: 26 }]],
      ['入道雲', [{ shape: 'dot', motion: 'pop', n: 22, r: [26, 60], col: [C.cream], o: 0.3, step: 55 }]]
    ],
    autumn: [
      ['落ち葉', [{ shape: 'leaf', motion: 'fall', n: 26, r: [9, 16], col: [C.grain, C.meat, C.akane, C.egg], o: 0.5, step: 40 }]],
      ['実り', [{ shape: 'dot', motion: 'pop', cols: 6, rows: 12, r: [5, 13], col: [C.akane, C.meat, C.grain, C.egg, C.veg], avoidText: 1, o: 0.5, step: 26 }]],
      ['稲穂', [{ at: STAGE1, shape: 'ear', motion: 'grow', n: 32, r: [10, 17], col: GR, y0: 180, step: 42 }]],
      ['きのこ', [{ shape: 'dot', motion: 'pop', n: 34, r: [5, 11], col: [C.meat, C.soy], y0: 300, o: 0.48, step: 34 }]],
      ['月あかり', [{ shape: 'dot', motion: 'pop', n: 16, r: [30, 66], col: [C.egg, C.cream], o: 0.24, step: 60 }]],
      ['すすき', [{ at: STAGE1, shape: 'ear', motion: 'grow', n: 26, r: [12, 20], col: [C.soy, C.grain], y0: 240, step: 50 }]],
      ['木の実', [{ shape: 'dot', motion: 'burst', cols: 5, rows: 10, r: [6, 12], col: [C.meat, C.grain, C.soy], avoidText: 1, o: 0.55, step: 20 }]],
      ['紅葉', [{ shape: 'petal', motion: 'fall', n: 26, r: [9, 15], col: [C.akane, C.meat, C.grain], o: 0.5, step: 32 }]],
      ['秋の空', [{ shape: 'ring', motion: 'rise', n: 20, r: [14, 40], col: [C.fish, C.cream], o: 0.34, step: 80 }]],
      ['木枯らし', [{ shape: 'leaf', motion: 'wind', n: 28, r: [9, 16], col: [C.grain, C.meat, C.akane, C.egg], o: 0.5, step: 24 }]],
      ['収穫', [{ shape: 'blossom', motion: 'burst', cols: 5, rows: 10, r: [7, 14], col: GR, avoidText: 1, o: 0.55, step: 26 }]]
    ],
    winter: [
      ['粉雪', [{ shape: 'dot', motion: 'fall', n: 30, r: [3, 6], col: [C.fish, C.cream], o: 0.42, step: 22 }]],
      ['星あかり', [{ shape: 'star', motion: 'twinkle', n: 30, r: [4, 9], col: [C.grain, C.egg, C.soy], o: 0.7, step: 45 }]],
      ['湯気', [{ at: STAGE1, shape: 'steam', motion: 'rise', n: 22, r: [7, 14], col: [C.soy], y0: 440, o: 0.34, step: 90 }]],
      ['霜の花', [{ shape: 'blossom', motion: 'pop', cols: 5, rows: 10, r: [7, 12], col: [C.fish, C.cream], avoidText: 1, o: 0.42, step: 26 }]],
      ['焚き火', [{ shape: 'dot', motion: 'rise', n: 24, r: [3.5, 7], col: [C.akane, C.grain, C.egg], y0: 460, o: 0.55, step: 42 }]],
      ['冬芽', [{ at: STAGE1, shape: 'bud', motion: 'grow', n: 26, r: [7, 13], col: [C.soy, C.akane], y0: 260, step: 55 }]],
      ['柚子', [{ shape: 'dot', motion: 'pop', cols: 5, rows: 10, r: [7, 15], col: [C.egg, C.grain], avoidText: 1, o: 0.45, step: 30 }]],
      ['綿雪', [{ shape: 'dot', motion: 'fall', n: 34, r: [4, 9], col: [C.cream], o: 0.5, step: 34 }]],
      ['しずかな夜', [{ shape: 'dot', motion: 'twinkle', n: 22, r: [3, 6], col: [C.soy, C.fish], o: 0.55, step: 55 }]],
      ['吹雪', [{ shape: 'dot', motion: 'wind', n: 34, r: [3, 6], col: [C.fish, C.cream], o: 0.45, step: 16 }]],
      ['根菜', [{ shape: 'dot', motion: 'pop', n: 28, r: [8, 18], col: [C.meat, C.grain, C.soy], y0: 320, o: 0.42, step: 34 }]]
    ]
  };

  /*
    いま使うのは幾何のほう。**季節のぶんはしまってある**（SEASON、本人判断）。
    消していないのは、いつでも戻せるようにするため——データなので、
    使う側の1行を差し替えれば入れ替わる。

    幾何にした理由は、有機的な絵が小さく薄いと何なのか分からず、
    密に並べると集合体に見えたこと。円・弧・三角・四角は縮んでも形が保たれる。
    温かみは**色と重なり**で出す（下の GEO と、CSS の mix-blend-mode）。
  */
  var GEO = [
    // 1. 月あかり。大きな丸をぼかして、ゆっくりふくらませる
    ['月あかり', [{ shape: 'disc', motion: 'pop', n: 14, r: [40, 84], blur: 5,
                    col: [C.egg, C.grain, C.cream], o: 0.26, step: 60 }]],
    // 2. かさなり。半透明の丸が重なって、濃いところができる
    ['かさなり', [{ shape: 'disc', motion: 'pop', n: 18, r: [30, 66], blur: 2,
                    col: [C.akane, C.grain, C.fish, C.veg], o: 0.24, step: 50 }]],
    // 3. こもれび。大小の丸。小さいほうを少しだけ濃く
    ['こもれび', [{ at: STAGE1, shape: 'disc', motion: 'pop', n: 10, r: [46, 90], blur: 7,
                    col: [C.egg, C.cream], o: 0.22, step: 70 },
                  { shape: 'disc', motion: 'pop', cols: 4, rows: 8, r: [12, 24], blur: 1,
                    col: [C.grain, C.egg], o: 0.34, step: 34, avoidText: 1 }]],
    // 4. あわ。輪がゆっくり昇る
    ['あわ', [{ shape: 'band', motion: 'rise', n: 20, r: [18, 44], blur: 1,
                col: [C.fish, C.soy], o: 0.4, step: 65 }]],
    // 5. みずたま。同じ大きさの丸が、拍を刻んで並ぶ
    ['みずたま', [{ shape: 'disc', motion: 'pop', cols: 4, rows: 9, r: [16, 22], blur: 1,
                    col: [C.akane, C.veg, C.grain, C.fish], o: 0.34, step: 40, avoidText: 1 }]],
    // 6. 半円。うろこのように、まるい面が並ぶ
    ['半円', [{ shape: 'halfDisc', motion: 'pop', cols: 4, rows: 9, r: [20, 34], blur: 2,
                col: [C.akane, C.egg, C.veg], o: 0.32, step: 34, skip: 0.32, avoidText: 1 }]],
    // 7. まるかく。角の丸い四角。丸ばかりの中に少しだけ直線
    ['まるかく', [{ shape: 'squircle', motion: 'pop', cols: 4, rows: 9, r: [16, 28], blur: 2,
                    col: [C.grain, C.soy, C.meat], o: 0.3, step: 36, skip: 0.34, avoidText: 1 }]],
    // 8. ゆらぎ。丸が中央から散って、居場所へ収まる
    ['ゆらぎ', [{ shape: 'disc', motion: 'burst', cols: 4, rows: 9, r: [14, 30], blur: 2,
                  col: [C.akane, C.fish, C.grain, C.veg], o: 0.32, step: 26, avoidText: 1 }]],
    // 9. しずけさ。大きな丸をひとつずつ、間をあけて
    ['しずけさ', [{ shape: 'disc', motion: 'pop', n: 8, r: [56, 100], blur: 9,
                    col: [C.cream, C.grain, C.soy], o: 0.2, step: 130 }]],
    // 10. ともしび。小さめの丸がまたたく
    ['ともしび', [{ shape: 'disc', motion: 'twinkle', n: 20, r: [10, 22], blur: 2,
                    col: [C.egg, C.grain, C.akane], o: 0.42, step: 70 }]]
  ];

  var m = new Date().getMonth() + 1;
  var key = m <= 2 || m === 12 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
  // いま出すのは幾何のほう。季節（SEASON）はしまってある
  var list = GEO;
  var t = list[(R() * list.length) | 0];

  /*
    確かめ用の抜け道。`?bloom=落ち葉` のように付けると、そのテーマを出す。
    40通りを引き当てるまで開き直すのは現実的でないので、口を残しておく。
    季節をまたいで指定できる（冬に桜を見たいこともある）。
  */
  try {
    var want = new URLSearchParams(location.search).get('bloom');
    if (want) {
      for (var gi = 0; gi < GEO.length; gi++) {
        if (GEO[gi][0] === want) t = GEO[gi];
      }
      for (var sk in SEASON) {
        for (var si = 0; si < SEASON[sk].length; si++) {
          if (SEASON[sk][si][0] === want) { t = SEASON[sk][si]; key = sk; }
        }
      }
    }
  } catch (e) {
    // 指定が読めなくても、抽選したものをそのまま出す
  }

  document.documentElement.setAttribute('data-season', key);
  document.documentElement.setAttribute('data-bloom', t[0]);

  function draw() { for (var i = 0; i < t[1].length; i++) layer(t[1][i]); }

  if (bloom && pref === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    host = bloom; frozen = false; draw();
  }
  /*
    同じ絵を、動かさずうんと薄くして背景に敷く。
    起動の絵が消えたあと何も残らないと、さっきのは何だったのか、という
    置き去りが出る。**透かしは読むものではない**ので、文字の邪魔を
    しない濃さ（CSS 側）まで落とす。
  */
  if (mark && pref !== 'off') { host = mark; frozen = true; placed = []; draw(); }
})();
