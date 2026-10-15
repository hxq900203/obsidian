// 工作台插件里纯计算部分的测试。在仓库根目录运行：node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

// 插件运行在 Obsidian 里，测试时用一个空壳代替 obsidian 模块
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === 'obsidian' ? 'obsidian' : resolve.call(this, request, ...rest);
};
class Stub {}
require.cache.obsidian = {
  id: 'obsidian',
  filename: 'obsidian',
  loaded: true,
  exports: {
    Plugin: Stub, ItemView: Stub, PluginSettingTab: Stub, Modal: Stub, Setting: Stub,
    Notice: Stub, Scope: Stub, TFile: Stub, TFolder: Stub,
    requestUrl: async () => ({}), setIcon() {}, normalizePath: (p) => p, debounce: (f) => f,
  },
};

const h = require(path.join(__dirname, '..', 'yan-desk', 'main.js')).helpers;
const day = (s) => new Date(`${s}T12:00:00`);

test('农历：日名、月名、年干支', () => {
  assert.deepEqual(h.lunarOf(day('2026-10-15')), { month: '九月', day: 6, dayName: '初六', yearName: '丙午' });
  assert.equal(h.lunarOf(day('2026-02-17')).month, '正月');
  assert.equal(h.lunarOf(day('2026-02-17')).dayName, '初一');
  // ICU 写作「十一月」，传统叫法是「冬月」
  assert.equal(h.lunarOf(day('2026-01-05')).month, '冬月');
  assert.equal(h.lunarOf(day('2025-07-30')).month, '闰六月');
});

test('节气日期与已知日期一致', () => {
  const cases = [
    ['2024-12-21', '冬至'], ['2025-02-03', '立春'], ['2025-12-21', '冬至'], ['2021-12-21', '冬至'],
    ['2026-02-04', '立春'], ['2026-02-18', '雨水'], ['2026-04-05', '清明'],
    ['2026-10-08', '寒露'], ['2026-10-23', '霜降'], ['2026-12-22', '冬至'],
  ];
  for (const [d, name] of cases) assert.equal(h.termOn(day(d)), name, d);
  assert.equal(h.termOn(day('2026-10-15')), null);
});

test('节气进度：第几天、还有几天', () => {
  assert.deepEqual(h.termInfo(day('2026-10-15')), { current: '寒露', day: 8, next: '霜降', daysToNext: 8, isTermDay: false });
  assert.equal(h.termInfo(day('2026-10-08')).isTermDay, true);
  // 跨年：一月初还在上一年的冬至里
  assert.equal(h.termInfo(day('2026-01-02')).current, '冬至');
});

test('日历格子的小字：节日优先于节气，节气优先于农历', () => {
  assert.deepEqual(h.calendarLabel(day('2026-10-01')), { text: '国庆', kind: 'fest' });
  assert.deepEqual(h.calendarLabel(day('2026-10-18')), { text: '重阳', kind: 'fest' });
  assert.deepEqual(h.calendarLabel(day('2026-10-08')), { text: '寒露', kind: 'term' });
  assert.deepEqual(h.calendarLabel(day('2026-10-10')), { text: '九月', kind: 'month' });
  assert.deepEqual(h.calendarLabel(day('2026-10-15')), { text: '初六', kind: 'lunar' });
  assert.deepEqual(h.calendarLabel(day('2026-02-16')), { text: '除夕', kind: 'fest' });
  assert.deepEqual(h.calendarLabel(day('2026-02-17')), { text: '春节', kind: 'fest' });
});

test('天气代码、风力、风向', () => {
  assert.deepEqual(h.weatherOf(0, true), { text: '晴', icon: 'sun' });
  assert.deepEqual(h.weatherOf(0, false), { text: '晴', icon: 'moon' });
  assert.deepEqual(h.weatherOf(63, true), { text: '中雨', icon: 'rain' });
  assert.deepEqual(h.weatherOf(1234, true), { text: '未知', icon: 'cloud' });
  assert.equal(h.windText(0.5, 90), '无风');
  assert.equal(h.windText(8, 45), '东北风 2 级');
  assert.equal(h.windText(30, 270), '西风 5 级');
});

test('解析待办行：去掉 Tasks 插件的标记，取出到期日', () => {
  assert.deepEqual(h.parseTaskLine('- [ ] 查一下端砚的产地 📅 2026-10-12'), { text: '查一下端砚的产地', due: '2026-10-12' });
  assert.deepEqual(h.parseTaskLine('  * [ ] 读 [[长物志|长物志]] 卷三 ⏫ ➕ 2026-10-01 ^abc12'), { text: '读 长物志 卷三', due: null });
  assert.deepEqual(h.parseTaskLine('1. [ ] **整理**会议纪要\r'), { text: '整理会议纪要', due: null });
  assert.equal(h.parseTaskLine('- [x] 已经做完'), null);
  assert.equal(h.parseTaskLine('- 普通列表'), null);
  // 模板里预留的空方框不算待办
  assert.equal(h.parseTaskLine('- [ ] '), null);
  assert.equal(h.parseTaskLine('- [ ] ⏫'), null);
});

