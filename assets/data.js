/* 演示数据（固定种子，每次刷新一致）
   结构对齐参考图：
   库存 = 货名 / 商品编码 / 数量 / 商品价格
   订单 = 订单编码 / 下单日期(2021.MM.DD) / 商品码 / 客户编码 / 下单数量
   客户 = 客户名称 / 客户编码 / 移动号码 / 所在行业 / 公司网址                     */
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
      code: 'KH' + token(6, DIGIT),
      mobile: '1' + int(3, 9) + token(9, DIGIT),
      industry: tags.join('·'),
      site: 'www.' + token(6, LOWER) + '.com'
    });
  }

  /* ---------- 库存（商品） ---------- */
  var goods = [];
  for (var gi = 0; gi < 40; gi++) {
    goods.push({
      id: gi + 1,
      name: '商品' + int(10000, 99999),
      code: 'SP' + token(6, DIGIT),
      qty: int(3000, 5000),
      price: int(100, 999)
    });
  }

  /* ---------- 订单 ---------- */
  var orders = [];
  for (var oi = 0; oi < 63; oi++) {
    var g = pick(goods);
    var c = pick(customers);
    var month = int(1, 12);
    var day = int(1, 28);
    orders.push({
      id: oi + 1,
      orderNo: 'DD' + token(6, MIXED),
      date: '2021-' + pad2(month) + '-' + pad2(day),
      goodsCode: g.code,
      goodsName: g.name,
      custCode: c.code,
      custName: c.name,
      qty: int(3000, 5000),
      price: g.price
    });
  }
  orders.forEach(function (o) { o.amount = o.qty * o.price; });

  /* 2021 全年，日期倒序更接近真实业务流 */
  orders.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });

  global.MockData = {
    customers: customers,
    goods: goods,
    orders: orders,
    today: '2021-12-31'
  };
})(window);
