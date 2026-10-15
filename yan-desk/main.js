'use strict';
/*
 * 砚台 · 工作台
 * 打开 Obsidian 先看到的一页：日签（日期、农历、节气、天气）、记一笔、待办、月历、
 * 最近在写、墨迹（写作热力图）、常用入口。
 */

const {
  Plugin, ItemView, PluginSettingTab, Setting, Modal, Notice, Scope, TFile, TFolder,
  requestUrl, normalizePath, debounce,
} = require('obsidian');

const VIEW_TYPE = 'yan-desk';
const DAY_MS = 86400000;

/* ========== 日期小工具 ========== */

const pad = (n) => String(n).padStart(2, '0');
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 用 UTC 算相差天数，避开夏令时
const daysBetween = (a, b) =>
  Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
const CN_MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const CN_WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const CN_NUM = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const cnCount = (n) => (n <= 10 ? CN_NUM[n] : n < 20 ? `十${CN_NUM[n - 10]}` : `${CN_NUM[Math.floor(n / 10)]}十${n % 10 ? CN_NUM[n % 10] : ''}`);

/* ========== 农历、节气、节日 ========== */

const LUNAR_DAYS = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
// 系统的农历写作「十一月」，习惯叫「冬月」
const LUNAR_MONTH_ALIAS = { 十一月: '冬月', 闰十一月: '闰冬月' };
let lunarFormatter;

function lunarOf(date) {
  try {
    lunarFormatter = lunarFormatter || new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { year: 'numeric', month: 'long', day: 'numeric' });
    const parts = {};
    for (const p of lunarFormatter.formatToParts(date)) parts[p.type] = p.value;
    const day = Number(parts.day);
    if (!parts.month || !(day >= 1 && day <= 30)) return null;
    return { month: LUNAR_MONTH_ALIAS[parts.month] || parts.month, day, dayName: LUNAR_DAYS[day - 1], yearName: parts.yearName || '' };
  } catch (e) {
    return null;
  }
}

const ZODIAC = { 子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇', 午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪' };

const TERM_NAMES = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
  '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];
// 二十一世纪节气的「寿星通式」常数和例外年份
const TERM_C = [5.4055, 20.12, 3.87, 18.73, 5.63, 20.646, 4.81, 20.1, 5.52, 21.04, 5.678, 21.37,
  7.108, 22.83, 7.5, 23.13, 7.646, 23.042, 8.318, 23.438, 7.438, 22.36, 7.18, 21.94];
const TERM_FIX = { '2019-0': -1, '2082-1': 1, '2026-3': -1, '2084-5': 1, '2008-9': 1, '2016-12': 1,
  '2002-14': 1, '2089-19': 1, '2089-20': 1, '2021-23': -1 };

function termDate(year, i) {
  const y = year % 100;
  const leaps = i < 4 ? Math.floor((y - 1) / 4) : Math.floor(y / 4);
  const day = Math.floor(y * 0.2422 + TERM_C[i]) - leaps + (TERM_FIX[`${year}-${i}`] || 0);
  return new Date(year, Math.floor(i / 2), day);
}

function termOn(date) {
  const d = startOfDay(date);
  for (const i of [date.getMonth() * 2, date.getMonth() * 2 + 1]) {
    if (+termDate(date.getFullYear(), i) === +d) return TERM_NAMES[i];
  }
  return null;
}

function termInfo(date) {
  const d = startOfDay(date);
  let current = null;
  let next = null;
  for (const year of [date.getFullYear() - 1, date.getFullYear(), date.getFullYear() + 1]) {
    for (let i = 0; i < 24 && !next; i++) {
      const t = { name: TERM_NAMES[i], date: termDate(year, i) };
      if (t.date <= d) current = t;
      else next = t;
    }
  }
  return { current: current.name, day: daysBetween(current.date, d) + 1, next: next.name, daysToNext: daysBetween(d, next.date), isTermDay: +current.date === +d };
}

const SOLAR_FESTIVALS = { '1-1': '元旦', '3-8': '妇女节', '5-1': '劳动节', '5-4': '青年节', '6-1': '儿童节',
  '7-1': '建党节', '8-1': '建军节', '9-10': '教师节', '10-1': '国庆' };
const LUNAR_FESTIVALS = { '正月-1': '春节', '正月-15': '元宵', '五月-5': '端午', '七月-7': '七夕', '八月-15': '中秋',
  '九月-9': '重阳', '腊月-8': '腊八', '腊月-23': '小年' };

function festivalOf(date, lunar) {
  const solar = SOLAR_FESTIVALS[`${date.getMonth() + 1}-${date.getDate()}`];
  if (solar) return solar;
  if (!lunar) return null;
  const fest = LUNAR_FESTIVALS[`${lunar.month}-${lunar.day}`];
  if (fest) return fest;
  const tomorrow = lunarOf(addDays(date, 1));
  if (tomorrow && tomorrow.month === '正月' && tomorrow.day === 1) return '除夕';
  return null;
}

// 月历格子里数字下面那行小字
function calendarLabel(date) {
  const lunar = lunarOf(date);
  const fest = festivalOf(date, lunar);
  if (fest) return { text: fest, kind: 'fest' };
  const term = termOn(date);
  if (term) return { text: term, kind: 'term' };
  if (!lunar) return { text: '', kind: 'lunar' };
  if (lunar.day === 1) return { text: lunar.month, kind: 'month' };
  return { text: lunar.dayName, kind: 'lunar' };
}

/* ========== 天气 ========== */

