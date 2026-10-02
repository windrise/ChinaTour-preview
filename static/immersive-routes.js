/* Source-bound route browsing. Photos remain in the existing reviewed albums. */
(() => {
  'use strict';
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, Number(value) || 0));
  const httpUrl = value => {
    try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; }
    catch { return null; }
  };
  function projection(bounds) {
    const [south, west, north, east] = bounds;
    const cosine = Math.cos((south + north) * Math.PI / 360);
    const width = (east - west) * cosine, height = north - south;
    const scale = Math.min(850 / width, 520 / height);
    return ([lon, lat]) => [500 + (lon - (west + east) / 2) * cosine * scale,
      350 - (lat - (south + north) / 2) * scale];
  }
  function routeTrack(points) {
    const distances = [0];
    for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    const length = distances.at(-1) || 1;
    return { points, stops: distances.map(d => d / length), length };
  }
  function positionAt(track, progress) {
    const p = clamp(progress, 0, 1), { points, stops } = track;
    let segment = Math.max(0, stops.findIndex((stop, i) => i > 0 && stop >= p) - 1);
    if (p >= 1) segment = points.length - 2;
    const fraction = (p - stops[segment]) / (stops[segment + 1] - stops[segment] || 1);
    const point = points[segment].map((v, axis) => v + (points[segment + 1][axis] - v) * fraction);
    const nearest = fraction < 0.5 ? segment : segment + 1;
    return { point, segment, nearest, atNode: Math.abs(p - stops[nearest]) < 0.002,
      walked: [...points.slice(0, segment + 1), point] };
  }
  function timeLabel(item, media, month) {
    if (item.browse_time_basis === 'publication_month') return `${item.browse_year ? item.browse_year + '年' : ''}${month}月发布 · 拍摄时间未知`;
    if (item.time_basis === 'author_relative_date') return `原帖相对日期推算：${item.observed_start || '未确认'} · 非逐图核验`;
    if (item.observed_start) return `原文到访时间：${item.observed_start} · 照片未独立核验`;
    if (item.month) return `${item.year ? item.year + '年' : '年份未知 · '}${item.month}月 · 原文到访月份`;
    return media.time_label || '拍摄时间未知';
  }
  function selectPhotos(data, node, month) {
    const attraction = (data?.attractions || []).find(a => a.name === node.attraction_name && (!node.attraction_id || a.id === node.attraction_id));
    if (!attraction) return [];
    const evidence = (data.evidence || []).filter(e => e.place_id === attraction.id && Number(e.browse_month || e.month) === Number(month));
    const photos = [], seen = new Set();
    const add = (media, item) => {
      // Server review, exact place, month selection and byte checks remain authoritative.
      if (!media || media.display_eligible !== true || media.publication_review?.status !== 'approved' || media.scene_hint?.reason === 'prominent_non_landscape_subject') return;
      if (!/^\/api\/media\/[a-f0-9]{24}$/i.test(media.url || '') || seen.has(media.url)) return;
      seen.add(media.url);
      photos.push({ url: media.url, sourceUrl: httpUrl(media.source_url || item.url),
        credit: media.publisher || item.publisher || '原帖照片', time: timeLabel(item, media, month),
        period: media.visit_period?.label || item.visit_period?.label || '到访时段未确认',
        basis: item.browse_time_basis === 'publication_month' ? '发布月参考' : item.month ? '现场月资料' : '时间待确认' });
    };
    evidence.forEach(e => (e.media || []).forEach(m => add(m, e)));
    for (const group of Object.values(attraction.visit_periods || {})) {
      for (const media of group.photos || []) {
        // These groups are constructed for the selected month by destination_view.
        const item = evidence.find(e => e.id === media.evidence_id) || media;
        add(media, item);
      }
    }
    return photos;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { projection, routeTrack, positionAt, selectPhotos, timeLabel };
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  const dialog = $('walk-dialog');
  if (!dialog) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mapCache = new Map();
  let data = null, routes = [], route = null, track = null, progress = 0, sceneIndex = -1;
  let photos = [], photoIndex = 0, playing = false, timer = null, lastFrame = null;
  let mapVersion = 0, zoom = 1, loading = false, pendingOpen = false, returnFocus = null;
  let photoVersion = 0;
  const svg = $('walk-map');
  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, text, className) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; return e; };
  const shape = (tag, attrs = {}, text) => { const e = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const path = points => points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  const assetUrl = value => window.CHINATOUR_PREVIEW ? window.CHINATOUR_PREVIEW.assetUrl(value) : value;
  const mediaUrl = value => window.CHINATOUR_PREVIEW ? window.CHINATOUR_PREVIEW.mediaUrl(value) : value;
  const month = () => Number(data?.browse_month || new URLSearchParams(location.search).get('month') || new Date().getMonth() + 1);
  function writeLocation(value) {
    const url = new URL(location.href);
    if (value) url.searchParams.set('walk', value); else url.searchParams.delete('walk');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  function setPlaying(value) {
    playing = Boolean(value && route && track && !loading && dialog.open);
    clearTimeout(timer); timer = null; lastFrame = null;
    $('walk-play').textContent = playing ? 'Ⅱ 暂停' : progress >= 1 ? '↺ 重播' : '▶ 播放';
    $('walk-play').setAttribute('aria-label', playing ? '暂停路线' : '播放路线');
    $('walk-play').setAttribute('aria-pressed', String(playing));
    if (playing) { lastFrame = performance.now(); timer = setTimeout(tick, motion.matches ? 1800 : 40); }
  }
  function tick() {
    if (!playing || document.hidden) return setPlaying(false);
    if (motion.matches) {
      const next = track.stops.find(p => p > progress + 0.002);
      setProgress(next == null ? 1 : next, false);
    } else {
      const now = performance.now();
      setProgress(progress + Math.min(now - lastFrame, 200) / 24000, false); lastFrame = now;
    }
    if (progress >= 1) setPlaying(false);
    else timer = setTimeout(tick, motion.matches ? 1800 : 40);
  }
  function hidePhoto(message) {
    ++photoVersion;
    $('walk-photo').onload = null; $('walk-photo').onerror = null;
    $('walk-photo').hidden = true; $('walk-photo').removeAttribute('src');
    $('walk-photo').alt = '';
    $('walk-photo-empty').hidden = false; $('walk-photo-empty-note').textContent = message;
    $('walk-photo-source').hidden = true; $('walk-photo-meta').textContent = '';
    $('walk-photo-source').removeAttribute('href'); $('walk-photo-count').textContent = '';
    $('walk-photo-controls').hidden = true;
  }
  function renderPhoto() {
    const photo = photos[photoIndex];
    if (!photo) return hidePhoto(`${month()}月暂无此节点的合格实拍，切换月份可查看其他已收录资料。`);
    const url = mediaUrl(photo.url);
    if (!url) return hidePhoto('这张已审核照片的缓存暂不可用。');
    const img = $('walk-photo');
    const version = ++photoVersion;
    img.hidden = true; $('walk-photo-empty').hidden = false; $('walk-photo-empty-note').textContent = '正在读取已审核实拍…';
    img.alt = `${route.nodes[sceneIndex].name} · ${photo.time}`;
    img.onload = () => { if (version !== photoVersion || img.getAttribute('src') !== url || !dialog.open || loading) return; img.hidden = false; $('walk-photo-empty').hidden = true; };
    img.onerror = () => {
      if (version !== photoVersion || img.getAttribute('src') !== url) return;
      hidePhoto(photos.length > 1 ? '这张照片暂时无法加载，试试下一张。' : '这张照片暂时无法加载；可切换节点或月份。');
      $('walk-photo-controls').hidden = photos.length < 2;
      $('walk-photo-count').textContent = `${photoIndex + 1} / ${photos.length}`;
    };
    img.src = url;
    $('walk-photo-meta').textContent = `${photo.basis} · ${photo.time}。${photo.period}。摄影来源：${photo.credit}`;
    const source = $('walk-photo-source'); source.hidden = !photo.sourceUrl;
    if (photo.sourceUrl) source.href = photo.sourceUrl; else source.removeAttribute('href');
    $('walk-photo-count').textContent = `${photoIndex + 1} / ${photos.length}`;
    $('walk-photo-controls').hidden = photos.length < 2;
  }
  function renderScene(index, atNode) {
    const node = route.nodes[index];
    if (sceneIndex !== index) {
      sceneIndex = index; photoIndex = 0; photos = selectPhotos(data, node, month());
      $('walk-place-name').textContent = node.name;
      renderPhoto();
      $('walk-status').textContent = `当前参考节点：${node.name}，${photos.length ? '有已审核实拍' : '暂无本月合格照片'}`;
    }
    $('walk-scene-kicker').textContent = `NODE ${String(index + 1).padStart(2, '0')} / ${String(route.nodes.length).padStart(2, '0')} · ${atNode ? '抵达节点' : '最近节点实拍参考'}`;
    $('walk-scene-note').textContent = [atNode ? '' : '正在节点之间浏览，照片属于此参考节点，不是当前位置的沿线实拍。', node.note].filter(Boolean).join(' ');
  }
  function setProgress(value, manual = true) {
    if (!route || !track || loading) return;
    if (manual) setPlaying(false);
    progress = clamp(value, 0, 1);
    const pos = positionAt(track, progress);
    svg.querySelector('.walk-route-progress')?.setAttribute('d', path(pos.walked));
    const cursor = svg.querySelector('.walk-cursor');
    if (cursor) { cursor.setAttribute('cx', pos.point[0]); cursor.setAttribute('cy', pos.point[1]); }
    const position = pos.atNode ? route.nodes[pos.nearest].name : `${route.nodes[pos.segment].name} → ${route.nodes[pos.segment + 1].name}`;
    $('walk-position').textContent = position;
    $('walk-percent').value = `${Math.round(progress * 100)}%`;
    const slider = $('walk-progress'); slider.value = Math.round(progress * 1000);
    slider.style.setProperty('--walk-progress', `${progress * 100}%`);
    slider.setAttribute('aria-valuetext', `${Math.round(progress * 100)}%，${position}，节点连接示意`);
    const active = pos.atNode ? pos.nearest : -1;
    [...$('walk-stop-list').children].forEach((button, i) => { button.classList.toggle('active', i === active); button.setAttribute('aria-pressed', String(i === active)); });
    svg.querySelectorAll('.walk-node').forEach((node, i) => { node.classList.toggle('active', i === active); node.classList.toggle('is-visited', progress >= track.stops[i]); node.setAttribute('aria-pressed', String(i === active)); });
    renderScene(pos.nearest, pos.atNode);
    if (zoom > 1) applyZoom();
    if (!playing) $('walk-play').textContent = progress >= 1 ? '↺ 重播' : '▶ 播放';
  }
  function geometryPath(geometry, project) {
    if (!geometry) return '';
    const line = coords => path(coords.map(project));
    if (geometry.type === 'LineString') return line(geometry.coordinates);
    if (geometry.type === 'MultiLineString') return geometry.coordinates.map(line).join(' ');
    if (geometry.type === 'Polygon') return geometry.coordinates.map(c => line(c) + ' Z').join(' ');
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.flatMap(p => p.map(c => line(c) + ' Z')).join(' ');
    return '';
  }
  function applyZoom() {
    const current = track ? positionAt(track, progress).point : [500, 350];
    let frame = { x: 0, y: 0, width: 1000, height: 700 };
    if (track && svg.clientWidth > 0 && svg.clientHeight > 0) {
      const xs = track.points.map(p => p[0]), ys = track.points.map(p => p[1]);
      const west = Math.min(...xs), east = Math.max(...xs), north = Math.min(...ys), south = Math.max(...ys);
      const aspect = svg.clientWidth / svg.clientHeight;
      const width = Math.max(east - west + 240, (south - north + 160) * aspect);
      frame = { x: (west + east - width) / 2, y: (north + south - width / aspect) / 2, width, height: width / aspect };
    }
    const width = frame.width / zoom, height = frame.height / zoom;
    const x = zoom === 1 ? frame.x : clamp(current[0] - width / 2, frame.x, frame.x + frame.width - width);
    const y = zoom === 1 ? frame.y : clamp(current[1] - height / 2, frame.y, frame.y + frame.height - height);
    svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    $('walk-zoom-in').disabled = zoom >= 3; $('walk-zoom-out').disabled = zoom <= 1;
  }
  function drawRoute(project) {
    const points = route.nodes.map(n => project([n.lon, n.lat]));
    track = routeTrack(points);
    svg.append(shape('path', { d: path(points), class: 'walk-route-base', fill: 'none' }), shape('path', { class: 'walk-route-progress', fill: 'none' }));
    route.nodes.forEach((node, i) => {
      const [x, y] = points[i];
      const g = shape('g', { class: 'walk-node', tabindex: '0', role: 'button', 'aria-label': `浏览第${i + 1}站：${node.name}` });
      g.append(shape('circle', { cx: x, cy: y, r: 25, class: 'walk-node-hit', fill: 'transparent' }), shape('circle', { cx: x, cy: y, r: 16, class: 'walk-node-dot' }), shape('text', { x, y: y + 5, 'text-anchor': 'middle', 'aria-hidden': 'true' }, i + 1));
      const label = shape('text', { x: x + (x > 650 ? -26 : 26), y: y + 5, 'text-anchor': x > 650 ? 'end' : 'start', class: 'walk-node-label', 'aria-hidden': 'true' }, node.name);
      g.append(label);
      const visit = () => { setProgress(track.stops[i]); if (zoom > 1) applyZoom(); };
      g.addEventListener('click', visit);
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); visit(); } });
      svg.append(g);
    });
    svg.append(shape('circle', { r: 8, class: 'walk-cursor', 'pointer-events': 'none' }));
    applyZoom(); setProgress(progress, false);
    syncControls();
  }
  async function renderMap() {
    const version = ++mapVersion, selected = route;
    track = null; svg.replaceChildren(shape('title', {}, `${route.title}，真实底图与节点连接示意`));
    const project = projection(route.bounds);
    const base = shape('g', { class: 'walk-geography', 'aria-hidden': 'true' }); svg.append(base);
    drawRoute(project);
    $('walk-map').setAttribute('aria-busy', 'true');
    try {
      if (!mapCache.has(selected.map_url)) {
        const promise = fetch(assetUrl(selected.map_url)).then(response => { if (!response.ok) throw Error('map'); return response.json(); });
        mapCache.set(selected.map_url, promise);
        promise.catch(() => mapCache.delete(selected.map_url));
      }
      const geo = await mapCache.get(selected.map_url);
      if (version !== mapVersion || route !== selected) return;
      const order = ['wood', 'park', 'water', 'beach', 'rail', 'road', 'path'];
      const colors = { wood: '#c7d5bc', park: '#d4dfc6', water: '#a9ced1', beach: '#e9d4a9', rail: '#b0b1aa', road: '#fcfbf6', path: '#a7ab91' };
      const features = (geo.features || []).filter(f => order.includes(f.properties?.kind)).sort((a, b) => order.indexOf(a.properties.kind) - order.indexOf(b.properties.kind));
      const labels = new Set();
      for (const f of features) {
        const d = geometryPath(f.geometry, project); if (!d) continue;
        const kind = f.properties.kind, area = /Polygon/.test(f.geometry.type);
        const p = shape('path', { d, fill: area ? colors[kind] : 'none', 'fill-rule': 'evenodd', stroke: area ? 'none' : colors[kind], 'stroke-width': kind === 'road' ? 3 : kind === 'water' ? 2.5 : 1.2, 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round', class: `walk-feature-${kind}` });
        if (kind === 'path' || kind === 'rail') p.setAttribute('stroke-dasharray', '3 3');
        base.append(p);
        // A few real road names provide orientation without a dense POI layer.
        if (kind === 'road' && f.properties.name && !labels.has(f.properties.name) && labels.size < 12 && f.geometry.type === 'LineString') {
          const c = f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)], [x, y] = project(c);
          if (x > 70 && x < 930 && y > 100 && y < 630 && !track.points.some(pt => Math.hypot(pt[0] - x, pt[1] - y) < 100)) {
            base.append(shape('text', { x, y, fill: '#777d6d', 'font-size': 13, 'text-anchor': 'middle' }, f.properties.name)); labels.add(f.properties.name);
          }
        }
      }
      $('walk-map').setAttribute('aria-busy', 'false');
    } catch {
      if (version !== mapVersion) return;
      $('walk-map').setAttribute('aria-busy', 'false');
      base.append(shape('text', { x: 500, y: 100, 'text-anchor': 'middle', fill: '#61695d', 'font-size': 18 }, '底图暂未加载 · 当前仅显示节点连接示意'));
    }
  }
  function renderDetails() {
    const content = $('walk-details-content'); content.replaceChildren();
    for (const text of [route.summary, '节点连接示意，不代表可通行的道路或园内路线；坐标是地点代表点，不是导航入口。', '实际步行长度、预计步行时间：待核实。', route.note]) if (text) content.append(el('p', text));
    for (const source of route.sources || []) {
      const url = httpUrl(source.url); if (!url) continue;
      const a = el('a', `${source.title || '路线原帖'} ↗`); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; content.append(a);
    }
    const nodeSources = el('ul');
    for (const node of route.nodes) {
      const li = el('li', `${node.name} · `), url = httpUrl(node.coordinate_source?.url);
      if (url) { const a = el('a', node.coordinate_source.label || '坐标来源'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a); }
      nodeSources.append(li);
    }
    content.append(nodeSources, el('p', '底图仅保留已有 OSM 地形、道路与步道要素。缺失要素不补画，路线未核验现行开放情况。照片沿用当前城市、月份和资料范围的审核结果；发布月参考不代表拍摄月。'));
  }
  function chooseRoute(id, preserve = false) {
    setPlaying(false);
    const next = routes.find(r => r.id === id) || routes[0]; if (!next) return;
    const same = route?.id === next.id;
    route = next; progress = preserve && same ? progress : 0; sceneIndex = -1; zoom = preserve && same ? zoom : 1;
    $('walk-title').textContent = `${data.destination.name} · 路线漫游`;
    $('walk-context').textContent = '地图里的路径，镜头里的风景。';
    $('walk-month').value = String(month());
    $('walk-stop-list').replaceChildren();
    route.nodes.forEach((node, i) => { const button = el('button', null, 'walk-stop'); button.type = 'button'; button.append(el('small', String(i + 1).padStart(2, '0')), el('span', node.name)); button.addEventListener('click', () => { if (track) { setProgress(track.stops[i]); applyZoom(); } }); $('walk-stop-list').append(button); });
    [...$('walk-route-options').children].forEach(button => { const active = button.dataset.route === route.id; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    renderDetails(); renderMap();
    $('walk-hint').textContent = motion.matches ? '已减少动态效果 · 播放时逐站切换，也可用方向键浏览' : '拖动或用方向键来回浏览 · 点击节点直达';
    if (dialog.open) writeLocation(route.id);
  }
  function openWalk() {
    if (loading || !routes.length) return;
    if (!dialog.open) { returnFocus = document.activeElement; dialog.showModal(); document.body.classList.add('walk-opened'); }
    const requested = new URLSearchParams(location.search).get('walk');
    chooseRoute(requested || route?.id, true);
    $('walk-close').focus({ preventScroll: true });
  }
  function updateEntry() {
    const configured = data?.immersive_routes?.available_destinations || [];
    const available = configured.filter(city => !window.CHINATOUR_PREVIEW_META?.places || window.CHINATOUR_PREVIEW_META.places.some(p => (p.id || p) === city.id));
    const target = available[0];
    $('walk-open').disabled = loading || (!routes.length && !target);
    $('walk-open').textContent = loading ? '读取路线…' : routes.length ? `开始漫游 · ${routes.length} 条路线 ↗` : target ? `浏览${target.name}路线 ↗` : '路线资料待补充';
    $('walk-entry-note').textContent = routes.length ? `${data.destination.name} · 拖动路线，看地图，也看沿途真实照片。` : target ? `先从${target.name}出发，用地图与实拍认识一条路。` : '此目的地暂未配置有来源的漫游路线。';
    return target;
  }
  function syncControls() {
    const disabled = loading || !route || !track;
    for (const id of ['walk-play', 'walk-progress', 'walk-restart', 'walk-photo-next', 'walk-photo-prev', 'walk-fit']) $(id).disabled = disabled;
    $('walk-zoom-in').disabled = disabled || zoom >= 3;
    $('walk-zoom-out').disabled = disabled || zoom <= 1;
  }
  function receive(next) {
    data = next; routes = data?.immersive_routes?.items || [];
    $('walk-route-options').replaceChildren();
    for (const item of routes) {
      const button = el('button', null, 'walk-route-option'); button.type = 'button'; button.dataset.route = item.id;
      button.append(el('span', item.route_type === 'scenicwalk' ? '景区 WALK' : 'CITY WALK'), el('strong', item.title), el('small', item.subtitle || `${item.nodes.length} 个节点 · 连接示意`));
      button.addEventListener('click', () => chooseRoute(item.id)); $('walk-route-options').append(button);
    }
    updateEntry();
    if (!routes.length) {
      setPlaying(false); route = null; track = null; ++mapVersion; svg.replaceChildren();
      progress = 0; photos = []; photoIndex = 0; sceneIndex = -1;
      $('walk-progress').value = 0; $('walk-percent').value = '0%';
      $('walk-progress').style.setProperty('--walk-progress', '0%');
      $('walk-progress').setAttribute('aria-valuetext', '路线资料暂不可用');
      $('walk-position').textContent = '路线资料暂不可用';
      hidePhoto('当前资料不可用，可切换月份重试。'); $('walk-place-name').textContent = '路线资料暂不可用';
      $('walk-scene-kicker').textContent = ''; $('walk-scene-note').textContent = ''; $('walk-stop-list').replaceChildren(); $('walk-details-content').replaceChildren();
      syncControls();
      return;
    }
    if (dialog.open) chooseRoute(route?.id, true);
  }
  for (let i = 1; i <= 12; i++) { const option = el('option', `${i} 月`); option.value = i; $('walk-month').append(option); }
  $('walk-open').addEventListener('click', () => {
    if (routes.length) openWalk();
    else { const target = updateEntry(); if (target) { pendingOpen = true; document.dispatchEvent(new CustomEvent('chinatour:select-place', { detail: { placeId: target.id } })); } }
  });
  $('walk-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { setPlaying(false); ++mapVersion; hidePhoto('选择节点查看沿途照片。'); document.body.classList.remove('walk-opened'); writeLocation(null); returnFocus?.focus({ preventScroll: true }); });
  $('walk-progress').addEventListener('input', e => setProgress(Number(e.target.value) / 1000));
  $('walk-play').addEventListener('click', () => { if (!playing && progress >= 1) setProgress(0); setPlaying(!playing); });
  $('walk-restart').addEventListener('click', () => { setProgress(0); zoom = 1; applyZoom(); });
  $('walk-month').addEventListener('change', e => document.dispatchEvent(new CustomEvent('chinatour:walk-month', { detail: { month: Number(e.target.value) } })));
  $('walk-photo-prev').addEventListener('click', () => { photoIndex = (photoIndex + photos.length - 1) % photos.length; renderPhoto(); });
  $('walk-photo-next').addEventListener('click', () => { photoIndex = (photoIndex + 1) % photos.length; renderPhoto(); });
  $('walk-zoom-in').addEventListener('click', () => { zoom = clamp(zoom + 0.5, 1, 3); applyZoom(); });
  $('walk-zoom-out').addEventListener('click', () => { zoom = clamp(zoom - 0.5, 1, 3); applyZoom(); });
  $('walk-fit').addEventListener('click', () => { zoom = 1; applyZoom(); });
  document.addEventListener('chinatour:data', e => receive(e.detail));
  document.addEventListener('chinatour:loading', e => {
    loading = e.detail.loading;
    if (loading) { setPlaying(false); if (dialog.open) hidePhoto('正在读取所选月份的资料…'); }
    syncControls();
    updateEntry();
    if (!loading && routes.length) {
      if (dialog.open) { sceneIndex = -1; setProgress(progress, false); }
      if (pendingOpen || new URLSearchParams(location.search).has('walk')) { pendingOpen = false; if (!dialog.open) openWalk(); }
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPlaying(false); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (dialog.open && track) applyZoom(); }).observe(svg);
  document.addEventListener('atlas:home', () => { if (dialog.open) dialog.close(); });
  motion.addEventListener('change', () => { setPlaying(false); if (route) $('walk-hint').textContent = motion.matches ? '已减少动态效果 · 播放时逐站切换' : '拖动或用方向键来回浏览 · 点击节点直达'; });
  window.addEventListener('popstate', () => { if (!new URLSearchParams(location.search).has('walk') && dialog.open) dialog.close(); });
})();
