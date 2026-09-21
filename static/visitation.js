/* Public visitor totals are independent of collected posts and photo coverage. */
(() => {
  'use strict';
  const list = (value) => Array.isArray(value) ? value : [];
  const url = (value) => { try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : ''; } catch { return ''; } };
  function monthRecords(cell, records, now = new Date()) {
    if (!cell || cell.status !== 'reported' || typeof cell.value !== 'number' || !Number.isFinite(cell.value) || cell.value < 0) return [];
    const { year, month } = cell;
    if (!Number.isInteger(year) || year < 1900 || !Number.isInteger(month) || month < 1 || month > 12) return [];
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = `${year}-${String(month).padStart(2, '0')}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
    if (Date.UTC(year, month, 1) > now.getTime()) return [];
    const ids = list(cell.record_ids);
    const found = ids.map((id) => records.find((record) => record.id === id));
    if (!found.length || found.some((r) => !r || r.scope !== 'attraction' || r.attraction_id !== cell.attraction_id || r.year !== year || r.period_grain !== 'month' || r.period_start !== start || r.period_end !== end || r.metric !== 'visitor_arrivals' || r.unit !== 'person_visits' || !['eq', 'approx'].includes(r.operator) || r.value !== cell.value || !url(r.source?.url))) return [];
    return found;
  }
  function model(raw, now = new Date()) {
    const data = raw?.schema_version === 'visitor-seasonality-v1' ? raw : {};
    const years = [...new Set(list(data.years).filter((year) => Number.isInteger(year) && year >= 1900))].sort((a, b) => b - a);
    const records = list(data.records);
    return { ...data, years, attractions: list(data.attractions), records, monthly: list(data.monthly).map((cell) => ({ ...cell, eligible: monthRecords(cell, records, now).length > 0 })) };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { model, monthRecords };
  if (typeof document === 'undefined') return;
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  let destinationId = null;
  let selectedYear = null;
  const amount = (record) => record.display_value || `${({ approx: '约', gt: '超过', gte: '至少' })[record.operator] || ''}${Number(record.value).toLocaleString('zh-CN')} 人次`;
  function recordNode(record) {
    const item = el('li', 'visitation-record');
    item.append(el('strong', '', `${record.scope_name || '范围待确认'} · ${amount(record)}`));
    item.append(el('p', '', `${record.period_label || '统计期'} · ${record.period_start || '日期待确认'} — ${record.period_end || '日期待确认'} · ${record.scope === 'attraction' ? '景点' : record.scope === 'destination' ? '目的地' : '区域'}范围 · ${record.unit === 'person_visits' ? '人次（非去重人数）' : '单位待确认'}`));
    const source = record.source || {};
    const href = url(source.url);
    const link = el(href ? 'a' : 'span', '', source.title || '原始出处待补证');
    if (href) { link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    item.append(link);
    item.append(el('p', '', [source.publisher, source.published_at && `发布 ${source.published_at}`, source.accessed_at && `核对 ${source.accessed_at}`, record.note].filter(Boolean).join(' · ')));
    return item;
  }
  function render(raw, placeId) {
    const host = document.getElementById('visitor-seasonality');
    if (!host) return;
    if (raw?.enabled !== true || raw?.destination_id !== placeId || raw?.schema_version !== 'visitor-seasonality-v1') {
      host.replaceChildren(); host.hidden = true;
      destinationId = null; selectedYear = null;
      return;
    }
    host.hidden = false;
    const data = model(raw?.destination_id === placeId ? raw : null);
    if (destinationId !== placeId || !data.years.includes(selectedYear)) selectedYear = data.years.includes(data.default_year) ? data.default_year : data.years[0];
    destinationId = placeId;
    const wasOpen = host.querySelector('details')?.open || false;
    host.replaceChildren();
    const details = el('details', 'visitation'); details.open = wasOpen;
    details.append(el('summary', '', '客流与热门时段'));
    const body = el('div', 'visitation-body');
    body.append(el('p', 'visitation-note', '公开接待人次（非去重人数）。仅比较同一年已核实的完整月份；帖子数与照片数量不代表游客量，也不是全网热度。'));
    if (!data.years.length) {
      body.append(el('p', 'visitation-empty', '— 待补证：暂无可核实年份的客流资料。')); details.append(body); host.append(details); return;
    }
    const label = el('label', 'visitation-year', '统计年份 ');
    const select = el('select'); select.setAttribute('aria-label', '客流统计年份');
    data.years.forEach((year) => { const option = el('option', '', `${year}年`); option.value = year; option.selected = year === selectedYear; select.append(option); });
    select.addEventListener('change', () => { selectedYear = Number(select.value); render(raw, placeId); host.querySelector('select')?.focus(); });
    label.append(select); body.append(label);
    const cells = data.monthly.filter((cell) => cell.year === selectedYear);
    const max = Math.max(0, ...cells.filter((cell) => cell.eligible).map((cell) => cell.value));
    const sourcePanel = el('section', 'visitation-source-panel'); sourcePanel.setAttribute('aria-live', 'polite'); sourcePanel.setAttribute('aria-label', '所选月份原始出处');
    sourcePanel.append(el('p', '', '选择月份格，查看统计范围与原始出处。'));
    const scroll = el('div', 'visitation-scroll'); scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', '景点月份客流表，可横向滚动');
    const table = el('table', 'visitation-table');
    table.append(el('caption', '', `${selectedYear}年 · 公开接待人次（非去重人数）`));
    const head = el('thead'); const headings = el('tr'); const first = el('th', '', '景点 / 月份'); first.scope = 'col'; headings.append(first);
    for (let month = 1; month <= 12; month++) { const th = el('th', '', `${month}月`); th.scope = 'col'; headings.append(th); } head.append(headings); table.append(head);
    const tbody = el('tbody');
    data.attractions.forEach((attraction) => {
      const row = el('tr'); const title = el('th', '', attraction.name); title.scope = 'row'; row.append(title);
      for (let month = 1; month <= 12; month++) {
        const matching = cells.filter((cell) => cell.attraction_id === attraction.id && cell.month === month);
        const cell = matching.length === 1 ? matching[0] : null;
        const conflict = cell?.status === 'conflict' || matching.length > 1;
        const eligible = cell?.eligible && !conflict;
        const text = eligible ? (cell.display_value || `${cell.value.toLocaleString('zh-CN')} 人次`) : conflict ? '— 冲突待核' : '— 待补证';
        const td = el('td'); const button = el('button', 'visitation-cell', text); button.type = 'button';
        if (eligible) button.dataset.level = String(max === 0 ? 1 : Math.max(1, Math.ceil(cell.value / max * 4)));
        button.setAttribute('aria-label', `${attraction.name}，${selectedYear}年${month}月，${text}，查看出处`);
        button.addEventListener('click', () => {
          host.querySelectorAll('.visitation-cell[aria-pressed]').forEach((node) => node.removeAttribute('aria-pressed'));
          button.setAttribute('aria-pressed', 'true'); sourcePanel.replaceChildren(el('h3', '', `${attraction.name} · ${selectedYear}年${month}月`));
          const ids = matching.flatMap((entry) => list(entry.record_ids));
          const references = data.records.filter((record) => ids.includes(record.id));
          if (!eligible) sourcePanel.append(el('p', '', conflict ? '来源存在冲突，暂不比较客流。' : '— 待补证：暂无可用于比较的完整月份数据；缺失不代表零客流或冷门。'));
          if (references.length) { const sources = el('ul', 'visitation-records'); references.forEach((record) => sources.append(recordNode(record))); sourcePanel.append(sources); }
        });
        td.append(button); row.append(td);
      }
      tbody.append(row);
    });
    table.append(tbody); scroll.append(table); body.append(scroll);
    if (!data.attractions.length) body.append(el('p', 'visitation-empty', '— 待补证：暂无景点月度资料。'));
    body.append(el('p', 'visitation-note', max ? `颜色由浅至深：本年同口径接待人次从低至高，最高 ${max.toLocaleString('zh-CN')} 人次。灰色表示待补证或冲突，不代表冷门。` : '灰色表示待补证或冲突，不代表零客流或冷门。'));
    body.append(sourcePanel);
    const fragments = data.records.filter((record) => record.year === selectedYear && !data.monthly.some((cell) => cell.eligible && list(cell.record_ids).includes(record.id)));
    body.append(el('h3', '', '已公开的客流片段'));
    body.append(el('p', 'visitation-note', '年度、假期及其他统计期单独列出，不分摊为每月客流。'));
    const entries = el('ul', 'visitation-records'); fragments.slice(0, 3).forEach((record) => entries.append(recordNode(record))); body.append(entries);
    if (!fragments.length) body.append(el('p', 'visitation-empty', '— 待补证：该年暂无其他已公开客流片段。'));
    if (fragments.length > 3) { const more = el('details', 'visitation-more'); more.append(el('summary', '', `展开其余 ${fragments.length - 3} 条`)); const rest = el('ul', 'visitation-records'); fragments.slice(3).forEach((record) => rest.append(recordNode(record))); more.append(rest); body.append(more); }
    list(data.notes).forEach((note) => body.append(el('p', 'visitation-note', note)));
    details.append(body); host.append(details);
  }
  document.addEventListener('chinatour:data', (event) => render(event.detail?.visitor_seasonality, event.detail?.destination?.id));
})();
