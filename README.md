# customer-system · 生产管理系统（本地练习副本）

来也 UiBot RPA 中级认证练习用的「生产管理系统」复刻站点：登录页 + 生产管理后台，
纯静态实现，配一个可选的本地 Python 服务来模拟真站的服务端行为（验证码、登录校验、另存为）。

> 用途是练 RPA 流程，不是给任何人登录真站用的。数据全在浏览器内存里，刷新即还原。

---

## 目录结构

```
customer-system/
├── index.html            登录页（含验证码，canvas 本地绘制 / 服务端出图双模）
├── app.html              生产管理后台外壳
├── assets/
│   ├── style.css         后台样式
│   ├── login.css         登录页样式
│   ├── app.js            后台逻辑（表格、日期选择、导出）
│   ├── data.js           演示数据
│   ├── xlsx.js           纯前端 XLSX/CSV 生成
│   └── logo-uibot.png
├── server.py             本地服务：静态托管 + 4 个仿真接口 + Win32 另存为
├── pack_deploy.py        打包 dist/（白名单拷贝，后端脚本永不进产物）
├── wrangler.toml         Cloudflare Pages 配置
├── test_login.js         登录页回归测试（Node）
├── test_data.js          演示数据一致性测试（订单 ↔ 库存 ↔ 客户）
├── robots.txt
└── dist/                 pack_deploy.py 生成的静态产物
```

---

## 演示数据

固定种子生成，刷新页面不变；全部在内存里，不落盘。

| 视图 | 条数 | 字段 |
|---|---|---|
| 库存 | 40（**不分页，40 条全在一页**） | 货名 / 商品编码 / 数量 / 商品价格 |
| 订单 | **1000**（正好 100 页 × 每页 10 条，倒序） | 订单编码 / 下单日期 / 商品编码 / 客户编码 / 下单数量 |
| 客户 | 40 | 客户名称 / 客户编码 / 移动号码 / 所在行业 / 公司网址 |

关联关系的硬约束（`node test_data.js` 逐条校验）：

- 订单的 `goodsCode` 直接取自库存数组，**1000 单全部能在库存中找到对应商品**，商品编码 40 个互不重复
- 每个商品、每个客户都至少出过一单，不存在「订单里有、库存里没有」的孤儿数据
- 订单里的货名与单价是下单时的库存快照，同编码不会对应两个货名或两个价格
- 每个商品的累计下单量都不超过该商品的库存数量
- 订单编码为 `DD + yyyymmdd + 4 位当日流水`，全表唯一，日期段与下单日期一致
- 1000 条按天均匀铺满 2021 全年 365 天（每天 2~3 单，日间差距不超过 1），100 页每页都是满的 10 行
- 日期统一为 `YYYY-MM-DD`（表格、筛选框、导出文件三处同一写法，不再出现 `2021.12.30` 的点号格式）

页面行为：

- **订单页**：起始/截止时间默认都填当天（`Data.today`，即 2021-12-31，与日期选择器里的「今天」同一天），进入页面先看当天 3 单；点「清空」或改日期再查询即可看全量 1000 条
- **库存页**：不设分页，40 条一次性铺在同一页，底部隐藏翻页控件、只显示「共 40 条 · 全部展示」；「全选」会勾中全部 40 条
- 客户页保持原有的每页 10 条分页

---

## 快速开始

```bash
# 推荐：带接口的完整本地环境
python server.py --open

# 换端口
python server.py --port 8080

# 只要纯静态（没有 /api/*，验证码走 canvas 本地绘制）
python -m http.server 8000
```

依赖：Python 3.9+。验证码出图用 Pillow；没装也能跑（自动降级成内置点阵 PNG）：

```bash
pip install pillow
```

**登录账号**：`UiBot` / `Pass_123`（登录页底部也印着，每项右侧有「复制」按钮一键复制）

> 改密码要同时改三处：`index.html` 里显示的 `<b>` 文本、同文件底部的 `var PASS`、
> `server.py` 的 `ACCOUNTS`。`node test_login.js` 会检查这四处是否一致，改漏了会直接报错。

---

## 接口契约

前端的调用逻辑在 `index.html`（第 366 行附近）和 `assets/app.js`（第 672 行附近），
改接口必须同步改这两处，否则前端会静默降级。