const WEATHER_CODES = [
  [[0], '晴', 'sun'], [[1], '晴间多云', 'sun-cloud'], [[2], '多云', 'sun-cloud'], [[3], '阴', 'cloud'],
  [[45, 48], '雾', 'fog'], [[51, 53, 55], '毛毛雨', 'rain'], [[56, 57], '冻毛毛雨', 'rain'],
  [[61], '小雨', 'rain'], [[63], '中雨', 'rain'], [[65], '大雨', 'rain'], [[66, 67], '冻雨', 'rain'],
  [[71], '小雪', 'snow'], [[73], '中雪', 'snow'], [[75], '大雪', 'snow'], [[77], '米雪', 'snow'],
  [[80], '阵雨', 'rain'], [[81], '中阵雨', 'rain'], [[82], '强阵雨', 'rain'], [[85], '阵雪', 'snow'],
  [[86], '强阵雪', 'snow'], [[95], '雷阵雨', 'storm'], [[96, 99], '雷阵雨伴冰雹', 'storm'],
];

function weatherOf(code, isDay) {
  const hit = WEATHER_CODES.find(([codes]) => codes.includes(code));
  if (!hit) return { text: '未知', icon: 'cloud' };
  let icon = hit[2];
  if (!isDay && icon === 'sun') icon = 'moon';
  if (!isDay && icon === 'sun-cloud') icon = 'moon-cloud';
  return { text: hit[1], icon };
}

const BEAUFORT_KMH = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
function windText(kmh, deg) {
  let level = 0;
  while (level < BEAUFORT_KMH.length && kmh >= BEAUFORT_KMH[level]) level++;
  if (level === 0) return '无风';
  const dir = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  return `${dir}风 ${level} 级`;
}

const ICONS = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 18.5z"/>',
  'sun-cloud': '<path d="M8.5 3.5v1.6M3.5 8.5h1.6M5 5l1.1 1.1M12 5l-1.1 1.1"/><path d="M5.7 11a3.5 3.5 0 0 1 5.8-3.5"/><path d="M8.5 19.5h9a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.6 1.2 3 3 0 0 0 .3 6z"/>',
  'moon-cloud': '<path d="M11.5 7.5A4.5 4.5 0 0 1 4 10.2 4.5 4.5 0 0 0 9.4 4a4.5 4.5 0 0 0 2.1 3.5z"/><path d="M8.5 19.5h9a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.6 1.2 3 3 0 0 0 .3 6z"/>',
  rain: '<path d="M7 15h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 15z"/><path d="M9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5"/>',
  snow: '<path d="M7 14.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 14.5z"/><path d="M9 18.5h.01M12 20.5h.01M15 18.5h.01"/>',
  fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
  storm: '<path d="M7 14.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 14.5z"/><path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>',
};

function weatherSvg(icon) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICONS[icon] || ICONS.cloud;
  return svg;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/* ========== 待办 ========== */

const TASK_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s?(.*)$/;

function parseTaskLine(line) {
  const m = line.replace(/\r$/, '').match(TASK_RE);
  if (!m) return null;
  const body = m[1];
  const dueMatch = body.match(/📅️?\s*(\d{4}-\d{2}-\d{2})/u);
  const text = body
    .replace(/(?:📅|⏳|🛫|➕|✅|❌)️?\s*\d{4}-\d{2}-\d{2}/gu, '')
    .replace(/[⏫🔼🔽🔺⏬]️?/gu, '')
    .replace(/\s\^[\w-]+\s*$/, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|==|~~)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // 模板里预留的空方框不算待办
  if (!text) return null;
  return { text, due: dueMatch ? dueMatch[1] : null };
}

function completeTaskLine(line, today) {
  const cr = line.endsWith('\r') ? '\r' : '';
  let body = line.replace(/\r$/, '').replace(/\[ \]/, '[x]');
  // 用 Tasks 插件写法（带 📅）的，按它的习惯补上完成日期
  if (/📅/u.test(body)) body += ` ✅ ${today}`;
  return body + cr;
}

const TASK_GROUPS = [['overdue', '已逾期'], ['today', '今天'], ['later', '之后'], ['none', '未定日期']];

function groupTasks(tasks, today) {
  const buckets = { overdue: [], today: [], later: [], none: [] };
  for (const t of tasks) {
    if (!t.due) buckets.none.push(t);
    else if (t.due < today) buckets.overdue.push(t);
    else if (t.due === today) buckets.today.push(t);
    else buckets.later.push(t);
  }
  const byDue = (a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
  buckets.overdue.sort(byDue);
  buckets.later.sort(byDue);
  return TASK_GROUPS.map(([key, label]) => ({ key, label, items: buckets[key] })).filter((g) => g.items.length);
}

/* ========== 时间、问候、座右铭 ========== */

function relativeTime(ts, now) {
  const diff = now - ts;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
  const then = new Date(ts);
  const days = daysBetween(then, new Date(now));
  if (days === 0) return `${Math.floor(diff / 3600e3)} 小时前`;
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  if (then.getFullYear() === new Date(now).getFullYear()) return `${then.getMonth() + 1}月${then.getDate()}日`;
  return `${then.getFullYear()}年${then.getMonth() + 1}月`;
}

function greeting(hour) {
  if (hour < 5) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 11) return '上午好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

const DEFAULT_MOTTOS = [
  '博观而约取，厚积而薄发。|苏轼',
  '不积跬步，无以至千里。|荀子',
  '业精于勤，荒于嬉；行成于思，毁于随。|韩愈',
  '纸上得来终觉浅，绝知此事要躬行。|陆游',
  '天下难事，必作于易；天下大事，必作于细。|老子',
  '知之者不如好之者，好之者不如乐之者。|孔子',
  '苟日新，日日新，又日新。|《礼记》',
];

function parseMottos(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [t, by] = l.split('|');
    return { text: t.trim(), by: (by || '').trim() };
  });
}

