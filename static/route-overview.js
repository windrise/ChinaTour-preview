/* City-level order diagrams. These never modify or simulate verified road paths. */
(() => {
  'use strict';
  const COLORS = ['#d9916f', '#63aaa5', '#ada0d1'];
  const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
  const text = (value, limit = 600) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const ids = value => Array.isArray(value) ? value.filter(id => typeof id === 'string' && ID.test(id)).slice(0, 100) : [];
  function safeSourceUrl(value) {
    if (typeof value !== 'string' || /\s|\\/.test(value)) return null;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || !url.hostname.includes('.')
          || /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)
          || /^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname) || /\.(?:local|localhost)$/.test(url.hostname)
          || (url.port && !['80', '443'].includes(url.port))
          || [...url.searchParams.keys()].some(key => /token|auth|sign|cookie|session|secret|password|xsec|(?:^|_)key/i.test(key))) return null;
      url.hash = ''; return url.href;
    } catch { return null; }
  }
  function normalizeCity(raw) {
    if (!raw || typeof raw !== 'object' || !raw.map || !/^\/static\/maps\/[a-zA-Z0-9_-]+\.svg$/.test(raw.map.image_url || '')
        || !Number.isFinite(raw.map.width) || !Number.isFinite(raw.map.height)
        || raw.map.width < 100 || raw.map.height < 100 || raw.map.width > 10000 || raw.map.height > 10000) return null;
    const seen = new Set();
    const places = (Array.isArray(raw.places) ? raw.places : []).filter(p => {
      if (!p || !ID.test(p.id || '') || seen.has(p.id) || !text(p.name) || !['attraction', 'food', 'hub'].includes(p.kind)
          || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > raw.map.width || p.y > raw.map.height) return false;
      seen.add(p.id); return true;
    }).map(p => ({id: p.id, name: text(p.name, 100), kind: p.kind, x: p.x, y: p.y,
      summary: text(p.summary), tags: (Array.isArray(p.tags) ? p.tags : []).map(t => text(t, 30)).filter(Boolean).slice(0, 5),
      attraction_name: text(p.attraction_name, 100), source_ids: ids(p.source_ids)}));
    const themeIds = new Set();
    const themes = (Array.isArray(raw.themes) ? raw.themes : []).filter(t => {
      if (!t || !ID.test(t.id || '') || themeIds.has(t.id) || !text(t.title) || !ids(t.stop_ids).length) return false;
      themeIds.add(t.id); return true;
    }).map(t => ({id: t.id, title: text(t.title, 100), subtitle: text(t.subtitle, 160), summary: text(t.summary),
      plan_note: text(t.plan_note), transport_note: text(t.transport_note), stop_ids: ids(t.stop_ids),
      optional_stop_ids: ids(t.optional_stop_ids), walk_route_ids: ids(t.walk_route_ids), source_ids: ids(t.source_ids)}));
    if (!places.length || !themes.length) return null;
    const sources = (Array.isArray(raw.sources) ? raw.sources : []).filter(s => s && ID.test(s.id || '') && safeSourceUrl(s.url))
      .map(s => ({id: s.id, title: text(s.title, 160) || '资料来源', url: safeSourceUrl(s.url),
        published_at: /^\d{4}-\d{2}-\d{2}$/.test(s.published_at || '') ? s.published_at : null,
        checked_at: /^\d{4}-\d{2}-\d{2}$/.test(s.checked_at || '') ? s.checked_at : null}));
    return {title: text(raw.title, 120), intro: text(raw.intro), map: {...raw.map}, places, themes, sources, note: text(raw.note)};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {safeSourceUrl, normalizeCity};
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);
  const root = $('route-overview'); if (!root) return;
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, value, cls) => { const e = document.createElement(tag); if (value != null) e.textContent = value; if (cls) e.className = cls; return e; };
  const shape = (tag, attrs, value) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); if (value != null) e.textContent = value; return e; };
  const assetUrl = value => window.CHINATOUR_PREVIEW ? window.CHINATOUR_PREVIEW.assetUrl(value) : value;
  let data = null, city = null, placeId = null, expectedPlace = null, selectedTheme = 'all', selectedPlace = null;
  let requestVersion = 0, renderVersion = 0, loading = false, catalogPromise = null;
  let initialOverviewAnchor = new URL(location.href).hash === '#route-overview'
    && new URL(location.href).searchParams.get('view') === 'destination';
  const theme = () => city?.themes.find(t => t.id === selectedTheme);
  const place = id => city?.places.find(p => p.id === id);
  const themeColor = t => COLORS[city.themes.indexOf(t) % COLORS.length];
  function settleInitialAnchor() {
    if (!initialOverviewAnchor) return;
    const url = new URL(location.href);
    if (url.hash !== '#route-overview' || url.searchParams.get('view') !== 'destination') { initialOverviewAnchor = false; return; }
    if (!city || root.hidden || document.body.classList.contains('atlas-landing')) return;
    // Only the initial deep link needs a second scroll after its async section
    // becomes visible. Month/filter refreshes must retain the user's position.
    initialOverviewAnchor = false;
    root.scrollIntoView({behavior: 'instant', block: 'start'});
  }
  function clear() {
    ++renderVersion; root.hidden = true; city = null;
    if ($('route-overview-nav')) $('route-overview-nav').href = '#immersive-routes';
    for (const id of ['route-overview-tabs', 'route-overview-map', 'route-overview-panel', 'route-overview-legend']) $(id).replaceChildren();
    $('route-overview-intro').textContent = ''; $('route-overview-status').textContent = '';
  }
  function catalog() {
    if (!catalogPromise) {
      const version = window.CHINATOUR_PREVIEW_META?.assetVersion || window.CHINATOUR_PREVIEW_META?.snapshotAt;
      const url = assetUrl('/static/maps/route-overviews.json') + (version ? '?v=' + encodeURIComponent(version) : '');
      catalogPromise = fetch(url).then(response => { if (!response.ok) throw Error('overview'); return response.json(); });
      catalogPromise.catch(() => { catalogPromise = null; });
    }
    return catalogPromise;
  }
  async function receive(next) {
    const ticket = ++requestVersion;
    const id = next?.destination?.id;
    data = next;
    if (id !== placeId) { selectedTheme = 'all'; selectedPlace = null; }
    placeId = id || null; clear();
    if (!id || loading || (expectedPlace && expectedPlace !== id)) return;
    if (expectedPlace === id) expectedPlace = null;
    try {
      const raw = await catalog();
      if (ticket !== requestVersion || loading || data?.destination?.id !== id) return;
      city = raw?.version === 1 ? normalizeCity(raw.destinations?.[id]) : null;
      if (!city) { initialOverviewAnchor = false; return; }
      if (!theme()) selectedTheme = 'all';
      if (!place(selectedPlace)) selectedPlace = null;
      root.hidden = false;
      if ($('route-overview-nav')) $('route-overview-nav').href = '#route-overview';
      render(); settleInitialAnchor();
    } catch { if (ticket === requestVersion) clear(); }
  }
  function selectTheme(id, focus = false) {
    if (!city || loading) return;
    selectedTheme = id === 'all' || city.themes.some(t => t.id === id) ? id : 'all';
    selectedPlace = null; render();
    if (focus) [...$('route-overview-tabs').children].find(b => b.dataset.theme === selectedTheme)?.focus();
  }
  function selectPlace(id, keyboard = false) {
    if (!place(id) || loading) return;
    selectedPlace = id; renderMap(); renderPanel();
    const panel = $('route-overview-panel'), detail = panel.querySelector('.ro-place-detail');
    // Scroll only the details pane; the map stays in place while browsing points.
    if (detail) panel.scrollTop = Math.max(0, detail.offsetTop - 12);
    if (keyboard) [...$('route-overview-map').querySelectorAll('.ro-poi')].find(p => p.dataset.place === id)?.focus({preventScroll: true});
    $('route-overview-status').textContent = `已选择${place(id).name}，地点亮点与资料来源已更新。`;
  }
  function renderTabs() {
    const tabs = $('route-overview-tabs'); tabs.replaceChildren();
    const choices = [{id: 'all', title: '全城总览'}, ...city.themes];
    choices.forEach((t, i) => {
      const b = el('button', null, 'ro-tab'); b.type = 'button'; b.id = `route-overview-tab-${i}`; b.dataset.theme = t.id;
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(selectedTheme === t.id));
      b.setAttribute('aria-controls', 'route-overview-content'); b.tabIndex = selectedTheme === t.id ? 0 : -1;
      b.style.setProperty('--ro-accent', i ? COLORS[(i - 1) % COLORS.length] : '#c8d2bf');
      if (i) b.append(el('span', String(i).padStart(2, '0'), 'ro-tab-number'));
      b.append(el('span', t.title)); b.addEventListener('click', () => selectTheme(t.id, true));
      b.addEventListener('keydown', event => {
        const next = event.key === 'ArrowRight' ? (i + 1) % choices.length : event.key === 'ArrowLeft' ? (i + choices.length - 1) % choices.length : event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : null;
        if (next !== null) { event.preventDefault(); selectTheme(choices[next].id, true); }
      });
      if (selectedTheme === t.id) $('route-overview-content').setAttribute('aria-labelledby', b.id);
      tabs.append(b);
    });
  }
  function renderMap() {
    const svg = $('route-overview-map'), chosen = theme(), token = ++renderVersion;
    svg.replaceChildren(); svg.setAttribute('viewBox', `0 0 ${city.map.width} ${city.map.height}`);
    svg.setAttribute('aria-label', `${city.title || data.destination.name}：地点分布，虚线仅表示游览顺序，不是导航路线`);
    const base = shape('image', {href: assetUrl(city.map.image_url), width: city.map.width, height: city.map.height});
    $('route-overview-map-error').hidden = true;
    base.addEventListener('error', () => { if (token === renderVersion) $('route-overview-map-error').hidden = false; });
    svg.append(shape('title', {}, '城市地点分布与游览顺序示意，非导航'), base);
    if (chosen) {
      const defs = shape('defs'); const marker = shape('marker', {id: 'ro-direction-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 4, markerHeight: 4, orient: 'auto'});
      marker.append(shape('path', {d: 'M0 0 L10 5 L0 10 Z', fill: themeColor(chosen)})); defs.append(marker); svg.append(defs);
      // Never connect over a missing point, and never join optional detours.
      chosen.stop_ids.slice(0, -1).forEach((id, i) => {
        const a = place(id), b = place(chosen.stop_ids[i + 1]); if (!a || !b) return;
        const length = Math.hypot(b.x - a.x, b.y - a.y); if (length <= 60) return;
        const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
        svg.append(shape('path', {d: `M${a.x + dx * 25},${a.y + dy * 25} L${b.x - dx * 30},${b.y - dy * 30}`,
          class: 'ro-order-line', fill: 'none', stroke: themeColor(chosen), 'marker-end': 'url(#ro-direction-arrow)', 'aria-hidden': 'true'}));
      });
    }
    const activeIds = new Set(chosen ? [...chosen.stop_ids, ...chosen.optional_stop_ids] : city.places.map(p => p.id));
    const ordered = [...city.places].sort((a, b) => Number(a.id === selectedPlace) - Number(b.id === selectedPlace));
    const labelBoxes = [], labels = [], fontSize = chosen ? 23 : 18;
    const priority = [...city.places].sort((a, b) => Number(b.id === selectedPlace) - Number(a.id === selectedPlace) || Number(activeIds.has(b.id)) - Number(activeIds.has(a.id)));
    for (const p of priority) {
      if (!activeIds.has(p.id) && p.id !== selectedPlace) continue;
      const name = p.kind === 'hub' && /机场/.test(p.name)
        ? p.name.replace(new RegExp('^' + (data.destination.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '').replace('国际机场', '机场') : p.name;
      const width = name.length * fontSize + 14, height = fontSize + 12;
      const fits = b => b.x >= 12 && b.y >= 12 && b.x + width <= city.map.width - 12 && b.y + height <= city.map.height - 12
        && !labelBoxes.some(a => b.x < a.x + a.width + 7 && b.x + width + 7 > a.x && b.y < a.y + a.height + 5 && b.y + height + 5 > a.y)
        && !city.places.some(a => Math.abs(a.x - (b.x + width / 2)) < width / 2 + 24 && Math.abs(a.y - (b.y + height / 2)) < height / 2 + 24);
      const candidates = [];
      for (const gap of [32, 56, 86, 126, 176]) {
        candidates.push([p.x + gap, p.y - height / 2], [p.x - width - gap, p.y - height / 2],
          [p.x - width / 2, p.y - height - gap], [p.x - width / 2, p.y + gap],
          [p.x + gap, p.y - height - gap], [p.x - width - gap, p.y - height - gap],
          [p.x + gap, p.y + gap], [p.x - width - gap, p.y + gap]);
      }
      let box = candidates.map(([x, y]) => ({x, y, width, height})).find(fits);
      if (!box) {
        // Crowded districts use the nearest remaining clear label slot with a leader.
        const slots = [];
        for (let y = 12; y + height <= city.map.height - 12; y += height + 6)
          for (let x = 12; x + width <= city.map.width - 12; x += 28) {
            const b = {x, y, width, height}; if (fits(b)) slots.push(b);
          }
        box = slots.sort((a, b) => Math.hypot(a.x + width / 2 - p.x, a.y + height / 2 - p.y) - Math.hypot(b.x + width / 2 - p.x, b.y + height / 2 - p.y))[0];
      }
      if (box) { labelBoxes.push(box); labels.push({p, box, name}); }
    }
    for (const {p, box} of labels) {
      const x = Math.max(box.x, Math.min(p.x, box.x + box.width)), y = Math.max(box.y, Math.min(p.y, box.y + box.height));
      if (Math.hypot(x - p.x, y - p.y) > 28)
        svg.append(shape('path', {d: `M${p.x},${p.y} L${x},${y}`, class: 'ro-label-leader', 'aria-hidden': 'true'}));
    }
    for (const p of ordered) {
      const inTheme = activeIds.has(p.id), selected = selectedPlace === p.id;
      const owner = chosen && inTheme ? chosen : city.themes.find(t => [...t.stop_ids, ...t.optional_stop_ids].includes(p.id));
      const color = owner ? themeColor(owner) : '#899da0';
      const g = shape('g', {class: `ro-poi${inTheme ? '' : ' is-muted'}${selected ? ' is-selected' : ''}`, role: 'button', tabindex: '0', 'aria-label': `${p.name}，查看亮点与来源`, 'aria-pressed': String(selected)});
      g.dataset.place = p.id;
      g.append(shape('circle', {cx: p.x, cy: p.y, r: 44, fill: 'transparent', class: 'ro-poi-hit'}));
      if (selected) g.append(shape('circle', {cx: p.x, cy: p.y, r: 33, class: 'ro-poi-halo', fill: color}));
      g.append(shape('circle', {cx: p.x, cy: p.y, r: selected ? 22 : 19, fill: color, class: 'ro-poi-dot'}));
      const index = chosen?.stop_ids.indexOf(p.id) ?? -1;
      g.append(shape('text', {x: p.x, y: p.y + 7, 'text-anchor': 'middle', class: 'ro-poi-number', 'aria-hidden': 'true'}, index >= 0 ? index + 1 : p.kind === 'food' ? '食' : p.kind === 'hub' ? /机场/.test(p.name) ? '空' : '站' : '·'));
      g.addEventListener('click', () => selectPlace(p.id));
      g.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); selectPlace(p.id, true); } });
      svg.append(g);
    }
    for (const {box, name} of labels) {
      const g = shape('g', {class: 'ro-map-label', 'pointer-events': 'none', 'aria-hidden': 'true'});
      g.append(shape('rect', {x: box.x, y: box.y, width: box.width, height: box.height, rx: 5}),
        shape('text', {x: box.x + 7, y: box.y + fontSize + 3, style: `font-size:${fontSize}px`}, name)); svg.append(g);
    }
    const legend = $('route-overview-legend'); legend.replaceChildren();
    for (const t of city.themes) { const item = el('span', t.title); item.style.setProperty('--ro-accent', themeColor(t)); legend.append(item); }
    $('route-overview-order-note').textContent = chosen ? '虚线＝游览顺序示意，非导航；交通方式见线路说明。' : '颜色对应主题线路 · 点选地点看亮点与资料';
  }
  function sourcesFor(sourceIds) {
    const rows = [...new Set(sourceIds || [])].map(id => city.sources.find(s => s.id === id)).filter(Boolean);
    if (!rows.length) return null;
    const details = el('details', null, 'ro-sources'); details.append(el('summary', `资料来源 · ${rows.length}`));
    for (const source of rows) {
      const link = el('a', `${source.title} ↗`); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const row = el('div'); row.append(link);
      row.append(el('small', [source.published_at ? `发布 ${source.published_at}` : '', source.checked_at ? `核对 ${source.checked_at}` : ''].filter(Boolean).join(' · ')));
      details.append(row);
    }
    return details;
  }
  function walkButtons(target, themeIds, attractionName = null) {
    const available = new Map((data?.immersive_routes?.items || []).filter(r => r.geometry_kind === 'osm_network').map(r => [r.id, r]));
    const routeIds = [...new Set(themeIds.flatMap(id => city.themes.find(t => t.id === id)?.walk_route_ids || []))];
    for (const id of routeIds) {
      const route = available.get(id);
      if (!route || (attractionName && !(route.nodes || []).some(n => n.attraction_name === attractionName))) continue;
      const button = el('button', `进入局部路线漫游 ↗`, 'ro-walk-button'); button.type = 'button'; button.dataset.walk = id;
      button.append(el('small', route.title));
      button.addEventListener('click', () => {
        if (!loading && data?.destination?.id === placeId && (data.immersive_routes?.items || []).some(r => r.id === id && r.geometry_kind === 'osm_network'))
          document.dispatchEvent(new CustomEvent('chinatour:walk-open', {detail: {placeId, routeId: id}}));
      });
      target.append(button);
    }
  }
  function renderPanel() {
    const panel = $('route-overview-panel'); panel.replaceChildren(); const chosen = theme();
    if (chosen) {
      const heading = el('div', null, 'ro-plan-head'); heading.style.setProperty('--ro-accent', themeColor(chosen));
      heading.append(el('span', chosen.subtitle || '主题行程', 'ro-kicker'), el('h3', chosen.title), el('p', chosen.summary)); panel.append(heading);
      const facts = el('div', null, 'ro-plan-facts');
      if (chosen.plan_note) facts.append(el('p', chosen.plan_note));
      if (chosen.transport_note) facts.append(el('p', chosen.transport_note));
      panel.append(facts);
      const stops = el('ol', null, 'ro-stop-list');
      chosen.stop_ids.forEach((id, index) => { const p = place(id); if (!p) return;
        const item = el('li'), b = el('button', null, 'ro-stop'); b.type = 'button'; b.dataset.place = id;
        b.setAttribute('aria-pressed', String(id === selectedPlace)); b.append(el('span', String(index + 1).padStart(2, '0')), el('strong', p.name));
        b.addEventListener('click', () => selectPlace(id)); item.append(b); stops.append(item); });
      panel.append(stops);
      if (chosen.optional_stop_ids.some(id => place(id))) {
        const optional = el('div', null, 'ro-optional'); optional.append(el('span', '顺路可选'));
        for (const id of chosen.optional_stop_ids) { const p = place(id); if (!p) continue; const b = el('button', p.name); b.type = 'button'; b.addEventListener('click', () => selectPlace(id)); optional.append(b); }
        panel.append(optional);
      }
      if (!selectedPlace) walkButtons(panel, [chosen.id]);
      const sources = sourcesFor(chosen.source_ids); if (sources) panel.append(sources);
    } else if (!selectedPlace) {
      panel.append(el('p', '从喜欢的玩法开始', 'ro-kicker'));
      city.themes.forEach((t, index) => {
        const card = el('button', null, 'ro-theme-card'); card.type = 'button'; card.dataset.theme = t.id;
        card.style.setProperty('--ro-accent', themeColor(t));
        card.append(el('span', String(index + 1).padStart(2, '0'), 'ro-card-number'), el('strong', t.title), el('small', t.subtitle || `${t.stop_ids.length} 个停靠点`), el('p', t.summary));
        card.addEventListener('click', () => selectTheme(t.id)); panel.append(card);
      });
    }
    const selected = place(selectedPlace);
    if (selected) {
      const detail = el('section', null, 'ro-place-detail'); detail.setAttribute('aria-label', `${selected.name}的亮点与资料`);
      const header = el('div', null, 'ro-place-header'), back = el('button', '×', 'ro-place-close'); back.type = 'button'; back.setAttribute('aria-label', '收起地点详情');
      back.addEventListener('click', () => { selectedPlace = null; renderMap(); renderPanel(); });
      header.append(el('h3', selected.name), back); detail.append(header);
      const tags = el('div', null, 'ro-tags'); selected.tags.forEach(t => tags.append(el('span', t))); detail.append(tags);
      if (selected.summary) detail.append(el('p', selected.summary, 'ro-place-summary'));
      const attraction = (data?.attractions || []).find(a => a.name === selected.attraction_name);
      if (attraction) {
        const album = el('button', '看月份照片与资料 ↗', 'ro-album-button'); album.type = 'button';
        album.addEventListener('click', () => {
          if (!loading && (data?.attractions || []).some(a => a.name === selected.attraction_name))
            document.dispatchEvent(new CustomEvent('chinatour:open-attraction', {detail: {placeId, attractionName: selected.attraction_name}}));
        }); detail.append(album);
        walkButtons(detail, city.themes.filter(t => [...t.stop_ids, ...t.optional_stop_ids].includes(selected.id)).map(t => t.id), attraction.name);
      }
      const sources = sourcesFor(selected.source_ids); if (sources) detail.append(sources);
      panel.append(detail);
    }
  }
  function render() {
    $('route-overview-title').textContent = city.title || '先看这座城怎么逛';
    $('route-overview-intro').textContent = city.intro;
    $('route-overview-footnote').textContent = city.note || '主题分组和推荐游览顺序，不是已核验交通路线。';
    renderTabs(); renderMap(); renderPanel();
  }
  document.addEventListener('chinatour:data', e => receive(e.detail));
  document.addEventListener('atlas:entered', settleInitialAnchor);
  document.addEventListener('chinatour:place-selected', e => { initialOverviewAnchor = false; expectedPlace = e.detail?.placeId || null; data = null; placeId = null; ++requestVersion; clear(); });
  document.addEventListener('chinatour:loading', e => {
    loading = Boolean(e.detail?.loading);
    if (loading) { ++requestVersion; clear(); } else receive(data);
  });
})();