test('勾掉待办：带到期日的补上完成日期，保留行尾换行符', () => {
  assert.equal(h.completeTaskLine('- [ ] 写完结尾', '2026-10-15'), '- [x] 写完结尾');
  assert.equal(h.completeTaskLine('- [ ] 写完结尾 📅 2026-10-15\r', '2026-10-15'), '- [x] 写完结尾 📅 2026-10-15 ✅ 2026-10-15\r');
});

test('待办分组：已逾期、今天、之后、未定日期', () => {
  const g = h.groupTasks([
    { text: 'a', due: '2026-10-20' }, { text: 'b', due: null }, { text: 'c', due: '2026-10-15' },
    { text: 'd', due: '2026-10-01' }, { text: 'e', due: '2026-10-12' },
  ], '2026-10-15');
  assert.deepEqual(g.map((x) => [x.key, x.items.map((t) => t.text)]), [
    ['overdue', ['d', 'e']], ['today', ['c']], ['later', ['a']], ['none', ['b']],
  ]);
});

test('相对时间', () => {
  const now = new Date('2026-10-15T15:00:00').getTime();
  assert.equal(h.relativeTime(now - 20e3, now), '刚刚');
  assert.equal(h.relativeTime(now - 5 * 60e3, now), '5 分钟前');
  assert.equal(h.relativeTime(now - 2 * 3600e3, now), '2 小时前');
  assert.equal(h.relativeTime(new Date('2026-10-14T23:00:00').getTime(), now), '昨天');
  assert.equal(h.relativeTime(new Date('2026-10-11T10:00:00').getTime(), now), '4 天前');
  assert.equal(h.relativeTime(new Date('2026-09-02T10:00:00').getTime(), now), '9月2日');
  assert.equal(h.relativeTime(new Date('2025-09-02T10:00:00').getTime(), now), '2025年9月');
});

test('问候语', () => {
  assert.equal(h.greeting(3), '夜深了');
  assert.equal(h.greeting(7), '早上好');
  assert.equal(h.greeting(10), '上午好');
  assert.equal(h.greeting(12), '中午好');
  assert.equal(h.greeting(15), '下午好');
  assert.equal(h.greeting(20), '晚上好');
});

test('墨迹：按天统计新建和修改，五档深浅', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 6, 7, 30].map(h.inkLevel), [0, 1, 2, 2, 3, 3, 4, 4]);
  const today = day('2026-10-15'); // 星期四
  const ts = (s) => new Date(`${s}T10:00:00`).getTime();
  const m = h.buildInk([
    { ctime: ts('2026-10-13'), mtime: ts('2026-10-14') },
    { ctime: ts('2026-10-14'), mtime: ts('2026-10-14') },
    { ctime: ts('2026-09-01'), mtime: ts('2026-10-15') },
  ], today, 20);
  assert.equal(m.cells.length, 140);
  assert.equal(m.cells[0].key, '2026-06-01'); // 往前第 19 周的星期一，连同本周共 20 列
  const byKey = Object.fromEntries(m.cells.map((c) => [c.key, c]));
  assert.deepEqual([byKey['2026-10-13'].created, byKey['2026-10-13'].modified], [1, 0]);
  assert.deepEqual([byKey['2026-10-14'].created, byKey['2026-10-14'].modified], [1, 1]);
  assert.equal(byKey['2026-10-16'].future, true);
  assert.deepEqual(m.week, { created: 2, modified: 1, total: 3 });
  assert.equal(m.months.filter(Boolean).length >= 5, true);
});

test('座右铭：按日期轮换，支持「句子|出处」', () => {
  const list = h.parseMottos('甲句|甲\n\n乙句');
  assert.deepEqual(list, [{ text: '甲句', by: '甲' }, { text: '乙句', by: '' }]);
  assert.equal(h.pickMotto(list, day('2026-01-01')).text, '甲句');
  assert.equal(h.pickMotto(list, day('2026-01-02')).text, '乙句');
  assert.equal(h.pickMotto([], day('2026-01-02')), null);
});

test('收件箱：同一天的记录归到同一个日期标题下', () => {
  const t = new Date('2026-10-15T09:30:00');
  assert.equal(h.appendToInbox('', '买墨', false, t), '## 2026-10-15\n\n- 09:30 买墨\n');
  assert.equal(h.appendToInbox('## 2026-10-15\n\n- 09:30 买墨\n', '洗砚', true, t), '## 2026-10-15\n\n- 09:30 买墨\n- [ ] 洗砚\n');
  assert.equal(h.appendToInbox('## 2026-10-14\n\n- 旧的\n', '新的', false, t), '## 2026-10-14\n\n- 旧的\n\n## 2026-10-15\n\n- 09:30 新的\n');
});
