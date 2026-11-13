/* 演示数据回归测试：node test_data.js
   校验订单与库存、客户的关联关系，以及表头文案。 */
'use strict';

const fs = require('fs');
const path = require('path');

global.window = {};
require('./assets/data.js');
const D = global.window.MockData;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('[OK] ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('[!!] ' + name + (extra ? '  ' + extra : '')); }
}

const goods = D.goods, orders = D.orders, customers = D.customers;
const goodsByCode = new Map(goods.map(g => [g.code, g]));
const custCodes = new Set(customers.map(c => c.code));

/* 1. 数据量 */
ok('订单条数 = 1000（正好 100 页）', orders.length === 1000, '实际 ' + orders.length + ' 条');
ok('1000 % 10 = 0，末页不含空行', orders.length % 10 === 0,
   '共 ' + (orders.length / 10) + ' 页，每页 10 条');
ok('商品条数 = 40', goods.length === 40, '实际 ' + goods.length + ' 个');

/* 2. 商品编码唯一且格式统一 */
const codes = goods.map(g => g.code);
ok('商品编码无重复', new Set(codes).size === codes.length,
   '唯一 ' + new Set(codes).size + '/' + codes.length);
ok('商品编码格式均为 SP+6 位数字', codes.every(c => /^SP\d{6}$/.test(c)),
   '示例 ' + codes.slice(0, 3).join(' '));

/* 3. 订单引用完整性：每一单的商品编码都能在库存里找到 */
const missGoods = orders.filter(o => !goodsByCode.has(o.goodsCode));
ok('订单商品编码全部存在于库存', missGoods.length === 0,
   missGoods.length ? '失配 ' + missGoods.length + ' 单，如 ' + missGoods[0].goodsCode
                    : orders.length + '/' + orders.length + ' 命中');

const missCust = orders.filter(o => !custCodes.has(o.custCode));
ok('订单客户编码全部存在于客户表', missCust.length === 0,
   missCust.length ? '失配 ' + missCust.length + ' 单' : '全部命中');

/* 4. 反向覆盖：每个商品、每个客户都出过单 */
const usedGoods = new Set(orders.map(o => o.goodsCode));
const usedCust = new Set(orders.map(o => o.custCode));
ok('每个商品都有订单', usedGoods.size === goods.length,
   '覆盖 ' + usedGoods.size + '/' + goods.length);
ok('每个客户都有订单', usedCust.size === customers.length,
   '覆盖 ' + usedCust.size + '/' + customers.length);

/* 5. 商品名称、单价与库存快照一致（同一编码不能对应两个货名/价格） */
const snapBad = orders.filter(o => {
  const g = goodsByCode.get(o.goodsCode);
  return g && (g.name !== o.goodsName || g.price !== o.price);
});
ok('订单中的货名与单价与库存一致', snapBad.length === 0,
   snapBad.length ? '不一致 ' + snapBad.length + ' 单' : '逐条比对通过');

/* 6. 累计下单数量不超过库存数量 */
const sumQty = {};
orders.forEach(o => { sumQty[o.goodsCode] = (sumQty[o.goodsCode] || 0) + o.qty; });
const over = goods.filter(g => (sumQty[g.code] || 0) > g.qty);
ok('各商品累计下单量不超过库存量', over.length === 0,
   over.length ? over.map(g => g.code).join(',') : '无超卖');

/* 7. 订单编码唯一，且前缀日期与下单日期一致 */
ok('订单编码无重复', new Set(orders.map(o => o.orderNo)).size === orders.length);
ok('订单编码日期段与下单日期一致',
   orders.every(o => o.orderNo.slice(2, 10) === o.date.replace(/-/g, '')));

/* 8. 日期落在 2021 年内且倒序排列 */
ok('下单日期均在 2021 年内',
   orders.every(o => o.date >= '2021-01-01' && o.date <= '2021-12-31'));
ok('订单按日期倒序排列',
   orders.every((o, i) => i === 0 || orders[i - 1].date >= o.date));

/* 8.1 日期分隔符统一为 "-" */
const isoBad = orders.filter(o => !/^\d{4}-\d{2}-\d{2}$/.test(o.date));
ok('下单日期统一为 YYYY-MM-DD', isoBad.length === 0,
   isoBad.length ? '异常 ' + isoBad.length + ' 条，如 ' + isoBad[0].date
                 : orders.length + '/' + orders.length + ' 合规');

/* 8.2 按天均匀铺满全年 */
const byDay = {};
orders.forEach(o => { byDay[o.date] = (byDay[o.date] || 0) + 1; });
const dayCounts = Object.values(byDay);
ok('订单覆盖全年 365 天', dayCounts.length === 365, '覆盖 ' + dayCounts.length + ' 天');
ok('每日单量差距不超过 1（分布均匀）',
   Math.max(...dayCounts) - Math.min(...dayCounts) <= 1,
   Math.min(...dayCounts) + ' ~ ' + Math.max(...dayCounts) + ' 单/天');

/* 9. 表头文案 */
const appJs = fs.readFileSync(path.join(__dirname, 'assets/app.js'), 'utf8');
ok('订单表头已改为「商品编码」', /goodsCode', title: '商品编码'/.test(appJs));
ok('已无「商品码」旧文案', appJs.indexOf("'商品码'") < 0);
ok('页面不再把日期转成点号', appJs.indexOf("replace(/-/g, '.')") < 0);
ok('表格/导出统一走 dateText', appJs.indexOf('dateText') > 0);

/* 10. 数据多样性 */
const months = new Set(orders.map(o => o.date.slice(5, 7)));
const qtys = orders.map(o => o.qty);
ok('订单覆盖 12 个月份', months.size === 12, '覆盖 ' + months.size + ' 个月');
ok('下单数量有梯度', Math.min(...qtys) <= 5 && Math.max(...qtys) >= 40,
   Math.min(...qtys) + ' ~ ' + Math.max(...qtys));

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('商品 ' + goods.length + ' 个｜客户 ' + customers.length +
            ' 个｜订单 ' + orders.length + ' 条');
process.exit(fail ? 1 : 0);
