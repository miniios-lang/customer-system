/* ==========================================================
   客户与订单管理 · 交互逻辑
   视图：stock 库存 / orders 订单 / customers 客户
   ========================================================== */
(function () {
  'use strict';

  var Data = window.MockData;
  var PAGE = 10;

  function $(id) { return document.getElementById(id); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /* ---------------- 视图定义 ---------------- */
  var VIEWS = {
    stock: {
      title: '库存',
      rows: function () { return Data.goods; },
      cols: [
        { key: 'name',  title: '货名',     width: 300, align: 'left' },
        { key: 'code',  title: '商品编码', width: 260, align: 'left' },
        { key: 'qty',   title: '数量',     width: 220, align: 'right', num: true },
        { key: 'price', title: '商品价格', width: 220, align: 'right', num: true }
      ],
      exportCols: [
        { key: 'name',  title: '货名',     width: 22, num: false },
        { key: 'code',  title: '商品编码', width: 18, num: false },
        { key: 'qty',   title: '数量',     width: 14, num: true },
        { key: 'price', title: '商品价格', width: 14, num: true },
        { key: 'amount', title: '库存金额', width: 16, num: true }
      ],
      value: function (r, k) {
        if (k === 'amount') return r.qty * r.price;
        if (k === 'qty' || k === 'price') return r[k];
        return r[k];
      }
    },
    orders: {
      title: '订单',
      rows: function () { return Data.orders; },
      cols: [
        { key: 'orderNo',   title: '订单编码', width: 260, align: 'left' },
        { key: 'date',      title: '下单日期', width: 240, align: 'center', date: true },
        { key: 'goodsCode', title: '商品码',   width: 240, align: 'left' },
        { key: 'custCode',  title: '客户编码', width: 240, align: 'left' },
        { key: 'qty',       title: '下单数量', width: 220, align: 'right', num: true }
      ],
      exportCols: [
        { key: 'orderNo',   title: '订单编码', width: 20, num: false },
        { key: 'date',      title: '下单日期', width: 16, num: false, date: true },
        { key: 'goodsCode', title: '商品码',   width: 18, num: false },
        { key: 'goodsName', title: '商品名称', width: 18, num: false },
        { key: 'custCode',  title: '客户编码', width: 18, num: false },
        { key: 'custName',  title: '客户名称', width: 30, num: false },
        { key: 'qty',       title: '下单数量', width: 14, num: true },
        { key: 'price',     title: '商品单价', width: 14, num: true },
        { key: 'amount',    title: '金额',     width: 16, num: true }
      ],
      value: function (r, k) {
        if (k === 'amount') return r.qty * r.price;
        return r[k];
      }
    },
    customers: {
      title: '客户',
      rows: function () { return Data.customers; },
      cols: [
        { key: 'name',     title: '客户名称', width: 300, align: 'left' },
        { key: 'code',     title: '客户编码', width: 220, align: 'left' },
        { key: 'mobile',   title: '移动号码', width: 220, align: 'left' },
        { key: 'industry', title: '所在行业', width: 380, align: 'left' },
        { key: 'site',     title: '公司网址', width: 240, align: 'left' }
      ],
      exportCols: [
        { key: 'name',     title: '客户名称', width: 30, num: false },
        { key: 'code',     title: '客户编码', width: 18, num: false },
        { key: 'mobile',   title: '移动号码', width: 18, num: false },
        { key: 'industry', title: '所在行业', width: 40, num: false },
        { key: 'site',     title: '公司网址', width: 26, num: false }
      ],
      value: function (r, k) { return r[k]; }
    }
  };

  var state = {
    view: 'stock',
    page: 1,
    filter: {},
    sort: { key: '', dir: 1 },
    sel: {},
    picker: null
  };

  /* ---------------- 工具 ---------------- */
  function money(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function dotDate(iso) { return iso ? iso.replace(/-/g, '.') : ''; }
  function stamp() {
    var d = new Date();
    return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg, isErr) {
    var el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.innerHTML = '<span class="t-ico">' + (isErr ? '✕' : '✓') + '</span>' + esc(msg);
    $('toastWrap').appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2600);
  }

  /* ---------------- 数据 ---------------- */
  function filteredRows() {
    var v = VIEWS[state.view];
    var rows = v.rows().slice();
    var f = state.filter;

    if (state.view === 'orders') {
      if (f.from) rows = rows.filter(function (r) { return r.date >= f.from; });
      if (f.to) rows = rows.filter(function (r) { return r.date <= f.to; });
    }

    if (state.sort.key) {
      var k = state.sort.key, dir = state.sort.dir;
      rows.sort(function (a, b) {
        var av = a[k], bv = b[k];
        if (av === bv) return 0;
        return (av > bv ? 1 : -1) * dir;
      });
    }
    return rows;
  }

  function pageRows(rows) {
    var start = (state.page - 1) * PAGE;
    return rows.slice(start, start + PAGE);
  }

  function selectedRows() {
    var v = VIEWS[state.view];
    return v.rows().filter(function (r) { return state.sel[state.view + ':' + r.id]; });
  }

  function selCount() {
    var v = VIEWS[state.view], n = 0;
    v.rows().forEach(function (r) { if (state.sel[state.view + ':' + r.id]) n++; });
    return n;
  }

  /* ---------------- 渲染：菜单 ---------------- */
  function renderMenu() {
    var items = $('menu').querySelectorAll('.menu-item');
    Array.prototype.forEach.call(items, function (it) {
      if (it.getAttribute('data-view') === state.view) it.classList.add('is-on');
      else it.classList.remove('is-on');
    });
  }

  /* ---------------- 渲染：筛选条 ---------------- */
  var CAL_ICO =
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
      '<rect x="1.6" y="2.8" width="12.8" height="11.6" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M1.6 6.4h12.8M5.2 1.2v3M10.8 1.2v3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
    '</svg>';

  function dateInputId(key) { return key === 'from' ? 'dpFrom' : 'dpTo'; }

  function renderFilters() {
    var box = $('filters');
    if (state.view !== 'orders') { box.innerHTML = ''; return; }

    box.innerHTML =
      '<span class="f-label">起始时间</span>' +
      '<span class="dp-field">' +
        '<input class="dp-input" id="dpFrom" type="text" placeholder="请选择日期" maxlength="12" autocomplete="off">' +
        '<span class="dp-ico" id="dpFromIco" title="选择日期">' + CAL_ICO + '</span>' +
      '</span>' +
      '<span class="f-sep">至</span>' +
      '<span class="f-label">截止时间</span>' +
      '<span class="dp-field">' +
        '<input class="dp-input" id="dpTo" type="text" placeholder="请选择日期" maxlength="12" autocomplete="off">' +
        '<span class="dp-ico" id="dpToIco" title="选择日期">' + CAL_ICO + '</span>' +
      '</span>' +
      '<button class="btn btn-primary" id="btnQuery">查询</button>';

    ['from', 'to'].forEach(function (k) {
      var id = dateInputId(k);
      var inp = $(id);
      var ico = $(id + 'Ico');

      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (commitDate(k, false)) { state.page = 1; renderTable(); closePicker(); }
        } else if (e.key === 'Escape') {
          closePicker();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          openPicker(id, k);
        }
      });
      inp.addEventListener('input', function () { inp.classList.remove('is-bad'); });
      inp.addEventListener('blur', function () {
        if (commitDate(k, true)) { state.page = 1; renderTable(); }
      });
      ico.addEventListener('click', function (e) {
        e.stopPropagation();
        if (state.picker && state.picker.inputId === id) closePicker();
        else openPicker(id, k);
      });
    });

    $('btnQuery').addEventListener('click', function () {
      commitDate('from', true);
      commitDate('to', true);
      state.page = 1;
      renderTable();
    });
  }

  function paintDateInputs() {
    ['from', 'to'].forEach(function (k) {
      var el = $(dateInputId(k));
      if (!el) return;
      el.value = state.filter[k] ? dotDate(state.filter[k]) : '';
      el.classList.toggle('has-value', !!state.filter[k]);
      el.classList.remove('is-bad');
    });
  }

  /* ---------------- 渲染：表头 ---------------- */
  function renderHead(rows) {
    var v = VIEWS[state.view];
    var cols = v.cols;

    $('colgroup').innerHTML = '<col style="width:48px" />' + cols.map(function (c) {
      return '<col style="width:' + c.width + 'px" />';
    }).join('');

    var pageSel = pageRows(rows);
    var allOn = pageSel.length > 0 && pageSel.every(function (r) {
      return state.sel[state.view + ':' + r.id];
    });

    var html = '<tr>' +
      '<th class="col-check"><input type="checkbox" id="checkAll"' + (allOn ? ' checked' : '') + ' /></th>';

    cols.forEach(function (c) {
      var arrow = '';
      if (state.sort.key === c.key) arrow = state.sort.dir > 0 ? ' ▲' : ' ▼';
      var cls = c.align === 'right' ? 'r' : (c.align === 'center' ? 'c' : '');
      html += '<th class="' + cls + '" data-key="' + c.key + '">' + esc(c.title) + arrow + '</th>';
    });
    html += '</tr>';
    $('thead').innerHTML = html;

    $('checkAll').addEventListener('change', function () {
      var on = this.checked;
      pageRows(rows).forEach(function (r) {
        if (on) state.sel[state.view + ':' + r.id] = true;
        else delete state.sel[state.view + ':' + r.id];
      });
      renderTable();
    });

    Array.prototype.forEach.call($('thead').querySelectorAll('th[data-key]'), function (th) {
      th.style.cursor = 'pointer';
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-key');
        if (state.sort.key === k) state.sort.dir = -state.sort.dir;
        else { state.sort.key = k; state.sort.dir = 1; }
        renderTable();
      });
    });
  }

  /* ---------------- 渲染：表体 ---------------- */
  function renderBody(rows) {
    var v = VIEWS[state.view];
    var cols = v.cols;
    var list = pageRows(rows);
    var tb = $('tbody');

    if (!list.length) {
      tb.innerHTML = '';
      $('empty').style.display = '';
      return;
    }
    $('empty').style.display = 'none';

    tb.innerHTML = list.map(function (r) {
      var checked = !!state.sel[state.view + ':' + r.id];
      var tds = cols.map(function (c) {
        var raw = v.value(r, c.key);
        var text;
        if (c.date) text = dotDate(raw);
        else if (c.num) text = money(raw);
        else text = raw;
        var cls = c.align === 'right' ? 'r' : (c.align === 'center' ? 'c' : 'l');
        return '<td class="' + cls + '" title="' + esc(text) + '">' + esc(text) + '</td>';
      }).join('');
      return '<tr data-id="' + r.id + '"' + (checked ? ' class="is-checked"' : '') + '>' +
        '<td class="col-check"><input type="checkbox" class="row-check" data-id="' + r.id + '"' +
        (checked ? ' checked' : '') + ' /></td>' + tds + '</tr>';
    }).join('');

    Array.prototype.forEach.call(tb.querySelectorAll('.row-check'), function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-id');
        var key = state.view + ':' + id;
        if (cb.checked) state.sel[key] = true;
        else delete state.sel[key];
        var tr = cb.closest('tr');
        if (tr) tr.classList.toggle('is-checked', cb.checked);
        updateExportBtn();
      });
    });
  }

  /* ---------------- 渲染：分页 ---------------- */
  function renderPager(rows) {
    var total = rows.length;
    var pages = Math.max(1, Math.ceil(total / PAGE));
    if (state.page > pages) state.page = pages;

    $('pager').innerHTML =
      '<span class="pg-link' + (state.page <= 1 ? ' disabled' : '') + '" data-go="prev">上一页</span>' +
      '<span class="pg-num">' + state.page + '</span>' +
      '<span class="pg-total">/ ' + pages + '</span>' +
      '<span class="pg-link' + (state.page >= pages ? ' disabled' : '') + '" data-go="next">下一页</span>';

    $('pageInfo').textContent = '共 ' + total + ' 条 · 每页 ' + PAGE + ' 条';

    Array.prototype.forEach.call($('pager').querySelectorAll('.pg-link'), function (el) {
      el.addEventListener('click', function () {
        if (el.classList.contains('disabled')) return;
        state.page += el.getAttribute('data-go') === 'next' ? 1 : -1;
        renderTable();
      });
    });
  }

  function updateExportBtn() {
    var btn = $('btnExportSel');
    var caret = $('btnExportMenu');
    var n = selCount();
    btn.textContent = n > 0 ? '导出选中项 (' + n + ')' : '导出选中项';
    btn.disabled = n === 0;
    if (caret) caret.disabled = n === 0;
  }

  function renderTable() {
    var rows = filteredRows();
    renderHead(rows);
    renderBody(rows);
    renderPager(rows);
    $('statusText').textContent = '加载完成';
    updateExportBtn();
  }

  function switchView(view) {
    state.view = view;
    state.page = 1;
    state.sort = { key: '', dir: 1 };
    state.filter = {};
    renderMenu();
    renderFilters();
    paintDateInputs();
    renderTable();
  }

  /* ---------------- 日期选择器 ---------------- */
  function closePicker() {
    var pop = $('dpPop');
    pop.style.display = 'none';
    var on = document.querySelector('.dp-input.is-open');
    if (on) on.classList.remove('is-open');
    state.picker = null;
  }

  function parseISO(iso) {
    var p = iso.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  /* 手输日期：2021-09-01 / 2021.9.1 / 2021/9/1 / 20210901 / 2021年9月1日 都认；
     只给到年月时，起始取当月 1 号、截止取当月最后一天。 */
  var DATE_RE = /^(\d{4})-?(\d{1,2})?-?(\d{1,2})?$/;

  function parseDateText(raw, key) {
    var s = String(raw == null ? '' : raw)
      .replace(/[年月]/g, '-')
      .replace(/日/g, '')
      .replace(/[\/.]/g, '-')
      .replace(/\s+/g, '')
      .replace(/-+$/, '');
    var m = DATE_RE.exec(s);
    if (!m) return null;
    var y = Number(m[1]);
    var mo = m[2] == null ? 1 : Number(m[2]);
    if (y < 1900 || y > 2999) return null;
    if (mo < 1 || mo > 12) return null;
    var last = new Date(y, mo, 0).getDate();
    var d = m[3] == null ? (key === 'to' ? last : 1) : Number(m[3]);
    if (d < 1 || d > last) return null;
    return y + '-' + pad2(mo) + '-' + pad2(d);
  }

  function commitDate(key, silent) {
    var el = $(dateInputId(key));
    if (!el) return true;
    var raw = String(el.value == null ? '' : el.value).trim();
    if (!raw) {
      state.filter[key] = '';
      paintDateInputs();
      return true;
    }
    var iso = parseDateText(raw, key);
    if (!iso) {
      el.classList.add('is-bad');
      if (!silent) toast('日期写法：2021-09-01 / 2021.9.1 / 20210901 / 2021年9月1日');
      return false;
    }
    var other = key === 'from' ? state.filter.to : state.filter.from;
    if (other && (key === 'from' ? iso > other : iso < other)) {
      toast(key === 'from' ? '起始时间晚于截止时间了' : '截止时间早于起始时间了');
    }
    state.filter[key] = iso;
    paintDateInputs();
    return true;
  }

  var WEEK = ['一', '二', '三', '四', '五', '六', '日'];

  function openPicker(inputId, key) {
    var anchor = $(inputId);
    var pop = $('dpPop');
    var base = state.filter[key] ? parseISO(state.filter[key]) : new Date(2021, 0, 1);

    closePicker();
    state.picker = {
      inputId: inputId, key: key,
      y: base.getFullYear(), m: base.getMonth(),
      py: Math.floor(base.getFullYear() / 12) * 12,
      mode: 'day'
    };

    function head(inner) {
      return '<div class="dp-head">' +
        '<span class="dp-nav" data-nav="-1">‹</span>' +
        '<span class="dp-title">' + inner + '</span>' +
        '<span class="dp-nav" data-nav="1">›</span>' +
      '</div>';
    }

    function bindNav(p, unit) {
      pop.querySelectorAll('.dp-nav').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          var step = Number(el.getAttribute('data-nav'));
          if (unit === 'month') {
            var m = p.m + step, y = p.y;
            if (m < 0) { m = 11; y--; }
            if (m > 11) { m = 0; y++; }
            p.m = m; p.y = y;
          } else if (unit === 'year') {
            p.y += step;
          } else {
            p.py += step * 12;
          }
          draw();
        });
      });
    }

    function pick(iso) {
      state.filter[key] = iso;
      paintDateInputs();
      state.page = 1;
      renderTable();
      closePicker();
    }

    function drawDay(p) {
      var first = new Date(p.y, p.m, 1);
      var startIdx = (first.getDay() + 6) % 7;
      var days = new Date(p.y, p.m + 1, 0).getDate();
      var cur = state.filter[p.key] || '';
      var cells = [];

      Array.apply(null, Array(startIdx)).forEach(function () {
        cells.push('<span class="dp-cell dp-empty"></span>');
      });
      for (var d = 1; d <= days; d++) {
        var iso = p.y + '-' + pad2(p.m + 1) + '-' + pad2(d);
        var cls = 'dp-cell' + (iso === cur ? ' is-sel' : '') + (iso === Data.today ? ' is-today' : '');
        cells.push('<span class="' + cls + '" data-d="' + iso + '">' + d + '</span>');
      }

      pop.innerHTML = head(
          '<b class="dp-unit" data-unit="y">' + p.y + '年</b>' +
          '<b class="dp-unit" data-unit="m">' + (p.m + 1) + '月</b>'
        ) +
        '<div class="dp-week">' + WEEK.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>' +
        '<div class="dp-grid">' + cells.join('') + '</div>' +
        '<div class="dp-foot"><span class="dp-today">今天</span><span class="dp-clear">清空</span></div>';

      bindNav(p, 'month');

      pop.querySelectorAll('.dp-unit').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          if (el.getAttribute('data-unit') === 'y') {
            p.py = Math.floor(p.y / 12) * 12;
            p.mode = 'year';
          } else {
            p.mode = 'month';
          }
          draw();
        });
      });

      pop.querySelectorAll('.dp-cell[data-d]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          pick(el.getAttribute('data-d'));
        });
      });

      pop.querySelector('.dp-today').addEventListener('click', function (e) {
        e.stopPropagation();
        pick(Data.today);
      });

      pop.querySelector('.dp-clear').addEventListener('click', function (e) {
        e.stopPropagation();
        state.filter[key] = '';
        paintDateInputs();
        state.page = 1;
        renderTable();
        closePicker();
      });
    }

    function drawMonth(p) {
      var cur = state.filter[p.key] || '';
      var sameYear = cur.slice(0, 4) === String(p.y);
      var curM = sameYear ? Number(cur.slice(5, 7)) - 1 : -1;
      var cells = [];

      for (var i = 0; i < 12; i++) {
        cells.push('<span class="dp-m-cell' + (i === curM ? ' is-sel' : '') + '" data-m="' + i + '">' + (i + 1) + '月</span>');
      }

      pop.innerHTML = head('<b class="dp-unit" data-unit="y">' + p.y + '年</b>') +
        '<div class="dp-months">' + cells.join('') + '</div>';

      bindNav(p, 'year');

      pop.querySelector('.dp-unit').addEventListener('click', function (e) {
        e.stopPropagation();
        p.py = Math.floor(p.y / 12) * 12;
        p.mode = 'year';
        draw();
      });

      pop.querySelectorAll('.dp-m-cell[data-m]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          p.m = Number(el.getAttribute('data-m'));
          p.mode = 'day';
          draw();
        });
      });
    }

    function drawYear(p) {
      var cells = [];
      for (var i = 0; i < 12; i++) {
        var y = p.py + i;
        cells.push('<span class="dp-y-cell' + (y === p.y ? ' is-sel' : '') + '" data-y="' + y + '">' + y + '</span>');
      }

      pop.innerHTML = head('<b>' + p.py + ' - ' + (p.py + 11) + '</b>') +
        '<div class="dp-years">' + cells.join('') + '</div>';

      bindNav(p, 'page');

      pop.querySelectorAll('.dp-y-cell[data-y]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          p.y = Number(el.getAttribute('data-y'));
          p.mode = 'month';
          draw();
        });
      });
    }

    function draw() {
      var p = state.picker;
      if (p.mode === 'year') drawYear(p);
      else if (p.mode === 'month') drawMonth(p);
      else drawDay(p);
    }

    draw();
    anchor.classList.add('is-open');

    var r = anchor.getBoundingClientRect();
    var pw = pop.offsetWidth || 268;
    var ph = pop.offsetHeight || 320;
    var top = r.bottom + window.scrollY + 6;
    var left = r.left + window.scrollX;

    pop.style.display = 'block';
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (r.bottom + ph + 8 > window.innerHeight) top = Math.max(8 + window.scrollY, r.top + window.scrollY - ph - 6);
    pop.style.top = top + 'px';
    pop.style.left = Math.max(8, left) + 'px';
  }

  document.addEventListener('click', function (e) {
    if (!state.picker) return;
    if (e.target.closest && (e.target.closest('#dpPop') || e.target.closest('.dp-input'))) return;
    closePicker();
  });

  /* ---------------- 导出：真实「另存为」 ----------------
     三条路，从最贴近真站的那条往下退：
       1) POST api/saveas —— 本机 python 服务弹 Win32 公共对话框
          （comdlg32!GetSaveFileNameW），就是截图里带面包屑/左侧导航的那个窗口，
          选完路径由服务端落盘，前端拿回真实路径
       2) File System Access API —— 浏览器自己的系统保存框（Chromium + 安全上下文）
       3) <a download> —— 浏览器默认保存（前两条都走不通时兜底）
     ---------------------------------------------------- */
  var MIME = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv;charset=utf-8;'
  };

  function toBase64(bytes) {
    var chunk = 0x8000, out = '';
    for (var i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  function anchorDownload(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* 1) 服务端 Win32 对话框：{ok,path} / {ok:false,canceled} / null（这条路走不通） */
  var saveAsApi = true;   /* 静态托管上第一次 404 之后就不再发这个请求 */
  function saveViaServer(bytes, fileName, ext) {
    if (!saveAsApi || !/^https?:$/.test(location.protocol)) return Promise.resolve(null);
    return fetch('api/saveas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fileName, ext: ext, data: toBase64(bytes) })
    }).then(function (r) {
      if (r.status === 404 || r.status === 501) { saveAsApi = false; return null; }
      return r.json().catch(function () { return null; });
    }).catch(function () { return null; });
  }

  /* 2) 浏览器自带的系统保存框 */
  function saveViaPicker(blob, fileName, ext) {
    if (!window.showSaveFilePicker) return Promise.resolve(null);
    var types = ext === 'csv'
      ? [{ description: 'CSV 文本', accept: { 'text/csv': ['.csv'] } }]
      : [{
          description: 'XLSX 工作表',
          accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
        }];
    return window.showSaveFilePicker({ suggestedName: fileName, types: types })
      .then(function (handle) {
        return handle.createWritable().then(function (w) {
          return w.write(blob).then(function () {
            return w.close();
          }).then(function () { return { ok: true, path: handle.name }; });
        });
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError') return { ok: false, canceled: true };
        return null;
      });
  }

  function specBytes(spec) {
    if (spec.type === 'csv') {
      return new TextEncoder().encode(window.XLSXW.toCSV(spec.cols, spec.data));
    }
    return window.XLSXW.build({
      sheets: [{ name: spec.sheetName, columns: spec.cols, rows: spec.data }]
    });
  }

  function markBusy(on) {
    var btn = $('btnExportSel');
    btn.classList.toggle('is-busy', !!on);
    if (on) {
      btn.disabled = true;
      btn.textContent = '保存中…';
    } else {
      updateExportBtn();
    }
  }

  function toggleExportMenu(open) {
    var m = $('expMenu');
    if (!m) return;
    m.hidden = !open;
    $('btnExportMenu').setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function buildSpec(name, type) {
    var v = VIEWS[state.view];
    var rows = selectedRows();
    var cols = v.exportCols;
    var data = rows.map(function (r) {
      return cols.map(function (c) {
        var val = v.value(r, c.key);
        return c.date ? dotDate(val) : val;
      });
    });
    var sheetName = v.title;
    return { name: name, type: type, cols: cols, data: data, sheetName: sheetName, count: rows.length };
  }

  function exportSelected(ext) {
    if (selCount() === 0) { toast('请先勾选要导出的数据', true); return; }

    var spec = buildSpec('订单商品_' + stamp(), ext);
    var bytes = specBytes(spec);
    var fileName = spec.name.replace(/\.(xlsx|csv)$/i, '') + '.' + ext;

    markBusy(true);
    $('statusText').textContent = '等待另存为…';

    saveViaServer(bytes, fileName, ext)
      .then(function (res) {
        if (res && (res.ok || res.canceled)) return res;
        return saveViaPicker(new Blob([bytes], { type: MIME[ext] }), fileName, ext);
      })
      .then(function (res) {
        if (res && res.canceled) {
          markBusy(false);
          $('statusText').textContent = '已取消保存';
          toast('已取消保存');
          return;
        }
        if (res && res.ok) {
          markBusy(false);
          $('statusText').textContent = '已导出 ' + spec.count + ' 条';
          toast('已保存 ' + spec.count + ' 条 → ' + (res.path || fileName));
          return;
        }
        anchorDownload(new Blob([bytes], { type: MIME[ext] }), fileName);
        markBusy(false);
        $('statusText').textContent = '已导出 ' + spec.count + ' 条';
        toast('已交浏览器保存：' + fileName);
      })
      .catch(function (e) {
        markBusy(false);
        $('statusText').textContent = '导出失败';
        toast('导出失败：' + (e && e.message ? e.message : e), true);
      });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    var qs = new URLSearchParams(location.search);
    var user = sessionStorage.getItem('cs_user') || qs.get('account') || '';
    if (!user) { location.replace('index.html'); return; }
    $('account').textContent = user;

    /* 支持 /orders、/stock、/customers 这类短链（Pages 的 _redirects 会把它们带到 ?view=xxx） */
    var firstView = qs.get('view');
    if (['stock', 'orders', 'customers'].indexOf(firstView) < 0) firstView = 'stock';

    Array.prototype.forEach.call($('menu').querySelectorAll('.menu-item'), function (it) {
      it.addEventListener('click', function () { switchView(it.getAttribute('data-view')); });
    });

    $('btnExportSel').addEventListener('click', function () { exportSelected('xlsx'); });
    $('btnExportMenu').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleExportMenu($('expMenu').hidden);
    });
    Array.prototype.forEach.call($('expMenu').querySelectorAll('.exp-item'), function (it) {
      it.addEventListener('click', function () {
        toggleExportMenu(false);
        exportSelected(it.getAttribute('data-ext'));
      });
    });
    document.addEventListener('click', function (e) {
      if ($('expMenu') && !$('expMenu').hidden &&
          !(e.target.closest && e.target.closest('#expGroup'))) {
        toggleExportMenu(false);
      }
    });
    $('btnLogout').addEventListener('click', function () {
      sessionStorage.removeItem('cs_user');
      location.href = 'index.html';
    });

    switchView(firstView);

    /* 调试/RPA 用的只读入口：切换视图、看当前行、生成导出规格 */
    window.__CSApp = {
      switch: switchView,
      render: renderTable,
      state: state,
      rows: filteredRows,
      exportSpec: buildSpec,
      parseDate: parseDateText,
      commitDate: commitDate,
      openPicker: openPicker,
      paintDates: paintDateInputs
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
