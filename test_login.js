#!/usr/bin/env node
/**
 * 登录页回归测试（canvas 模式，纯静态托管的真实路径）
 *
 *   node test_login.js
 *
 * 用最小 DOM 桩在 Node 里跑 index.html 的登录脚本，断言：
 *   1. 按显示的验证码原样输入 → 登录成功
 *   2. 全大写输入（大小写不敏感）→ 登录成功
 *   3. 全小写输入 → 登录成功
 *   4. 验证码填错 → 提示「验证码有误」
 *   5. 密码填错 → 提示「用户名或密码不正确」
 *
 * 之前漏掉第 2/3 条，导致字符池加入小写后，只要验证码含小写字母，正确答案也会被判错。
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HTML = path.join(__dirname, 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error('未找到内联脚本');
  process.exit(1);
}
const SCRIPT = m[1];

/* 从真实文件里取凭据，避免测试自己写死一份（改了密码也不用改测试） */
const pick = (re, src) => (src.match(re) || [])[1];
const PASS_VALUE = pick(/var PASS = '([^']*)'/, SCRIPT);
const USER_VALUE = pick(/var USER = '([^']*)'/, SCRIPT);
const SHOWN_PWD = pick(/密码：<\/span><b>([^<]+)<\/b>/, html);
const SHOWN_USER = pick(/用户名：<\/span><b>([^<]+)<\/b>/, html);
const COPY_VALUES = [...html.matchAll(/data-copy="([^"]+)"/g)].map((x) => x[1]);

/* ---------------- DOM 桩 ---------------- */
function makeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    toggle: (c, on) => (on === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : (on ? set.add(c) : set.delete(c))),
    contains: (c) => set.has(c),
    _set: set,
  };
}

function makeEl(id) {
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    type: id === 'password' ? 'password' : 'text',
    disabled: false,
    style: {},
    classList: makeClassList(),
    _handlers: {},
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    removeAttribute() {},
    setAttribute() {},
    focus() {},
    getBoundingClientRect() { return { width: 80, height: 40 }; },
  };
}

function makeCtx() {
  const drawn = [];
  const ctx = {
    canvas: null,
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    textAlign: '', textBaseline: '',
    _pos: [0, 0], _rot: 0, _stack: [],
    drawn,
    setTransform() {}, clearRect() {}, save() {}, restore() {},
    beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {},
    bezierCurveTo() {},
    translate(x, y) { ctx._pos = [x, y]; },
    rotate(a) { ctx._rot = a; },
    fillRect() {},
    fillText(ch) { drawn.push(ch); },
    getImageData() { return { data: [0, 0, 0, 255] }; },
  };
  return ctx;
}

function buildPage() {
  const ctx = makeCtx();
  const canvas = makeEl('captchaCanvas');
  canvas.getContext = () => ctx;
  canvas.width = 0;
  canvas.height = 0;

  const ids = {
    captchaBox: makeEl('captchaBox'),
    captchaImg: makeEl('captchaImg'),
    captchaCanvas: canvas,
    captchaPh: makeEl('captchaPh'),
    loginForm: makeEl('loginForm'),
    eyeToggle: makeEl('eyeToggle'),
    username: makeEl('username'),
    password: makeEl('password'),
    captcha: makeEl('captcha'),
    btnLogin: makeEl('btnLogin'),
  };
  // 每个表单项的错误提示文本节点
  const errText = { fUser: makeEl('fUser-err'), fPwd: makeEl('fPwd-err'), fCode: makeEl('fCode-err') };
  const formItems = { fUser: makeEl('fUser'), fPwd: makeEl('fPwd'), fCode: makeEl('fCode') };

  const location = { protocol: 'file:', href: 'file:///index.html' };

  // 复制按钮：从真实标记里解析 data-copy，顺带验证按钮确实是 type="button"
  const copyValues = [...html.matchAll(/data-copy="([^"]+)"/g)].map((mm) => mm[1]);
  const copyBtns = copyValues.map((v, i) => {
    const b = makeEl('cred-copy-' + i);
    b.textContent = '复制';
    b._attrs = { 'data-copy': v };
    b.getAttribute = (k) => (k in b._attrs ? b._attrs[k] : null);
    return b;
  });
  const clipboard = {
    writes: [],
    writeText(t) { this.writes.push(t); return Promise.resolve(); },
  };

  const sandbox = {
    console, Math, Date, JSON, Array, Object, String, Number, Error, Promise, RegExp,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() {},
    window: { devicePixelRatio: 1, isSecureContext: true },
    location,
    navigator: { clipboard },
    sessionStorage: { _d: {}, setItem(k, v) { this._d[k] = v; }, getItem(k) { return this._d[k] || null; } },
    fetch: undefined,
    document: {
      body: { appendChild() {}, removeChild() {} },
      createElement: (tag) => makeEl(tag),
      getElementById: (id) => ids[id] || null,
      querySelector: (sel) => {
        const mm = sel.match(/^#(\w+)\s+\.err-text$/);
        return mm ? errText[mm[1]] || null : null;
      },
      querySelectorAll: (sel) => (sel === '.cred-copy' ? copyBtns : []),
      addEventListener() {},
    },
  };
  sandbox.window.devicePixelRatio = 1;
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox);
  return { ids, errText, formItems, ctx, location, sandbox, copyBtns, clipboard };
}