| 方法 | 路径 | 说明 | 返回 |
|---|---|---|---|
| GET | `/api/ping` | 前端用它判断"是不是本机服务" | `{"server":"cs",...}`，只有值等于 `cs` 才切服务端模式 |
| GET | `/api/virtual_account_valid_code` | 验证码图片，同时下发 `cs_sid` 会话 Cookie | `image/png` 80×40 |
| POST | `/api/login` | 登录校验 | `{"ok":true}` / `{"ok":false,"reason":"account"}` / `{"ok":false,"reason":"code"}` |
| POST | `/api/saveas` | 导出时弹 Win32 原生保存对话框 | `{"ok":true,"path":"D:\\..."}` / `{"ok":false,"canceled":true}` / 501 |

几个刻意的实现细节：

- **验证码与会话绑定**：答案存在服务端 session 里，图片本身不含答案，跟真站一致。
- **验证码一次性**：任何一次校验尝试后立即作废，失败必须点图换新的。
- **先判账号再判验证码**：密码错时不消耗验证码（真站也是这个顺序）。
- **大小写不敏感**：`aaaa` 与 `AAAA` 等价。
- **`/api/saveas` 仅在 Windows 可用**，非 Windows 返回 501，前端自动降级到浏览器自带保存框。
- **`/api/ping` 探不到就退回 canvas**：所以部署到 GitHub Pages / Cloudflare Pages 之后，
  验证码是浏览器本地画的，不会因为缺接口而报错。

---

## 验证码规格

按真站（`sim-academy.laiye.com`）实测样本对齐，不是随手画的：

| 项目 | 规格 |
|---|---|
| 尺寸 | 80 × 40，纯白底 |
| 字符数 | 4，大小写字母 + 数字混合（排除 `0O1lI` 等易混字符） |
| 字体 | Arial Bold，23–26px，逐字随机 |
| 颜色 | 每字独立纯色：黑 `#111` / 深蓝 `#00008b` / 暗红 `#8b0000` / 绿 `#006400` / 青 `#006b6b` / 紫 `#4b0082` / 藏蓝 `#1a3f8f` |
| 变形 | 基线 ±2px、倾角 ±5°，字间允许轻微重叠 |
| 噪点 | 110 个单像素浅灰/淡彩点，铺满整幅 |
| 干扰线 | **没有**。真站 4 张样本里一条都没有 |

早前的版本加了 5 条贝塞尔干扰线 + 45 个高透明噪点 + 逐字 ±15° 旋转，
比真站难得多，OCR 基本读不出来 —— 那是识别失败的原因，不是 OCR 模块的问题。

### OCR 建议

这张图的净度足够通用 OCR 直接识别，真站和本站都是。如果要用 UiBot 内置 OCR：

1. 截图放大 3 倍（`80×40` → `240×120`），小字放大后识别率提升最明显
2. 灰度化 → 二值化（阈值 160–180）
3. 白名单字符集设为 `A-Za-z0-9`，能挡掉大部分"把噪点当下划线"的误判

---

## 发布

### GitHub Pages

```bash
python pack_deploy.py
# 把 dist/ 里的内容推到仓库 main 分支根目录
```

线上地址形如 `https://<用户名>.github.io/<仓库名>/`。

注意：`_headers`、`_redirects` 只有 Cloudflare Pages 认，GitHub Pages 会忽略；
`/login`、`/orders`、`/stock` 这几个美化路由在 Pages 上不生效（站内跳转都指向 `.html`，不受影响）。

### Cloudflare Pages

```bash
python pack_deploy.py
npx wrangler pages deploy dist --project-name customer-system
```

`_redirects` 里千万别写 `/app  /app.html  301`：Cloudflare Pages 会先把 `/app.html`
308 成 `/app`，两条规则互相踢，结果是 `ERR_TOO_MANY_REDIRECTS`，
表现为"登录页能开、点登录之后那页打不开"。

---

## 排错

| 现象 | 原因 |
|---|---|
| 登录后白屏 / `ERR_TOO_MANY_REDIRECTS` | `_redirects` 里写了 `/app → /app.html`，删掉 |
| 验证码永远不变 | 服务端模式下点击才换图；纯静态模式检查 canvas 是否被 CSP 拦了 |
| 点导出没弹 Win32 对话框 | 非 Windows，或浏览器不是通过 `http://` 打开的（`file://` 下会跳过接口） |
| 登录一直提示"会话已过期" | 浏览器禁用了 Cookie，`cs_sid` 存不下 |