function pickMotto(list, date) {
  if (!list.length) return null;
  const doy = daysBetween(new Date(date.getFullYear(), 0, 1), date);
  return list[doy % list.length];
}

/* ========== 墨迹（写作热力图） ========== */

const INK_NAMES = ['清', '淡', '重', '浓', '焦'];
const inkLevel = (n) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);

function buildInk(files, today, weeks) {
  const end = startOfDay(today);
  const monday = addDays(end, -((end.getDay() + 6) % 7));
  const start = addDays(monday, -(weeks - 1) * 7);
  const counts = new Map();
  const bump = (key, field) => {
    const c = counts.get(key) || { created: 0, modified: 0 };
    c[field]++;
    counts.set(key, c);
  };
  const week = { created: 0, modified: 0, total: files.length };
  for (const f of files) {
    const c = dayKey(new Date(f.ctime));
    const m = dayKey(new Date(f.mtime));
    bump(c, 'created');
    if (m !== c) bump(m, 'modified');
    if (f.ctime >= +monday) week.created++;
    else if (f.mtime >= +monday) week.modified++;
  }
  const cells = [];
  const months = [];
  for (let w = 0; w < weeks; w++) {
    let label = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, w * 7 + i);
      const key = dayKey(d);
      const c = counts.get(key) || { created: 0, modified: 0 };
      cells.push({ key, date: d, created: c.created, modified: c.modified, level: inkLevel(c.created + c.modified), future: d > end });
      if (d.getDate() === 1 || (w === 0 && i === 0)) label = CN_MONTHS[d.getMonth()];
    }
    months.push(label);
  }
  return { cells, months, week };
}

/* ========== 收件箱 ========== */