/* ---------------- 用例 ---------------- */
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (detail ? '  → ' + detail : '')); }
}

function submit(page, user, pwd, code) {
  const { ids, formItems, errText, location } = page;
  // 复位
  location.href = 'file:///index.html';
  ids.username.value = user;
  ids.password.value = pwd;
  ids.captcha.value = code;
  for (const k of Object.keys(formItems)) formItems[k].classList.remove('has-err');
  for (const k of Object.keys(errText)) errText[k].textContent = '';
  ids.btnLogin.disabled = false;

  const handlers = ids.loginForm._handlers.submit || [];
  const ev = { preventDefault() {} };
  handlers.forEach((fn) => fn(ev));
  return {
    navigated: /app\.html$/.test(location.href),
    codeErr: errText.fCode.textContent,
    userErr: errText.fUser.textContent,
  };
}

console.log('登录页回归测试（canvas 模式）\n');

// 取一张验证码：脚本加载时已画过一次
let page = buildPage();
const shown = page.ctx.drawn.join('');
console.log('  当前验证码：' + shown + '\n');

check('原样输入 → 登录成功', submit(page, 'UiBot', PASS_VALUE, shown).navigated,
  '期望跳转 app.html');

page = buildPage();
const shown2 = page.ctx.drawn.join('');
check('全大写输入 → 登录成功', submit(page, 'UiBot', PASS_VALUE, shown2.toUpperCase()).navigated,
  '验证码=' + shown2 + '，输入=' + shown2.toUpperCase());

page = buildPage();
const shown3 = page.ctx.drawn.join('');
check('全小写输入 → 登录成功', submit(page, 'UiBot', PASS_VALUE, shown3.toLowerCase()).navigated,
  '验证码=' + shown3 + '，输入=' + shown3.toLowerCase());

page = buildPage();
const shown4 = page.ctx.drawn.join('');
const wrong = shown4 === 'ZZZZ' ? 'YYYY' : 'ZZZZ';
const r4 = submit(page, 'UiBot', PASS_VALUE, wrong);
check('验证码填错 → 提示验证码有误', !r4.navigated && /验证码有误/.test(r4.codeErr),
  '提示=' + r4.codeErr);

page = buildPage();
const shown5 = page.ctx.drawn.join('');
const r5 = submit(page, 'UiBot', 'wrong-pass', shown5);
check('密码填错 → 提示账号不正确', !r5.navigated && /用户名或密码不正确/.test(r5.userErr),
  '提示=' + r5.userErr);

page = buildPage();
const r6 = submit(page, '', PASS_VALUE, '');
check('留空 → 不跳转且报错', !r6.navigated);

console.log('\n一键复制：');

page = buildPage();
check('复制按钮共 2 个', page.copyBtns.length === 2, '实际 ' + page.copyBtns.length);
check('按钮是 type="button"（不触发表单提交）',
  (html.match(/<button type="button" class="cred-copy"/g) || []).length === 2);

page.copyBtns[0]._handlers.click[0]();
check('点第 1 个 → 复制的值等于显示的用户名',
  page.clipboard.writes[0] === SHOWN_USER && SHOWN_USER === USER_VALUE,
  '写入=' + page.clipboard.writes[0] + '，显示=' + SHOWN_USER);

page.copyBtns[1]._handlers.click[0]();
check('点第 2 个 → 复制的值等于显示的密码',
  page.clipboard.writes[1] === SHOWN_PWD && SHOWN_PWD === PASS_VALUE,
  '写入=' + page.clipboard.writes[1] + '，显示=' + SHOWN_PWD);

console.log('\n凭据一致性：');

const serverSrc = fs.readFileSync(path.join(__dirname, 'server.py'), 'utf8');
const srvPwd = pick(/"UiBot":\s*"([^"]+)"/, serverSrc);
const srvUser = pick(/"([^"]+)":\s*"Pass_/, serverSrc);

check('密码四处一致（显示 / PASS 常量 / data-copy / 服务端）',
  !!SHOWN_PWD && PASS_VALUE === SHOWN_PWD && COPY_VALUES[1] === SHOWN_PWD && srvPwd === SHOWN_PWD,
  `显示=${SHOWN_PWD} 常量=${PASS_VALUE} 按钮=${COPY_VALUES[1]} 服务端=${srvPwd}`);

check('用户名四处一致（显示 / USER 常量 / data-copy / 服务端）',
  !!SHOWN_USER && USER_VALUE === SHOWN_USER && COPY_VALUES[0] === SHOWN_USER && srvUser === SHOWN_USER,
  `显示=${SHOWN_USER} 常量=${USER_VALUE} 按钮=${COPY_VALUES[0]} 服务端=${srvUser}`);

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
