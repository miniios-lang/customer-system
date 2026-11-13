/* 演示数据（固定种子，每次刷新一致）
   结构对齐参考图：
   库存 = 货名 / 商品编码 / 数量 / 商品价格
   订单 = 订单编码 / 下单日期(2021.MM.DD) / 商品编码 / 客户编码 / 下单数量
   客户 = 客户名称 / 客户编码 / 移动号码 / 所在行业 / 公司网址

   订单里的 goodsCode / custCode 全部直接取自 goods / customers 数组，
   不做二次拼装，因此订单与库存、客户的关联关系天然成立。            */
(function (global) {
  'use strict';

  var seed = 20261111;
  function rnd() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  }
  function int(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
  function pick(arr) { return arr[int(0, arr.length - 1)]; }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function pad4(n) { return ('000' + n).slice(-4); }

  var UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  var LOWER = 'abcdefghijkmnpqrstuvwxyz';
  var DIGIT = '0123456789';
  var MIXED = UPPER + LOWER + DIGIT;

  function token(n, pool) {
    var s = '';
    for (var i = 0; i < n; i++) s += pool.charAt(int(0, pool.length - 1));
    return s;
  }

  /* ---------- 客户 ---------- */
  var INDUSTRY = ['互联网', '金融', '房地产', '制造业', '医疗', '休闲娱乐', '教育', '物流'];
  var customers = [];
  for (var ci = 0; ci < 40; ci++) {
    var tags = [];
    var tagCount = int(2, 4);
    for (var t = 0; t < tagCount; t++) {
      var tag = pick(INDUSTRY);
      if (tags.indexOf(tag) < 0) tags.push(tag);
    }
    customers.push({
      id: ci + 1,
      name: token(4, UPPER) + token(4, MIXED) + ' 公司',
      code: 'KH' + (200000 + ci * 10000 + int(0, 9999)),
      mobile: '1' + int(3, 9) + token(9, DIGIT),
      industry: tags.join('·'),
      site: 'www.' + token(6, LOWER) + '.com'
    });
  }

  /* ---------- 库存（商品） ---------- */
  /* 40 个商品，编码取 10 万号段且每个商品独占 1 万区间，
     保证 40 个商品编码互不重复，订单才有一一对应的基础。 */
  var goods = [];
  for (var gi = 0; gi < 40; gi++) {
    goods.push({
      id: gi + 1,
      name: '商品' + (20000 + gi * 137 + int(0, 99)),
      code: 'SP' + (200000 + gi * 10000 + int(0, 9999)),
      qty: int(3000, 5000),
      price: int(100, 999)
    });
  }

  /* ---------- 订单 ---------- */
  var ORDER_TOTAL = 480;
  var MONTH_WEIGHT = [6, 5, 8, 7, 7, 8, 6, 7, 9, 10, 15, 12];  /* 年末旺季单量更高 */

  var usedQty = {};       /* 每个商品已被下单的数量，用于不超过库存 */
  var seqByDate = {};     /* 同一天内的流水号，保证订单编码不重复 */
  var orders = [];
  goods.forEach(function (g) { usedQty[g.code] = 0; });

  /* 主推款：前 8 个商品被下单的概率明显更高，数据才不像均匀随机 */
  function pickGoods() {
    return rnd() < 0.45 ? goods[int(0, 7)] : goods[int(0, goods.length - 1)];
  }

  /* 挑一个还有库存余量的商品；余量不足时换下一个 */
  function takeGoods(fixed) {
    var g = fixed || pickGoods();
    for (var n = 0; n < 60 && g.qty - usedQty[g.code] < 1; n++) g = pickGoods();
    return g;
  }

  function pickMonth() {
    var total = 0, i;
    for (i = 0; i < 12; i++) total += MONTH_WEIGHT[i];
    var x = rnd() * total;
    for (i = 0; i < 12; i++) {
      x -= MONTH_WEIGHT[i];
      if (x <= 0) return i + 1;
    }
    return 12;
  }

  function pickQty() {
    var r = rnd();
    if (r < 0.55) return int(1, 10);
    if (r < 0.88) return int(11, 30);
    return int(31, 80);
  }

  for (var oi = 0; oi < ORDER_TOTAL; oi++) {
    /* 前 40 单按顺序铺满商品与客户，保证每个商品、每个客户都至少出现在订单里 */
    var fixedGoods = oi < goods.length ? goods[oi] : null;
    var g = takeGoods(fixedGoods);
    var c = oi < customers.length ? customers[oi] : pick(customers);

    var month = pickMonth();
    var maxDay = new Date(2021, month, 0).getDate();
    var day = int(1, month === 12 ? 30 : maxDay);
    var iso = '2021-' + pad2(month) + '-' + pad2(day);
    var dk = iso.replace(/-/g, '');

    seqByDate[dk] = (seqByDate[dk] || 0) + 1;

    var room = g.qty - usedQty[g.code];
    var qty = Math.min(pickQty(), room);
    usedQty[g.code] += qty;

    orders.push({
      id: oi + 1,
      orderNo: 'DD' + dk + pad4(seqByDate[dk]),
      date: iso,
      goodsCode: g.code,
      goodsName: g.name,
      custCode: c.code,
      custName: c.name,
      qty: qty,
      price: g.price
    });
  }

  orders.forEach(function (o) { o.amount = o.qty * o.price; });

  /* 2021 全年，日期倒序更接近真实业务流；同一天的按订单编码倒序，顺序稳定 */
  orders.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.orderNo < b.orderNo ? 1 : (a.orderNo > b.orderNo ? -1 : 0);
  });

  global.MockData = {
    customers: customers,
    goods: goods,
    orders: orders,
    today: '2021-12-31'
  };
})(window);