function appendToInbox(content, text, asTask, now) {
  const heading = `## ${dayKey(now)}`;
  const line = asTask ? `- [ ] ${text}` : `- ${pad(now.getHours())}:${pad(now.getMinutes())} ${text}`;
  const body = content.replace(/\s+$/, '');
  const headings = body.match(/^## .*$/gm);
  const last = headings ? headings[headings.length - 1].trim() : null;
  if (last === heading) return `${body}\n${line}\n`;
  return `${body}${body ? '\n\n' : ''}${heading}\n\n${line}\n`;
}

const helpers = {
  lunarOf, termOn, termInfo, calendarLabel, weatherOf, windText, parseTaskLine, completeTaskLine,
  groupTasks, relativeTime, greeting, inkLevel, buildInk, parseMottos, pickMotto, appendToInbox,
};

/* ========== 设置 ========== */

const DEFAULT_SETTINGS = {
  openOnStartup: true,
  weatherEnabled: true,
  city: '',
  place: '',
  latitude: null,
  longitude: null,
  inboxPath: '收件箱.md',
  quickLinks: '',
  mottos: DEFAULT_MOTTOS.join('\n'),
  excludeFolders: '',
  lastWeather: null,
};

const WEATHER_TTL = 30 * 60 * 1000;

/* ========== 工作台视图 ========== */

class DeskView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.scope = new Scope(this.app.scope);
    this.calMonth = null;
    this.today = dayKey(new Date());
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return '工作台'; }
  getIcon() { return 'layout-dashboard'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('yan-desk-view');
    const root = this.contentEl.createDiv({ cls: 'yan-desk' });
    const head = root.createDiv({ cls: 'yd-head' });
    this.helloEl = head.createDiv({ cls: 'yd-hello' });
    this.buildCapture(head);
    const grid = root.createDiv({ cls: 'yd-grid' });
    this.dayEl = grid.createDiv({ cls: 'yd-day' });
    this.tasksEl = grid.createDiv({ cls: 'yd-section yd-tasks' });
    this.calEl = grid.createDiv({ cls: 'yd-section yd-cal' });
    this.recentEl = grid.createDiv({ cls: 'yd-section yd-recent' });
    this.inkEl = grid.createDiv({ cls: 'yd-section yd-ink' });
    this.linksEl = grid.createDiv({ cls: 'yd-links' });

    this.refresh = debounce(() => this.renderData(), 600, true);
    this.registerEvent(this.app.metadataCache.on('changed', () => this.refresh()));
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.refresh()));
    for (const ev of ['create', 'delete', 'rename']) this.registerEvent(this.app.vault.on(ev, () => this.refresh()));
    // 每分钟看一眼：过了零点整页重画，平时只更新问候语
    this.registerInterval(window.setInterval(() => this.tick(), 60 * 1000));

    this.renderAll();
  }

  async onClose() {
    this.contentEl.empty();
  }

  tick() {
    const key = dayKey(new Date());
    if (key !== this.today) {
      this.today = key;
      this.calMonth = null;
      this.renderAll();
    } else {
      this.renderHello();
      if (Date.now() - ((this.plugin.settings.lastWeather || {}).at || 0) > WEATHER_TTL) this.renderDay();
    }
  }

  renderAll() {
    this.renderHello();
    this.renderDay();
    this.renderCalendar();
    this.renderData();
  }

  async renderData() {
    if (!this.tasksEl) return;
    this.renderRecent();
    this.renderInk();
    this.renderLinks();
    this.renderCalendar();
    await this.renderTasks();
  }

  /* ---------- 问候、座右铭 ---------- */

  renderHello() {
    const now = new Date();
    this.helloEl.empty();
    this.helloEl.createDiv({ cls: 'yd-greet', text: greeting(now.getHours()) });
    const motto = pickMotto(parseMottos(this.plugin.settings.mottos), now);
    if (motto) {
      const m = this.helloEl.createDiv({ cls: 'yd-motto', text: motto.text });
      if (motto.by) m.createSpan({ text: motto.by });
    }
  }

  /* ---------- 记一笔 ---------- */

  buildCapture(parent) {
    const box = parent.createDiv({ cls: 'yd-capture' });
    const input = box.createEl('input', {
      type: 'text',
      attr: { placeholder: '记一笔，回车存入收件箱', 'aria-label': '记一笔' },
    });
    const hint = box.createEl('span', { cls: 'yd-capture-hint', text: '⏎ 收件箱' });
    hint.setAttr('title', '回车：记一笔；Ctrl + 回车：存成待办');
    const submit = async (asTask) => {
      const text = input.value.trim();
      if (!text) return;
      try {
        await this.plugin.capture(text, asTask);
        input.value = '';
        new Notice(asTask ? '已存为待办' : '已记入收件箱');
      } catch (err) {
        console.error(err);
        new Notice('没能写入收件箱，请检查设置里的收件箱路径');
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      submit(false);
    });
    // Ctrl/Cmd + 回车在 Obsidian 里是全局快捷键，按键到不了输入框，所以注册在视图的按键作用域里
    this.scope.register(['Mod'], 'Enter', (e) => {
      if (document.activeElement !== input || e.isComposing) return true;
      submit(true);
      return false;
    });
  }

  /* ---------- 日签 ---------- */

  renderDay() {
    const now = new Date();
    const el = this.dayEl;
    el.empty();
    const lunar = lunarOf(now);
    const term = termInfo(now);
    const ym = el.createDiv({ cls: 'yd-day-ym' });
    ym.setText([now.getFullYear(), lunar && lunar.yearName ? `${lunar.yearName}${ZODIAC[lunar.yearName.slice(-1)] || ''}年` : '', CN_MONTHS[now.getMonth()]].filter(Boolean).join(' · '));
    el.createDiv({ cls: 'yd-seal', text: term.current, attr: { 'aria-label': `节气：${term.current}` } });
    el.createDiv({ cls: 'yd-day-num', text: String(now.getDate()) });
    el.createDiv({ cls: 'yd-day-week', text: CN_WEEKDAYS[now.getDay()] });
    const lunarLine = el.createDiv({ cls: 'yd-day-lunar' });
    const fest = festivalOf(now, lunar);
    lunarLine.setText(lunar ? `农历${lunar.month}${lunar.dayName}${fest ? ` · ${fest}` : ''}` : fest || '');
    el.createDiv({
      cls: 'yd-day-term',
      text: term.isTermDay ? `今日${term.current} · 再过${cnCount(term.daysToNext)}天${term.next}` : `${term.current}第${cnCount(term.day)}天 · 再过${cnCount(term.daysToNext)}天${term.next}`,
    });
    this.weatherEl = el.createDiv({ cls: 'yd-weather' });
    this.renderWeather();

    el.setAttr('role', 'button');
    el.setAttr('tabindex', '0');
    el.setAttr('aria-label', '打开今天的日记');
    el.onclick = (e) => {
      if (e.target.closest('.yd-weather')) return;
      this.plugin.openDailyNote(new Date());
    };
    el.onkeydown = (e) => {
      if (e.key === 'Enter') this.plugin.openDailyNote(new Date());
    };
  }

  async renderWeather(force) {
    const el = this.weatherEl;
    const s = this.plugin.settings;
    if (!s.weatherEnabled) {
      el.remove();
      return;
    }
    el.onclick = (e) => {
      e.stopPropagation();
      this.renderWeather(true);
    };
    el.setAttr('title', '点一下刷新天气');
    if (s.latitude == null) {
      el.empty();
      el.createDiv({ cls: 'yd-weather-empty', text: '在「砚台」设置里填写城市后显示天气' });
      return;
    }
    const show = (w, note) => {
      el.empty();
      const info = weatherOf(w.code, w.isDay);
      el.appendChild(weatherSvg(info.icon));
      el.createDiv({ cls: 'yd-weather-temp', text: `${Math.round(w.temp)}°` });
      const d = el.createDiv({ cls: 'yd-weather-detail' });
      d.createDiv({ text: `${info.text} · ${Math.round(w.min)}° / ${Math.round(w.max)}°` });
      d.createDiv({ text: `${windText(w.wind, w.windDir)} · ${s.place || s.city}${note ? ` · ${note}` : ''}` });
    };
    const cached = s.lastWeather;
    if (cached && cached.lat === s.latitude && cached.lon === s.longitude) show(cached);
    try {
      const w = await this.plugin.fetchWeather(force === true);
      if (w && this.weatherEl === el) show(w);
    } catch (err) {
      if (this.weatherEl !== el) return;
      if (cached && cached.lat === s.latitude && cached.lon === s.longitude) {
        const t = new Date(cached.at);
        show(cached, `${pad(t.getHours())}:${pad(t.getMinutes())} 的数据`);
      } else {
        el.empty();
        el.createDiv({ cls: 'yd-weather-empty', text: '天气暂时取不到，点一下重试' });
      }
    }
  }

  /* ---------- 待办 ---------- */

  async renderTasks() {
    const tasks = await this.plugin.collectTasks();
    const el = this.tasksEl;
    el.empty();
    const title = el.createDiv({ cls: 'yd-title', text: '待办' });
    title.createEl('small', { text: tasks.length ? `共 ${tasks.length} 项` : '' });
    if (!tasks.length) {
      el.createDiv({ cls: 'yd-empty', text: '没有待办。写下「- [ ] 要做的事」就会出现在这里。' });
      return;
    }
    const today = dayKey(new Date());
    const LIMIT = 7;
    let shown = 0;
    for (const group of groupTasks(tasks, today)) {
      if (shown >= LIMIT) break;
      el.createDiv({ cls: `yd-group yd-group-${group.key}`, text: group.label });
      for (const t of group.items) {
        if (shown >= LIMIT) break;
        shown++;
        const row = el.createDiv({ cls: 'yd-task' });
        const box = row.createEl('input', { type: 'checkbox', cls: 'task-list-item-checkbox', attr: { 'aria-label': `完成：${t.text}` } });
        box.addEventListener('click', async (e) => {
          e.preventDefault();
          box.disabled = true;
          const ok = await this.plugin.completeTask(t);
          if (ok) row.addClass('is-done');
          else box.disabled = false;
        });
        const text = row.createEl('a', { cls: 'yd-task-text', text: t.text, attr: { href: '#', title: `${t.file.path}，第 ${t.line + 1} 行` } });
        text.addEventListener('click', (e) => {
          e.preventDefault();
          this.plugin.openFile(t.file, t.line);
        });
        row.createSpan({ cls: 'yd-task-src', text: t.file.basename });
        if (t.due) {
          const [, m, d] = t.due.split('-').map(Number);
          row.createSpan({ cls: `yd-task-due${t.due < today ? ' is-late' : ''}`, text: t.due === today ? '今天' : `${m}/${d}` });
        }
      }
    }
    if (tasks.length > shown) {
      const more = el.createEl('a', { cls: 'yd-more', text: `查看全部 ${tasks.length} 项`, attr: { href: '#' } });
      more.addEventListener('click', (e) => {
        e.preventDefault();
        this.plugin.searchTasks();
      });
    }
  }

  /* ---------- 月历 ---------- */

  renderCalendar() {
    const now = new Date();
    if (!this.calMonth) this.calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const month = this.calMonth;
    const el = this.calEl;
    el.empty();
    const title = el.createDiv({ cls: 'yd-title' });
    const name = title.createEl('a', {
      cls: 'yd-cal-name',
      text: month.getFullYear() === now.getFullYear() ? CN_MONTHS[month.getMonth()] : `${month.getFullYear()} · ${CN_MONTHS[month.getMonth()]}`,
      attr: { href: '#', title: '回到本月' },
    });
    name.addEventListener('click', (e) => {
      e.preventDefault();
      this.calMonth = null;
      this.renderCalendar();
    });
    const nav = title.createDiv({ cls: 'yd-cal-nav' });
    const step = (n) => {
      this.calMonth = new Date(month.getFullYear(), month.getMonth() + n, 1);
      this.renderCalendar();
    };
    nav.createEl('button', { text: '‹', attr: { 'aria-label': '上个月' } }).addEventListener('click', () => step(-1));
    nav.createEl('button', { text: '›', attr: { 'aria-label': '下个月' } }).addEventListener('click', () => step(1));

    const table = el.createEl('table');
    const headRow = table.createEl('tr');
    for (const w of '一二三四五六日') headRow.createEl('th', { text: w });
    const start = addDays(month, -((month.getDay() + 6) % 7));
    const weeks = Math.ceil((daysBetween(start, new Date(month.getFullYear(), month.getMonth() + 1, 1))) / 7);
    const daily = this.plugin.dailyNoteSettings();
    const todayStart = startOfDay(now);
    for (let w = 0; w < weeks; w++) {
      const tr = table.createEl('tr');
      for (let i = 0; i < 7; i++) {
        const d = addDays(start, w * 7 + i);
        const label = calendarLabel(d);
        const td = tr.createEl('td');
        if (d.getMonth() !== month.getMonth()) td.addClass('is-out');
        if (+d === +todayStart) td.addClass('is-today');
        if (label.kind === 'fest' || label.kind === 'term') td.addClass('is-fest');
        if (this.plugin.findDailyNote(d, daily)) td.addClass('has-note');
        const btn = td.createEl('button', { attr: { 'aria-label': `${d.getMonth() + 1}月${d.getDate()}日 ${label.text}` } });
        btn.createEl('b', { text: String(d.getDate()) });
        btn.createEl('small', { text: label.text });
        btn.addEventListener('click', () => this.plugin.openDailyNote(d, true));
      }
    }
  }

  /* ---------- 最近在写 ---------- */

  renderRecent() {
    const el = this.recentEl;
    el.empty();
    const title = el.createDiv({ cls: 'yd-title', text: '最近在写' });
    title.createEl('small', { text: '按修改时间' });
    const files = this.plugin.notes().sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 6);
    if (!files.length) {
      el.createDiv({ cls: 'yd-empty', text: '还没有笔记。' });
      return;
    }
    const now = Date.now();
    for (const f of files) {
      const row = el.createEl('a', { cls: 'yd-recent-row', attr: { href: '#', title: f.path } });
      row.createSpan({ cls: 'yd-recent-name', text: f.basename });
      row.createSpan({ cls: 'yd-recent-folder', text: f.parent && f.parent.path !== '/' ? f.parent.name : '' });
      row.createSpan({ cls: 'yd-recent-time', text: relativeTime(f.stat.mtime, now) });
      row.addEventListener('click', (e) => {
        e.preventDefault();
        this.plugin.openFile(f);
      });
    }
  }

  /* ---------- 墨迹 ---------- */

  renderInk() {
    const el = this.inkEl;
    el.empty();
    const title = el.createDiv({ cls: 'yd-title', text: '墨迹' });
    title.createEl('small', { text: '近二十周' });
    const files = this.plugin.notes().map((f) => ({ ctime: f.stat.ctime, mtime: f.stat.mtime }));
    const ink = buildInk(files, new Date(), 20);
    const months = el.createDiv({ cls: 'yd-ink-months' });
    for (const m of ink.months) months.createSpan({ text: m });
    const grid = el.createDiv({ cls: 'yd-ink-cells' });
    for (const c of ink.cells) {
      const cell = grid.createSpan({ cls: c.future ? 'is-future' : `yd-l${c.level}` });
      if (!c.future) {
        const parts = [];
        if (c.created) parts.push(`新建 ${c.created} 篇`);
        if (c.modified) parts.push(`修改 ${c.modified} 篇`);
        cell.setAttr('title', `${c.date.getMonth() + 1}月${c.date.getDate()}日：${parts.join('，') || '没有动笔'}`);
      }
    }
    const legend = el.createDiv({ cls: 'yd-ink-legend' });
    legend.createEl('em', { text: '墨分五色' });
    INK_NAMES.forEach((n, i) => {
      legend.createSpan({ cls: `yd-swatch yd-l${i}` });
      legend.createSpan({ text: n });
    });
    const sum = el.createDiv({ cls: 'yd-ink-sum' });
    sum.appendText('本周新建 ');
    sum.createEl('b', { text: String(ink.week.created) });
    sum.appendText(' 篇，修改 ');
    sum.createEl('b', { text: String(ink.week.modified) });
    sum.appendText(' 篇；库里一共 ');
    sum.createEl('b', { text: String(ink.week.total) });
    sum.appendText(' 篇。');
  }

  /* ---------- 常用 ---------- */

  renderLinks() {
    const el = this.linksEl;
    el.empty();
    const links = this.plugin.quickLinks();
    if (!links.length) return;
    el.createSpan({ cls: 'yd-links-label', text: '常用' });
    for (const l of links) {
      const a = el.createEl('a', { cls: `yd-link${l.missing ? ' is-missing' : ''}`, attr: { href: '#', title: l.missing ? `点一下新建「${l.name}」` : l.path } });
      a.createSpan({ text: l.name });
      if (l.count != null) a.createEl('small', { text: String(l.count) });
      a.addEventListener('click', (e) => {
        e.preventDefault();
        this.plugin.openQuickLink(l);
      });
    }
  }
}

/* ========== 新建日记前确认一下 ========== */

class ConfirmModal extends Modal {
  constructor(app, message, onYes) {
    super(app);
    this.message = message;
    this.onYes = onYes;
  }

  onOpen() {
    this.contentEl.createEl('p', { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('取消').onClick(() => this.close()))
      .addButton((b) => b.setButtonText('新建').setCta().onClick(() => {
        this.close();
        this.onYes();
      }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ========== 设置页 ========== */

class DeskSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName('启动时打开工作台')
      .setDesc('每次打开 Obsidian，先显示工作台。')
      .addToggle((t) => t.setValue(s.openOnStartup).onChange(async (v) => {
        s.openOnStartup = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl).setName('天气').setHeading();
    new Setting(containerEl)
      .setName('显示天气')
      .setDesc('数据来自 Open-Meteo，不用注册，需要能连网。')
      .addToggle((t) => t.setValue(s.weatherEnabled).onChange(async (v) => {
        s.weatherEnabled = v;
        await this.plugin.saveSettings();
      }));
    const city = new Setting(containerEl)
      .setName('城市')
      .setDesc(s.latitude != null ? `当前：${s.place}（${s.latitude.toFixed(2)}, ${s.longitude.toFixed(2)}）` : '填写城市名，比如「杭州」，然后点「查询」。');
    let cityInput;
    city.addText((t) => {
      cityInput = t;
      t.setPlaceholder('城市名').setValue(s.city);
    });
    city.addButton((b) => b.setButtonText('查询').onClick(async () => {
      const name = cityInput.getValue().trim();
      if (!name) return;
      b.setDisabled(true);
      try {
        const place = await this.plugin.geocode(name);
        if (!place) {
          new Notice(`没找到「${name}」，换个写法试试`);
        } else {
          Object.assign(s, { city: name, place: place.label, latitude: place.latitude, longitude: place.longitude, lastWeather: null });
          await this.plugin.saveSettings();
          new Notice(`已设为 ${place.label}`);
          this.display();
        }
      } catch (err) {
        new Notice('查询失败，请检查网络');
      }
      b.setDisabled(false);
    }));

    new Setting(containerEl).setName('内容').setHeading();
    new Setting(containerEl)
      .setName('收件箱')
      .setDesc('「记一笔」写进哪篇笔记。没有的话会自动新建。')
      .addText((t) => t.setPlaceholder('收件箱.md').setValue(s.inboxPath).onChange(async (v) => {
        s.inboxPath = v.trim() || DEFAULT_SETTINGS.inboxPath;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('常用')
      .setDesc('一行一个笔记名或文件夹路径。不填时，自动显示笔记最多的几个顶层文件夹。')
      .addTextArea((t) => {
        t.setPlaceholder('收件箱\n工作日志\n项目/第四季度').setValue(s.quickLinks).onChange(async (v) => {
          s.quickLinks = v;
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 6;
      });
    new Setting(containerEl)
      .setName('座右铭')
      .setDesc('一行一句，每天换一句。想写出处的话，用竖线隔开：句子|出处')
      .addTextArea((t) => {
        t.setValue(s.mottos).onChange(async (v) => {
          s.mottos = v;
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 7;
      });
    new Setting(containerEl)
      .setName('不统计的文件夹')
      .setDesc('一行一个。这些文件夹里的笔记不出现在待办、最近在写和墨迹里。模板文件夹会自动排除。')
      .addTextArea((t) => {
        t.setPlaceholder('归档\n附件').setValue(s.excludeFolders).onChange(async (v) => {
          s.excludeFolders = v;
          await this.plugin.saveSettings();
        });
        t.inputEl.rows = 4;
      });
  }
}

/* ========== 插件 ========== */

class YanDeskPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new DeskView(leaf, this));
    this.addRibbonIcon('layout-dashboard', '打开工作台', () => this.openDesk());
    this.addCommand({ id: 'open', name: '打开工作台', callback: () => this.openDesk() });
    this.addSettingTab(new DeskSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openOnStartup) this.openDesk();
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.rerender();
  }

  rerender() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof DeskView) leaf.view.renderAll();
    }
  }

  openDesk() {
    // 启动时自动打开和手动点按钮可能撞在一起，只开一个
    if (!this.opening) this.opening = this.revealDesk().finally(() => { this.opening = null; });
    return this.opening;
  }

  async revealDesk() {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const recent = ws.getMostRecentLeaf();
      leaf = recent && recent.view && recent.view.getViewType() === 'empty' ? recent : ws.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    ws.revealLeaf(leaf);
    ws.setActiveLeaf(leaf, { focus: true });
  }

  /* ---------- 笔记范围 ---------- */

  excludedFolders() {
    const list = String(this.settings.excludeFolders || '').split('\n').map((l) => normalizePath(l.trim())).filter((l) => l && l !== '/');
    const templates = this.app.internalPlugins && this.app.internalPlugins.getPluginById('templates');
    const folder = templates && templates.enabled && templates.instance && templates.instance.options && templates.instance.options.folder;
    if (folder) list.push(normalizePath(folder));
    return list;
  }

  notes() {
    const excluded = this.excludedFolders();
    return this.app.vault.getMarkdownFiles().filter((f) => !excluded.some((x) => f.path === x || f.path.startsWith(`${x}/`)));
  }

  /* ---------- 打开文件 ---------- */

  async openFile(file, line) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType('markdown').find((l) => l.view.file && l.view.file.path === file.path);
    if (!leaf) {
      leaf = ws.getLeaf('tab');
      await leaf.openFile(file, line != null ? { eState: { line } } : undefined);
    } else if (line != null) {
      leaf.setEphemeralState({ line });
    }
    ws.setActiveLeaf(leaf, { focus: true });
  }

  /* ---------- 日记 ---------- */

  dailyNoteSettings() {
    const p = this.app.internalPlugins && this.app.internalPlugins.getPluginById('daily-notes');
    const o = (p && p.instance && p.instance.options) || {};
    return {
      format: o.format || 'YYYY-MM-DD',
      folder: String(o.folder || '').replace(/^\/+|\/+$/g, ''),
      template: o.template || '',
    };
  }

  dailyNotePath(date, s) {
    const name = window.moment(date).format(s.format);
    return normalizePath(`${s.folder ? `${s.folder}/` : ''}${name}.md`);
  }

  findDailyNote(date, s) {
    const f = this.app.vault.getAbstractFileByPath(this.dailyNotePath(date, s));
    return f instanceof TFile ? f : null;
  }

  async openDailyNote(date, confirmCreate) {
    const s = this.dailyNoteSettings();
    const existing = this.findDailyNote(date, s);
    if (existing) return this.openFile(existing);
    const create = async () => {
      const path = this.dailyNotePath(date, s);
      await this.ensureFolder(path);
      const file = await this.app.vault.create(path, await this.dailyTemplate(date, s));
      this.openFile(file);
    };
    const isToday = dayKey(date) === dayKey(new Date());
    if (confirmCreate && !isToday) {
      new ConfirmModal(this.app, `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日还没有日记，要新建一篇吗？`, create).open();
    } else {
      await create();
    }
  }

  async dailyTemplate(date, s) {
    if (!s.template) return '';
    const tpl = this.app.metadataCache.getFirstLinkpathDest(s.template, '');
    if (!(tpl instanceof TFile)) return '';
    const m = window.moment(date);
    const now = window.moment();
    return (await this.app.vault.read(tpl))
      .replace(/{{\s*date\s*:\s*([^}]+?)\s*}}/gi, (_, fmt) => m.format(fmt))
      .replace(/{{\s*date\s*}}/gi, m.format(s.format))
      .replace(/{{\s*time\s*:\s*([^}]+?)\s*}}/gi, (_, fmt) => now.format(fmt))
      .replace(/{{\s*time\s*}}/gi, now.format('HH:mm'))
      .replace(/{{\s*title\s*}}/gi, m.format(s.format));
  }

  async ensureFolder(filePath) {
    const dir = filePath.split('/').slice(0, -1).join('/');
    if (!dir || this.app.vault.getAbstractFileByPath(dir)) return;
    await this.app.vault.createFolder(dir);
  }

  /* ---------- 待办 ---------- */

  async collectTasks() {
    const tasks = [];
    for (const file of this.notes()) {
      const items = (this.app.metadataCache.getFileCache(file) || {}).listItems;
      if (!items) continue;
      const open = items.filter((li) => li.task === ' ');
      if (!open.length) continue;
      const lines = (await this.app.vault.cachedRead(file)).split('\n');
      for (const li of open) {
        const line = li.position.start.line;
        const parsed = parseTaskLine(lines[line] || '');
        if (parsed) tasks.push({ ...parsed, file, line, raw: lines[line], mtime: file.stat.mtime });
      }
    }
    tasks.sort((a, b) => b.mtime - a.mtime);
    return tasks;
  }

  async completeTask(task) {
    const today = dayKey(new Date());
    let changed = false;
    try {
      await this.app.vault.process(task.file, (data) => {
        const lines = data.split('\n');
        if (lines[task.line] !== task.raw) return data;
        lines[task.line] = completeTaskLine(task.raw, today);
        changed = true;
        return lines.join('\n');
      });
    } catch (err) {
      console.error(err);
    }
    if (!changed) new Notice('这条待办刚被改过，已重新读取');
    return changed;
  }

  searchTasks() {
    const search = this.app.internalPlugins && this.app.internalPlugins.getPluginById('global-search');
    if (search && search.enabled) search.instance.openGlobalSearch('task-todo:""');
    else new Notice('请先在「核心插件」里打开「搜索」');
  }

  /* ---------- 记一笔 ---------- */

  async capture(text, asTask) {
    let path = normalizePath(this.settings.inboxPath || DEFAULT_SETTINGS.inboxPath);
    if (!/\.md$/i.test(path)) path += '.md';
    const now = new Date();
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.process(file, (data) => appendToInbox(data, text, asTask, now));
    } else {
      await this.ensureFolder(path);
      await this.app.vault.create(path, appendToInbox('', text, asTask, now));
    }
  }

  /* ---------- 常用 ---------- */

  quickLinks() {
    const vault = this.app.vault;
    const countNotes = (folder) => {
      let n = 0;
      const walk = (f) => {
        for (const c of f.children) {
          if (c instanceof TFolder) walk(c);
          else if (c instanceof TFile && c.extension === 'md') n++;
        }
      };
      walk(folder);
      return n;
    };
    const entries = String(this.settings.quickLinks || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (!entries.length) {
      const excluded = this.excludedFolders();
      return vault.getRoot().children
        .filter((c) => c instanceof TFolder && !c.name.startsWith('.') && !excluded.includes(c.path))
        .map((c) => ({ name: c.name, path: c.path, folder: c, count: countNotes(c) }))
        .filter((l) => l.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);
    }
    return entries.map((entry) => {
      const p = normalizePath(entry);
      const found = vault.getAbstractFileByPath(p) || vault.getAbstractFileByPath(`${p}.md`) || this.app.metadataCache.getFirstLinkpathDest(entry, '');
      if (found instanceof TFolder) return { name: found.name, path: found.path, folder: found, count: countNotes(found) };
      if (found instanceof TFile) return { name: found.basename, path: found.path, file: found };
      return { name: entry.split('/').pop(), path: p, missing: true };
    });
  }

  async openQuickLink(link) {
    if (link.file) return this.openFile(link.file);
    if (link.folder) {
      const leaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
      if (leaf) {
        this.app.workspace.revealLeaf(leaf);
        leaf.view.revealInFolder(link.folder);
        const item = leaf.view.fileItems && leaf.view.fileItems[link.folder.path];
        if (item && typeof item.setCollapsed === 'function') item.setCollapsed(false);
      }
      return;
    }
    const path = /\.md$/i.test(link.path) ? link.path : `${link.path}.md`;
    await this.ensureFolder(path);
    const file = await this.app.vault.create(path, '');
    this.openFile(file);
  }

  /* ---------- 天气 ---------- */

  async geocode(name) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`;
    const res = await withTimeout(requestUrl({ url }), 10000);
    const hit = res.json && res.json.results && res.json.results[0];
    if (!hit) return null;
    const label = [hit.admin1 && hit.admin1 !== hit.name ? hit.admin1 : '', hit.name].filter(Boolean).join(' · ');
    return { latitude: hit.latitude, longitude: hit.longitude, label };
  }

  async fetchWeather(force) {
    const s = this.settings;
    const last = s.lastWeather;
    const same = last && last.lat === s.latitude && last.lon === s.longitude;
    if (!force && same && Date.now() - last.at < WEATHER_TTL) return last;
    if (this.weatherRequest) return this.weatherRequest;
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${s.latitude}&longitude=${s.longitude}`
      + '&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day'
      + '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1';
    this.weatherRequest = (async () => {
      try {
        const { json } = await withTimeout(requestUrl({ url }), 10000);
        const c = json.current;
        const w = {
          lat: s.latitude, lon: s.longitude, at: Date.now(),
          temp: c.temperature_2m, code: c.weather_code, isDay: c.is_day === 1,
          wind: c.wind_speed_10m, windDir: c.wind_direction_10m,
          max: json.daily.temperature_2m_max[0], min: json.daily.temperature_2m_min[0],
        };
        s.lastWeather = w;
        await this.saveData(s);
        return w;
      } finally {
        this.weatherRequest = null;
      }
    })();
    return this.weatherRequest;
  }
}

module.exports = YanDeskPlugin;
module.exports.default = YanDeskPlugin;
module.exports.helpers = helpers;
