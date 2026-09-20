'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const initialParams = new URLSearchParams(window.location.search);
const defaultMonthNumber = window.CHINATOUR_PREVIEW_META?.defaultMonth || new Date().getMonth() + 1;
const initialMonthNumber = integer(initialParams.get('month'), defaultMonthNumber);
const state = {
  placeId: window.CHINATOUR_PREVIEW_META?.defaultPlace || initialParams.get('place_id') || 'liyang',
  month: initialMonthNumber >= 1 && initialMonthNumber <= 12 ? String(initialMonthNumber) : String(defaultMonthNumber),
  mode: ['all', 'recent', 'historical'].includes(initialParams.get('mode')) ? initialParams.get('mode') : 'all',
  monthScope: ['all', 'practical'].includes(initialParams.get('collect_scope')) ? initialParams.get('collect_scope') : 'selected',
  practicalTab: null,
  query: '', attractionLimit: 6, places: [], sources: [], selectedSourceKeys: new Set(['official', 'xiaohongshu']), overview: null, data: null, map: null,
  requestVersion: 0, openAttractionId: null, drawerReturnFocus: null, job: null, pollTimer: null, toastTimer: null, executorReady: false, browserExecutor: 'unknown', browserStatus: 'unknown', browserStatusMessage: '', browserInfoExpanded: false, storage: null,
};

const READY_SOURCE_STATUS = new Set(['public_read_verified', 'available', 'enabled', 'active', 'public', 'supported']);
const TERMINAL_JOB_STATUS = new Set(['succeeded', 'success', 'completed', 'done', 'failed', 'error', 'partial', 'blocked', 'cancelled', 'canceled', 'preview_ready', 'preview_failed']);
const BROWSER_SUCCESS_STATUS = new Set(['ready', 'succeeded', 'connected']);
const STATUS_LABELS = {
  supported: '有依据', disputed: '存在分歧', stale: '需要更新', insufficient: '样本不足', pending: '待确认',
  stable_candidate: '稳定共识候选',
  accepted: '已核对', pending_change: '待确认变化', recent_signal: '近期信号', baseline: '历史基线',
};
const KIND_LABELS = { observation: '现场观察', notice: '公告', background: '背景资料', link: '链接线索', lead: '链接线索' };
const photoDecks = new Set();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let photoCycleTimer = null;

const SOURCE_LABELS = { official: '官网', xiaohongshu: '小红书', weibo: '微博', wechat: '微信公众号', douyin: '抖音', news: '新闻' };

function make(tag, className = '', text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}
function clear(element) { if (element) element.replaceChildren(); return element; }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function integer(value, fallback = 0) { const parsed = Math.round(Number(value)); return Number.isFinite(parsed) ? parsed : fallback; }
function safeUrl(value) {
  if (typeof value === 'string' && /^\/api\/media\/[a-f0-9]{24}$/i.test(value)) return window.CHINATOUR_PREVIEW ? window.CHINATOUR_PREVIEW.mediaUrl(value) : value;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function dateText(value) {
  if (!value) return '未提供';
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10).replaceAll('-', '.');
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed) : raw.slice(0, 24);
}
function dateValue(value) { return value ? String(value).slice(0, 10) : ''; }
function monthOf(item) {
  const explicit = integer(item?.month, 0);
  if (explicit >= 1 && explicit <= 12) return explicit;
  const captured = item?.observed_start || item?.observed_at;
  const match = captured && String(captured).match(/^\d{4}-(\d{2})/);
  return match ? integer(match[1], 0) : 0;
}
function yearOf(item) {
  const explicit = integer(item?.year, 0);
  if (explicit >= 1900) return explicit;
  const captured = item?.observed_start || item?.observed_at;
  const match = captured && String(captured).match(/^(\d{4})-/);
  return match ? integer(match[1], 0) : 0;
}
function todayYear() { return new Date(window.CHINATOUR_PREVIEW?.snapshotAt || Date.now()).getFullYear(); }
function currentMonthNumber() { return integer(state.month, new Date().getMonth() + 1); }
function statusText(value) { return STATUS_LABELS[String(value || '').toLowerCase()] || String(value || '待确认'); }
function sourceText(value) { return SOURCE_LABELS[String(value || '').toLowerCase()] || String(value || '来源未注明'); }
function kindText(value) { return KIND_LABELS[String(value || '').toLowerCase()] || String(value || '资料'); }
function errorText(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(errorText).filter(Boolean).join('；');
  if (typeof value === 'object') {
    const detail = value.message || value.error || value.detail || value.reason;
    if (detail) return errorText(detail);
    try { return JSON.stringify(value); } catch { return '未知错误'; }
  }
  return String(value);
}
function isBuiltinBrowser() { return state.browserExecutor === 'builtin'; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function progressPercent(value, status = '') {
  const parsed = number(value, 0);
  const scaled = parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed;
  if (['succeeded', 'success', 'completed', 'done'].includes(String(status).toLowerCase())) return 100;
  return clamp(scaled, 0, 100);
}
function sourceStatus(source) { return String(source?.status || '').toLowerCase(); }
function isReadySource(source) { return READY_SOURCE_STATUS.has(sourceStatus(source)); }
function sourceKey(source) { return String(source?.id || source?.key || source?.label || '').toLowerCase(); }
function matchesSource(source, key) {
  const haystack = `${sourceKey(source)} ${String(source?.label || '').toLowerCase()}`;
  return key === 'xiaohongshu' ? haystack.includes('xiaohong') || haystack.includes('小红书') || haystack.includes('redbook') : key === 'official' ? haystack.includes('official') || haystack.includes('官网') || haystack.includes('gov') || haystack.includes('liyang') : haystack.includes(key);
}

function showToast(message, error = false, duration = 5200) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toast.hidden = true; }, duration);
}
function showNotice(message, error = false) {
  const banner = $('#notification');
  if (!banner) return;
  banner.textContent = message;
  banner.classList.toggle('error', error);
  banner.hidden = false;
}
function hideNotice() { if ($('#notification')) $('#notification').hidden = true; }
function readableError(error) {
  if (!error) return '请求未能完成，请稍后重试。';
  if (error.status === 404) return '这个功能还没有接入本地服务。';
  if (error.status === 409) return errorText(error.message) || '这个连接器目前还没有准备好。';
  return errorText(error.message) || '请求未能完成，请稍后重试。';
}

async function request(path, options = {}) {
  const response = window.CHINATOUR_PREVIEW ? await window.CHINATOUR_PREVIEW.request(path, options) : await fetch(path, options);
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    const detail = payload?.detail || payload?.error || payload?.message;
    const error = new Error(errorText(detail) || `请求失败（${response.status}）。`);
    error.status = response.status;
    throw error;
  }
  return payload || {};
}
function post(path, payload) {
  return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ChinaTour-Local': '1' }, body: JSON.stringify(payload || {}) });
}
function destinationPath(mode = state.mode) {
  const params = new URLSearchParams();
  params.set('place_id', state.placeId);
  if (state.month) params.set('month', state.month);
  params.set('mode', mode || 'all');
  return `/api/destination?${params.toString()}`;
}
function updateUrl() {
  const params = new URLSearchParams();
  if (state.placeId) params.set('place_id', state.placeId);
  if (state.month) params.set('month', state.month);
  if (state.mode !== 'all') params.set('mode', state.mode);
  if (state.monthScope !== 'selected') params.set('collect_scope', state.monthScope);
  if (new URLSearchParams(location.search).get('view') === 'destination') params.set('view', 'destination');
  const query = params.toString();
  const route = window.CHINATOUR_PREVIEW?.basePath || '/';
  history.replaceState(history.state, '', (query ? `${route}?${query}` : route) + location.hash);
}

function normalizeDestination(raw) {
  const destination = raw?.destination || raw?.place || {};
  return {
    destination: {
      id: String(destination.id || state.placeId),
      name: destination.name || '未命名目的地',
      description: destination.description || destination.summary || '',
    },
    attractions: Array.isArray(raw?.attractions) ? raw.attractions : [],
    evidence: Array.isArray(raw?.evidence) ? raw.evidence : [],
    baselines: Array.isArray(raw?.baselines) ? raw.baselines : [],
    visualCohorts: Array.isArray(raw?.visual_cohorts) ? raw.visual_cohorts : [],
    landscapeUpdates: Array.isArray(raw?.landscape_updates) ? raw.landscape_updates : [],
    timeWindows: raw?.time_windows || {},
    changes: Array.isArray(raw?.changes) ? raw.changes : [],
    jobs: Array.isArray(raw?.jobs) ? raw.jobs : [],
    coverage: raw?.coverage && typeof raw.coverage === 'object' ? raw.coverage : { months: [], unknown_time: 0 },
    map: raw?.map && typeof raw.map === 'object' ? raw.map : { bounds: [], hubs: [], roads: [], limitations: [] },
    practical: raw?.practical || { facts: [], classified_sources: [], climate: null },
    limitations: Array.isArray(raw?.limitations) ? raw.limitations : [],
  };
}
function adaptLegacy(raw) {
  return normalizeDestination({ destination: raw?.place || {}, evidence: raw?.evidence || [], changes: raw?.changes || [], coverage: raw?.coverage || {}, map: {} });
}
async function loadOverview() {
  try {
    state.overview = await request('/api/overview');
    state.places = Array.isArray(state.overview?.places) ? state.overview.places.filter((place) => !place.parent_id || ['destination', 'city', 'region'].includes(String(place.kind || '').toLowerCase())) : [];
    state.sources = Array.isArray(state.overview?.source_capabilities) ? state.overview.source_capabilities : [];
  } catch (error) {
    try {
      const places = await request('/api/places');
      state.places = Array.isArray(places) ? places : [];
    } catch { state.places = []; }
    state.sources = [];
    state.overview = { limitations: [readableError(error)] };
  }
  renderPlacePicker();
  renderSourceOptions();
}
function applyBrowserStatus(payload) {
  const status = typeof payload === 'string' ? payload : payload?.status || (payload?.connected || payload?.ready || payload?.authorized ? 'ready' : 'unknown');
  state.browserExecutor = typeof payload === 'object' ? String(payload.executor || 'unknown').toLowerCase() : state.browserExecutor;
  state.browserStatus = String(status || 'unknown').toLowerCase();
  state.browserStatusMessage = typeof payload === 'object' ? errorText(payload.message || payload.reason) : '';
  state.executorReady = isBuiltinBrowser() && BROWSER_SUCCESS_STATUS.has(state.browserStatus);
  return state.browserStatus;
}
async function loadBrowserStatus({ render = true } = {}) {
  try {
    const status = await request('/api/browser/status');
    applyBrowserStatus(status);
  } catch {
    state.browserExecutor = 'unknown';
    state.browserStatus = 'unknown';
    state.browserStatusMessage = '';
    state.executorReady = false;
  }
  if (render) renderSourceOptions();
  return state.browserStatus;
}
function formatBytes(value) {
  const bytes = Math.max(0, number(value, 0));
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${Math.round(bytes)} B`;
}
function renderStorage(storage = state.storage) {
  const note = $('#storage-note');
  if (!note) return;
  if (!storage) { note.textContent = '本地图片缓存状态暂不可用。'; return; }
  const used = formatBytes(storage.cache_bytes);
  const limit = number(storage.cache_limit_bytes, 0);
  const images = integer(storage.cached_images, 0);
  note.textContent = limit > 0
    ? `本地图片缓存 ${used} / ${formatBytes(limit)} · ${images} 张图片 · 原文依据与版本保留`
    : `本地图片缓存 ${used} · ${images} 张图片 · 原文依据与版本保留`;
}
async function loadStorage() {
  try { state.storage = await request('/api/storage'); }
  catch { state.storage = null; }
  renderStorage();
  return state.storage;
}
async function loadDestination({ silent = false } = {}) {
  const version = ++state.requestVersion;
  if (!silent) document.body.classList.add('is-loading');
  let raw;
  try {
    try {
      raw = await request(destinationPath());
    } catch (error) {
      if (state.mode === 'all' && (error.status === 404 || error.status === 405)) {
        raw = await request(`/api/places/${encodeURIComponent(state.placeId)}`);
        raw = adaptLegacy(raw);
      } else throw error;
    }
    if (version !== state.requestVersion) return;
    state.data = normalizeDestination(raw);
    syncJobFromDestination();
    if (!state.places.some((place) => String(place.id) === String(state.data.destination.id))) state.places.push(state.data.destination);
    renderAll();
    hideNotice();
  } catch (error) {
    if (version !== state.requestVersion) return;
    state.data = null;
    renderAll();
    showNotice(`暂时无法读取 ${state.placeId || '目的地'} 的资料：${readableError(error)}`, true);
  } finally {
    if (!silent) document.body.classList.remove('is-loading');
  }
}

function renderPlacePicker() {
  const picker = $('#place-picker');
  if (!picker) return;
  const previous = state.placeId;
  clear(picker);
  const places = state.places.filter((place) => place && place.id);
  if (!places.length) {
    picker.append(make('option', '', state.data?.destination?.name || '目的地'));
    picker.disabled = true;
    return;
  }
  picker.disabled = false;
  places.forEach((place) => {
    const option = make('option', '', place.name || place.id);
    option.value = String(place.id);
    option.selected = String(place.id) === String(previous);
    picker.append(option);
  });
  if (!places.some((place) => String(place.id) === String(previous))) picker.value = String(places[0].id);
}
function renderMode() {
  $('#mode-filter')?.querySelectorAll('[data-mode]').forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function renderHero() {
  const destination = state.data?.destination || {};
  $('#destination-title').textContent = destination.name || '正在读取目的地…';
  $('#hero-place-kicker').textContent = destination.name || '目的地';
  $('#destination-description').textContent = destination.description || '循着月份与真实照片，找到想去的地方。';
  $('#hero-month-label').textContent = state.month ? `${state.month}月` : '全年';
  $('#hero-proof-text').textContent = '先看景色，再点开照片背后的真实记录。';
  $('#map-heading').textContent = `${destination.name || '目的地'}，先看全貌`;
}
function firstMedia(item, preferLandscape = false) {
  if (!item) return null;
  const media = Array.isArray(item.media) ? item.media : [];
  const direct = (preferLandscape && media.find((entry) => entry.scene_hint?.eligible && safeUrl(entry?.url || entry?.src))) || media.find((entry) => safeUrl(entry?.url || entry?.src));
  if (direct) return { url: safeUrl(direct.url || direct.src), credit: direct.credit || item.photo_credit || item.publisher || '', ordinal: direct.ordinal, sceneHint: direct.scene_hint };
  const directUrl = safeUrl(item.photo_url || item.image_url || item.media_url);
  return directUrl ? { url: directUrl, credit: item.photo_credit || item.publisher || '' } : null;
}
function addImage(container, media, alt) {
  if (!container || !media?.url) return false;
  const image = document.createElement('img');
  image.src = media.url;
  image.alt = alt || '来源实景图';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => {
    image.remove();
    container.classList.add('image-missing');
  }, { once: true });
  container.append(image);
  if (media.credit) container.append(make('span', 'image-credit', `图源：${media.credit}`));
  return true;
}
function renderHeroMedia() {
  const container = clear($('#hero-media'));
  container.classList.remove('media-empty', 'image-missing');
  const attraction = (state.data?.attractions || []).map((item) => ({ item, media: firstMedia(item) })).find((entry) => entry.media);
  const evidence = (state.data?.evidence || []).map((item) => ({ item, media: firstMedia(item, true) })).filter((entry) => entry.media);
  const seasonal = evidence.find((entry) => monthOf(entry.item) === integer(state.month) && entry.media.sceneHint?.eligible)
    || evidence.find((entry) => monthOf(entry.item) === integer(state.month));
  const selected = seasonal || evidence[0] || attraction;
  if (selected && addImage(container, selected.media, selected.item.name || selected.item.title || '目的地实景图')) {
    const basis = photoTimeText(selected.item, timeBasis(selected.item));
    container.append(make('span', `hero-media-label${isUnknownTime(basis) ? ' unknown' : ''}`, `SOURCE IMAGE · 时间依据：${basis}`));
    return;
  }
  container.classList.add('media-empty');
  container.append(make('span', 'media-empty-mark', '景'), make('strong', '', '暂无可展示实景图'), make('small', '', '只有带地点与时间依据的图片，才会进入这里。'));
}

function monthCounts() {
  const supplied = state.data?.coverage?.months;
  if (Array.isArray(supplied) && supplied.length) return supplied.reduce((result, entry) => { result[integer(entry.month)] = integer(entry.count); return result; }, {});
  return (state.data?.evidence || []).reduce((result, item) => { const month = monthOf(item); if (month) result[month] = (result[month] || 0) + 1; return result; }, {});
}
function renderStats() {
  const data = state.data;
  const counts = monthCounts();
  const currentItems = currentMonthEvidence();
  $('#stat-attractions').textContent = data ? String(data.attractions.length || 0) : '—';
  $('#stat-evidence').textContent = data ? String(data.evidence.length || 0) : '—';
  $('#stat-months').textContent = data ? String(Object.values(counts).filter((value) => value > 0).length) : '—';
  $('#stat-sample').textContent = data ? String(currentItems.length) : '—';
  $('#stat-note').textContent = state.month && currentItems.length < 3
    ? `${state.month} 月有时间依据的资料仅 ${currentItems.length} 条；月份未知的背景资料不计入。`
    : '资料数量、来源独立性和时间依据会分别展示。';
}
function renderMonths() {
  const container = clear($('#month-filter'));
  const counts = monthCounts();
  for (let month = 1; month <= 12; month += 1) {
    const button = make('button', `month-button${state.month === String(month) ? ' active' : ''}`);
    button.type = 'button'; button.dataset.month = String(month); button.setAttribute('aria-pressed', String(state.month === String(month)));
    button.append(make('span', '', `${month}`), make('small', '', '月'), make('b', '', counts[month] ? String(counts[month]) : '—'));
    button.addEventListener('click', () => chooseMonth(String(month)));
    container.append(button);
  }
  $('#month-heading-note').textContent = '照片优先按现场月份展示；发布月份暂归档会单独标明。';
}
function chooseMonth(month) {
  state.month = month || String(new Date().getMonth() + 1);
  state.attractionLimit = 6;
  updateUrl();
  loadDestination();
}
function baselineForMonth() {
  const month = integer(state.month, 0);
  return (state.data?.baselines || []).filter((item) => integer(item.month, 0) === month)
    .sort((a, b) => Number(b.status === 'stable_candidate') - Number(a.status === 'stable_candidate') || number(b.groups) - number(a.groups))[0] || null;
}
function baselineIsWeak(baseline) {
  const status = String(baseline?.status || '').toLowerCase();
  return !baseline || ['insufficient', 'pending', 'unknown', 'disputed', 'low'].some((value) => status.includes(value));
}
function renderBaseline() {
  const summary = clear($('#baseline-summary'));
  const coverageNote = clear($('#coverage-note'));
  const baseline = state.month ? baselineForMonth() : null;
  if (!state.month) {
    summary.append(make('span', 'summary-label', '历史基线'), make('strong', '', '请选择一个月份'), make('p', '', '把某个月份放大后，才能看到支持簇、年份和分歧。'));
  } else if (!baseline) {
    summary.classList.add('is-weak');
    summary.append(make('span', 'summary-label', `${state.month} 月 · 历史基线`), make('strong', '', '样本不足'), make('p', '', '还没有足够的独立来源或年份形成稳定基线；近期材料不会被伪装成确定事实。'));
  } else {
    const weak = baselineIsWeak(baseline);
    summary.classList.toggle('is-weak', weak);
    summary.append(make('span', 'summary-label', `${baseline.place_name || ''} · ${state.month} 月 · ${statusText(baseline.status || 'baseline')}`), make('strong', '', baseline.summary || (weak ? '样本不足，保留多种可能' : '已有历史同月记录')));
    const facts = make('div', 'baseline-facts');
    const years = Array.isArray(baseline.years) ? baseline.years.join('、') : (baseline.years ?? '—');
    facts.append(make('span', '', `样本支持 ${Math.round(number(baseline.support) * 100)}%`), make('span', '', `独立组 ${baseline.groups ?? '—'}`), make('span', '', `年份 ${years || '—'}`));
    summary.append(facts);
    summary.append(make('p', '', `历史范围：${state.data?.timeWindows?.historical_through_year || todayYear() - 2} 年及以前。支持比例仅代表已采集样本。`));
    const representativeUrl = safeUrl(baseline.representative_url);
    if (representativeUrl) {
      const representative = make('a', 'baseline-representative');
      representative.href = representativeUrl; representative.target = '_blank'; representative.rel = 'noopener noreferrer'; representative.title = '打开代表图';
      const image = document.createElement('img'); image.src = representativeUrl; image.alt = `${state.month}月${weak ? '已有线索图' : '历史基线代表图'}`; image.loading = 'lazy'; image.decoding = 'async';
      image.addEventListener('error', () => representative.remove(), { once: true });
      representative.append(image, make('span', '', weak ? '已有线索图 · 样本不足，代表性待验证' : '同月样本中的代表图 · 仍需核对实际场景')); summary.append(representative);
    }
  }
  const unknown = integer(state.data?.coverage?.unassigned_time, 0);
  const shownCount = visibleEvidence({ ignoreQuery: true }).length;
  const monthCount = currentMonthEvidence().length;
  const coverageText = state.month
    ? `${shownCount} 条展示资料`
    : `${state.data?.evidence?.length || 0} 条资料`;
  const coverageDescription = state.month
    ? `${monthCount} 条有现场月份依据，${publicationMonthEvidence().length} 条按发布月份暂归档${unknown ? `；另有 ${unknown} 条尚无法归月` : ''}。发布月份帮助浏览，不计入现场景色投票。`
    : (unknown ? `${unknown} 条记录没有明确拍摄/观察月份。` : '已收录资料均有月份字段或明确时间依据。');
  coverageNote.append(make('span', 'coverage-label', '时间覆盖'), make('strong', '', coverageText), make('p', '', coverageDescription));
}

const LANDSCAPE_LABELS = {
  baseline_unavailable: '缺少历史基准', insufficient_recent: '缺少近期现场证据',
  consistent: '已有样本与历史一致', recent_signal: '差异待补证',
  confirmed_difference: '近期样本差异获得支持', not_applicable: '不适用景观投票',
};

const SCENE_LABELS = { vegetation: '植被景观', water: '水面景观', grassland: '草地景观', mountain: '山地景观' };
const COHORT_SELECTION_LABELS = {
  cosine_medoid: '在同类照片中按颜色与构图选出代表图',
  evidence_quality_only: '选用一张有来源的示例图；外观特征不足，未计算代表性',
};
const COHORT_EXCLUSION_LABELS = {
  subject_analysis_incomplete: '图片检查未完成',
  appearance_analysis_incomplete: '照片外观分析未完成',
  no_eligible_landscape: '未找到可归类的景观照片',
  scene_confidence_insufficient: '图片分类不够明确',
  visual_independence_unresolved: '共享图片或检查缺口待核对',
  shared_album_time_conflict: '同组图片时间冲突',
  unresolved_capture_time: '现场时间不明确',
  no_photos: '无照片',
  unknown_source_group: '来源身份不明确',
  ambiguous_group_year: '同组年份冲突',
};
function cohortPhotoTime(item) {
  if (!item) return '照片时间尚待核对';
  const date = item.observed_start ? dateText(item.observed_start) : `${item.year || '年份未知'}年${item.month || state.month || '—'}月`;
  if (item.time_basis === 'author_relative_date') return `推算 ${date} · 原帖相对时间`;
  if (item.time_basis === 'author_explicit_date') return `${date} · 作者注明日期`;
  if (['author_explicit_month', 'author_month_only'].includes(item.time_basis)) return `${item.year || '年份未知'}年${item.month || state.month || '—'}月 · 作者注明月份`;
  return `${date} · 时间依据待核对`;
}
function renderVisualCohorts() {
  const container = clear($('#visual-cohorts'));
  if (!container) return;
  const all = (state.data?.visualCohorts || []).filter((item) => integer(item.month) === currentMonthNumber() && number(item.groups) > 0);
  const windows = state.mode === 'historical' ? ['historical'] : state.mode === 'recent' ? ['recent'] : ['historical', 'recent'];
  for (const window of windows) {
    const items = all.filter((item) => item.window === window);
    const section = make('section', 'cohort-window');
    const heading = make('div', 'cohort-heading');
    heading.append(make('h3', '', window === 'historical' ? '历年实拍里出现的景色' : '近两年实拍里的景色'), make('span', 'cohort-month', `${state.month} 月`));
    section.append(heading);
    const range = window === 'historical' ? `${state.data?.timeWindows?.historical_through_year || todayYear() - 2} 年及以前` : (state.data?.timeWindows?.recent_observation_years || [todayYear() - 1, todayYear()]).join('–') + ' 年';
    if (!items.length) {
      section.append(make('p', 'cohort-empty', `${range}的同月资料中，尚无同时满足时间、地点、去重与图片分析要求的景色样本。已有原相册可在景点详情中查看。`));
      container.append(section);
      continue;
    }
    section.append(make('p', 'cohort-intro', `${range}的同月实拍，按图片内容自动归类。同一相册可同时有山、水与植被；分类可能有误，这些线索尚不能证明这个月份的常态。${window === 'recent' ? '此处依据作者注明的游览日期，与“近期发布”的资料筛选不同。' : ''}`));
    const grid = make('div', 'cohort-grid');
    for (const item of items) {
      const card = make('article', 'cohort-card');
      const representative = item.representative || {};
      const photoUrl = safeUrl(item.representative_url);
      const sourceUrl = safeUrl(representative.source_url);
      const scene = item.scene_label || SCENE_LABELS[item.scene] || '景色线索';
      const frame = make(photoUrl ? 'a' : 'div', 'cohort-photo');
      if (photoUrl) {
        frame.href = sourceUrl || photoUrl; frame.target = '_blank'; frame.rel = 'noopener noreferrer';
        frame.setAttribute('aria-label', `${item.place_name || '景点'} · ${scene} · ${sourceUrl ? '查看原帖' : '打开照片'}`);
        const image = make('img'); image.src = photoUrl; image.alt = `${item.place_name || '景点'} ${state.month}月相册中的${scene}线索`; image.loading = 'lazy'; image.decoding = 'async';
        image.addEventListener('error', () => {
          image.remove(); frame.classList.add('cohort-photo-missing'); frame.append(make('span', '', '照片暂不可用 · 可查看原帖'));
        }, { once: true });
        frame.append(image);
      } else {
        frame.classList.add('cohort-photo-missing'); frame.append(make('span', '', '暂未选出适合展示的照片'));
      }
      card.append(frame);
      const body = make('div', 'cohort-body');
      const label = make('div', 'cohort-label');
      label.append(make('span', '', item.place_name || '景点待核对'), make('span', 'cohort-status', item.status === 'sample_pattern_candidate' ? '样本线索 · 待核对' : '样本仍少'));
      body.append(label, make('h4', '', scene));
      const count = make('p', 'cohort-count');
      count.append(make('strong', '', `${integer(item.groups)} / ${integer(item.total_groups)}`), make('span', '', ' 个去重观察组出现'));
      body.append(count);
      const years = Array.isArray(item.years) ? item.years.join('、') : '';
      body.append(make('p', 'cohort-years', years ? `出现年份 · ${years}` : '出现年份尚待核对'));
      const attribution = make('div', 'cohort-attribution');
      attribution.append(make('span', '', `展示照片 · ${cohortPhotoTime(representative)}`));
      if (sourceUrl) {
        const link = make('a', '', `${representative.publisher || '照片来源'} · 查看原帖 ↗`);
        link.href = sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; attribution.append(link);
      }
      body.append(attribution);
      const details = make('details', 'cohort-details');
      details.append(make('summary', '', '来源与选图依据'));
      const detailBody = make('div', 'cohort-detail-body');
      detailBody.append(make('p', '', number(item.total_groups) < 2
        ? '目前仅有一组可比较的景观相册，暂不展示出现比例。不同景色可来自同一组照片，多张场景卡片不会增加来源组数。'
        : `按年份平衡的样本出现率 ${Math.round(clamp(number(item.sample_support), 0, 1) * 100)}%：先分别计算各年合格观察组的出现比例，再对年份平均。只计入图片分析完成、有日期依据且包含景观图片的记录。它描述已收录样本，不是景色的发生概率；不同景色可以共存，各项不相加为 100%。`));
      detailBody.append(make('p', '', '去重观察组用于减少重复照片或同源材料的重复计数。未发现相同照片，不等于已经证明作者或内容相互独立。'));
      if (representative.time_excerpt) detailBody.append(make('p', 'cohort-time-evidence', `照片时间依据：${representative.time_excerpt}`));
      if (representative.method) detailBody.append(make('p', '', `选图依据：${number(item.groups) < 2 ? '仅有一组来源，先展示有时间依据的示例图，代表性仍待更多样本核对' : COHORT_SELECTION_LABELS[representative.method] || '当前示例图的代表性仍待核对'}`));
      if (item.status === 'sample_pattern_candidate') detailBody.append(make('p', '', '当前分组规则尚未用足量真实样本校准；达到候选条件不等于形成稳定的季节规律。'));
      const coverage = item.coverage || {};
      if (coverage.dated_records !== undefined && coverage.eligible_records !== undefined) {
        detailBody.append(make('p', '', `此景点与时间窗口共 ${integer(coverage.dated_records)} 条有日期依据的记录，其中 ${integer(coverage.eligible_records)} 条满足归组要求。未满足要求的记录不计入样本比例。`));
      }
      const excluded = Object.entries(coverage.excluded || {}).filter(([, count]) => number(count) > 0)
        .map(([reason, count]) => `${COHORT_EXCLUSION_LABELS[reason] || '其他依据待核对'} ${integer(count)} 条`);
      if (excluded.length) detailBody.append(make('p', '', `未计入原因：${excluded.join('；')}。`));
      const links = make('ul', 'cohort-sources');
      for (const evidence of item.evidence_links || []) {
        const href = safeUrl(evidence.url); if (!href) continue;
        const row = make('li');
        const link = make('a', '', evidence.title || '查看原始记录'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        const basis = evidence.time_basis === 'author_relative_date' ? '时间由原帖推算' : ['author_explicit_date', 'author_explicit_month', 'author_month_only'].includes(evidence.time_basis) ? '作者注明时间' : '时间依据见原帖';
        row.append(link, make('span', '', `${evidence.year || '年份未知'} · ${basis}`));
        links.append(row);
      }
      if (links.children.length) detailBody.append(links);
      details.append(detailBody); body.append(details); card.append(body); grid.append(card);
    }
    section.append(grid); container.append(section);
  }
}

function renderLandscapeUpdates() {
  const container = clear($('#landscape-updates'));
  if (!container) return;
  const years = state.data?.timeWindows?.recent_observation_years || [todayYear() - 1, todayYear()];
  container.append(make('h3', '', '近期与往年有什么不同'), make('p', 'landscape-intro', `${years.join('–')} 年的同月现场记录单独比较；发布日期不代替旅行日期。`));
  const items = state.data?.landscapeUpdates || [];
  if (!items.length) {
    container.append(make('p', 'landscape-empty', '还没有足够的同月、同景观记录进行比较。缺少更新不表示景色没有变化。'));
    return;
  }
  for (const item of items) {
    const card = make('details', 'landscape-card');
    const heading = make('summary');
    heading.append(make('span', '', `${item.place_name} · ${item.theme}`), make('span', `landscape-status${item.status === 'confirmed_difference' ? ' has-support' : ''}`, LANDSCAPE_LABELS[item.status] || '等待比较'));
    card.append(heading);
    const content = make('div', 'landscape-detail');
    const base = item.baseline_value || '尚未形成稳定基准';
    const recent = item.candidate_value || '尚无可用的现场日期记录';
    content.append(make('p', '', `往年：${base}。近期：${recent}。`));
    const facts = make('div', 'baseline-facts');
    facts.append(make('span', '', `近期支持组 ${(item.supporting_groups || []).length}`), make('span', '', `不同描述组 ${(item.opposing_groups || []).length}`), make('span', '', `现场日期 ${(item.observation_dates || []).length}`), make('span', '', `首次采集批次 ${(item.collection_batches || []).length}`));
    content.append(facts);
    const excluded = Object.values(item.excluded_counts || {}).reduce((total, count) => total + number(count), 0);
    if (excluded) content.append(make('p', '', `${excluded} 条近期线索未满足比较所需的时间、地点或独立性依据，暂不计票。`));
    content.append(make('p', 'landscape-caution', item.status === 'confirmed_difference'
      ? '支持的是近期样本中的景观差异，不能据此认定景区发生永久变化。判定规则尚待真实样本校准。'
      : '补齐独立来源、现场日期和采集批次后再判断；少量样本不代表整个景区。'));
    if ((item.evidence_links || []).length) {
      const links = make('div', 'landscape-links');
      for (const evidence of item.evidence_links) {
        const href = safeUrl(evidence.url); if (!href) continue;
        const link = make('a', '', evidence.title || '查看原始记录');
        link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link);
      }
      content.append(links);
    }
    const history = item.history || [];
    if (history.length) {
      const journal = make('details', 'landscape-history');
      journal.append(make('summary', '', `判断记录 · ${history.length} 次`));
      const list = make('ol');
      for (const version of history) list.append(make('li', '', `${dateText(version.created_at)} · ${LANDSCAPE_LABELS[version.status] || '等待比较'}${version.parent_id ? ' · 接续上一版本' : ' · 首次记录'}`));
      journal.append(list); content.append(journal);
    }
    card.append(content); container.append(card);
  }
}

function validPoint(point) {
  const lat = number(point?.lat, NaN); const lon = number(point?.lon, NaN);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}
function mapPoints() {
  const attractions = (state.data?.attractions || []).filter(validPoint);
  const hubs = (state.data?.map?.hubs || []).filter(validPoint);
  const roads = (state.data?.map?.roads || []).filter((road) => Array.isArray(road?.coordinates) && road.coordinates.filter(validPoint).length > 1);
  return { attractions, hubs, roads };
}
function renderMap() {
  const canvas = $('#map-canvas'); const placeholder = $('#map-placeholder'); const legend = $('#map-legend');
  if (!canvas) return;
  clear(canvas); canvas.classList.remove('svg-map'); canvas.hidden = false;
  const mapImage = state.data?.map?.image_url || state.data?.map?.overview_image || (state.placeId === 'liyang' ? '/static/liyang-overview.svg' : '');
  const mapHref = safeUrl(mapImage) || (String(mapImage).startsWith('/') ? (window.CHINATOUR_PREVIEW ? window.CHINATOUR_PREVIEW.assetUrl(mapImage) : String(mapImage)) : '');
  const points = mapPoints();
  if (!mapHref) {
    canvas.hidden = true; placeholder.hidden = false; legend.hidden = true; renderMapLimitations(); return;
  }
  const link = make('a', 'static-map-link'); link.href = mapHref; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = '打开大图';
  const image = document.createElement('img'); image.src = link.href; image.alt = `${state.data?.destination?.name || '目的地'}景点、道路和交通枢纽概览图`; image.loading = 'lazy';
  image.addEventListener('load', () => { placeholder.hidden = true; legend.hidden = false; }, { once: true });
  image.addEventListener('error', () => { image.remove(); link.remove(); canvas.hidden = true; placeholder.hidden = false; legend.hidden = true; }, { once: true });
  link.append(image); canvas.append(link); placeholder.hidden = false; legend.hidden = false; renderMapLimitations();
}
function renderMapLimitations() {
  const list = clear($('#map-limitations'));
  const limitations = Array.isArray(state.data?.map?.limitations) ? state.data.map.limitations : [];
  if (!limitations.length && !mapPoints().roads.length) list.append(make('span', '', '道路仅在有几何来源时显示；本页不估算路线和车程。'));
  limitations.slice(0, 3).forEach((item) => list.append(make('span', '', String(item))));
  const transports = Array.isArray(state.data?.map?.transport_sources) ? state.data.map.transport_sources : [];
  transports.forEach((entry) => {
    const url = safeUrl(entry?.url || entry?.source_url);
    if (!url) return;
    const link = make('a', 'map-source-link', `${entry.name || entry.label || '交通查询入口'} ↗`);
    link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; list.append(link);
  });
}

function addMonths(container, months) {
  const values = Array.isArray(months) ? months.map((month) => integer(month, 0)).filter((month) => month >= 1 && month <= 12) : [];
  if (!values.length) { container.append(make('span', 'muted', '月份未确认')); return; }
  values.slice(0, 6).forEach((month) => container.append(make('span', 'mini-month', `${month}月`)));
  if (values.length > 6) container.append(make('span', 'mini-month more', `+${values.length - 6}`));
}
function attractionQueryMatch(attraction) {
  const terms = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const own = [attraction.name, attraction.description].filter(Boolean).join(' ').toLowerCase();
  return terms.every((term) => own.includes(term)) || attractionEvidence(attraction).some(evidenceQueryMatch);
}
function cardMediaEntries(attraction) {
  const all = attractionMediaEntries(attraction);
  // Only this month's server-filtered records enter the card. Official images
  // remain a labeled fallback when no month-associated photos have been found.
  const seasonal = all.filter((entry) => entry.monthMatched);
  const pool = seasonal.length ? seasonal : all;
  const ordered = [...pool].sort((a, b) => Number(b.landscape) - Number(a.landscape) || Number(b.observedMonth) - Number(a.observedMonth));
  const selected = [];
  const sourceUse = new Map();
  // Give distinct original records a turn before filling from one large album.
  while (ordered.length && selected.length < 5) {
    const bestTier = Math.max(...ordered.map((entry) => entry.landscape ? 2 : entry.subjectExcluded ? 0 : 1));
    const tier = ordered.filter((entry) => (entry.landscape ? 2 : entry.subjectExcluded ? 0 : 1) === bestTier);
    const least = Math.min(...tier.map((entry) => sourceUse.get(entry.sourceUrl || entry.source) || 0));
    const index = ordered.findIndex((entry) => (entry.landscape ? 2 : entry.subjectExcluded ? 0 : 1) === bestTier && (sourceUse.get(entry.sourceUrl || entry.source) || 0) === least);
    const entry = ordered.splice(index, 1)[0];
    selected.push(entry);
    const key = entry.sourceUrl || entry.source;
    sourceUse.set(key, (sourceUse.get(key) || 0) + 1);
  }
  return selected;
}
function stopPhotoCycle() { clearInterval(photoCycleTimer); photoCycleTimer = null; }
function startPhotoCycle() {
  stopPhotoCycle();
  if (document.hidden || state.openAttractionId || reducedMotion.matches || !photoDecks.size) return;
  photoCycleTimer = setInterval(() => {
    for (const deck of photoDecks) {
      if (!deck.element.isConnected || deck.paused || deck.element.matches(':hover') || deck.element.contains(document.activeElement)) continue;
      const bounds = deck.element.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) continue;
      deck.next();
    }
  }, 6000);
}
function createPhotoDeck(container, entries, attraction, card) {
  if (!entries.length) {
    container.classList.add('media-empty'); container.append(make('span', '', '这个月份的实景图还在搜集')); return;
  }
  const layers = [];
  const credit = make('span', 'image-credit');
  const time = make('span', 'photo-time');
  const count = make('span', 'photo-position');
  let index = 0;
  const show = (next) => {
    const available = layers.map((layer, i) => layer.failed ? -1 : i).filter((i) => i >= 0);
    if (!available.length) {
      container.classList.add('image-missing');
      credit.textContent = '照片暂不可用'; time.textContent = '点开景点查看原始资料'; count.textContent = ''; return;
    }
    index = available.includes(next) ? next : available.find((i) => i > next) ?? available[0];
    layers.forEach((layer, i) => { layer.image.classList.toggle('active', i === index); layer.image.setAttribute('aria-hidden', String(i !== index)); });
    const entry = entries[index];
    credit.textContent = `图源：${entry.credit || entry.source}`;
    time.textContent = entry.time;
    time.classList.toggle('unknown', isUnknownTime(entry.time));
    count.textContent = `${available.indexOf(index) + 1} / ${available.length}`;
  };
  for (const [i, entry] of entries.entries()) {
    const image = make('img', 'photo-slide'); image.src = entry.url; image.alt = `${attraction.name || '景点'} · ${entry.time}`; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
    const layer = { image, failed: false }; layers.push(layer);
    image.addEventListener('error', () => { layer.failed = true; image.classList.remove('active'); if (index === i) show((i + 1) % entries.length); }, { once: true });
    container.append(image);
  }
  container.append(credit, time);
  show(0);
  if (entries.length < 2) return;
  const deck = { element: card, paused: false, next: () => show((index + 1) % entries.length) };
  const controls = make('div', 'photo-controls');
  const pause = make('button', 'photo-control'); pause.type = 'button';
  const updatePause = () => {
    pause.hidden = reducedMotion.matches;
    pause.textContent = deck.paused ? '▷' : 'Ⅱ';
    pause.setAttribute('aria-label', deck.paused ? '继续照片轮换' : '暂停照片轮换');
    pause.setAttribute('aria-pressed', String(deck.paused));
    pause.title = deck.paused ? '继续轮换' : '暂停轮换';
  };
  pause.addEventListener('click', () => { deck.paused = !deck.paused; updatePause(); });
  const next = make('button', 'photo-control', '›'); next.type = 'button'; next.setAttribute('aria-label', '下一张照片'); next.title = '下一张照片'; next.addEventListener('click', deck.next);
  controls.append(count, pause, next); container.append(controls); updatePause();
  deck.updateMotion = updatePause;
  photoDecks.add(deck);
}
function renderAttractions() {
  stopPhotoCycle(); photoDecks.clear();
  const grid = clear($('#attractions-grid'));
  const attractions = (state.data?.attractions || []).filter(attractionQueryMatch).sort((a, b) => {
    const monthItems = (item) => attractionEvidence(item).filter((evidence) => integer(evidence.browse_month || evidence.month) === currentMonthNumber()).length;
    return monthItems(b) - monthItems(a);
  });
  $('#attractions-count').textContent = attractions.length ? `${attractions.length} 个景点` : '暂无匹配';
  $('#attractions-context').textContent = state.query
    ? `在 ${state.month} 月资料中搜索「${state.query}」；点开景点查看命中的原始记录。`
    : `${state.month} 月 · 点开感兴趣的景点，查看照片、路线与真实资料。`;
  if (!attractions.length) { grid.append(emptyBlock(state.query ? '没有找到匹配的景点' : '景点资料还在形成中', state.query ? '试试其他景点名或资料关键词。' : '选择其他月份，或展开自动搜集工作台补充资料。')); return; }
  attractions.slice(0, state.attractionLimit).forEach((attraction) => {
    const card = make('article', 'attraction-card');
    const media = make('div', 'attraction-media');
    const entries = cardMediaEntries(attraction);
    createPhotoDeck(media, entries, attraction, card);
    card.append(media);
    const body = make('div', 'attraction-body');
    const related = attractionEvidence(attraction);
    const seasonal = related.filter((item) => integer(item.browse_month || item.month) === currentMonthNumber());
    const eyebrow = make('div', 'card-eyebrow');
    eyebrow.append(make('span', '', seasonal.length ? `${state.month} 月 · ${seasonal.length} 条相关记录` : '景点背景资料'), make('span', '', `${attractionMediaEntries(attraction).length} 张图`)); body.append(eyebrow);
    const heading = make('h3'); const open = make('button', 'attraction-open', attraction.name || '未命名景点'); open.type = 'button'; open.setAttribute('aria-label', `查看${attraction.name || '景点'}的照片与真实资料`); open.addEventListener('click', () => openDrawer(attraction)); heading.append(open); body.append(heading);
    body.append(make('p', 'attraction-description', attraction.description || '点开查看已有照片与原始记录。'));
    body.append(make('span', 'card-detail-link', '照片与资料'), make('span', 'card-detail-arrow', '↗'));
    card.append(body); grid.append(card);
  });
  if (attractions.length > state.attractionLimit) {
    const more = make('button', 'more-attractions', `再看 ${attractions.length - state.attractionLimit} 个景点 ↓`); more.type = 'button';
    more.addEventListener('click', () => { const nextIndex = state.attractionLimit; state.attractionLimit = attractions.length; renderAttractions(); $('#attractions-grid').querySelectorAll('.attraction-open')[nextIndex]?.focus(); });
    grid.append(more);
  }
  startPhotoCycle();
}
function emptyBlock(title, description) { const block = make('div', 'empty-block'); block.append(make('span', 'empty-mark', '○'), make('h3', '', title), make('p', '', description)); return block; }

function isUnknownTime(value) {
  return !value || ['unknown', '未知', '未确认', '未提供', '未核验', '未独立核验', '背景资料', 'time_unknown'].some((marker) => String(value).toLowerCase().includes(marker));
}
function photoTimeText(item, fallback = '未确认') {
  if (item?.browse_time_basis === 'publication_month') return `${item.browse_year}年${item.browse_month}月发布 · 拍摄时间未知`;
  if (item?.time_basis === 'author_relative_date') return `推算 ${dateText(item.observed_start)} · 原帖相对时间`;
  if (item?.time_basis === 'author_explicit_date' && item.observed_start) return `${dateText(item.observed_start)} · 作者注明 · 照片未独立核验`;
  if (['author_explicit_month', 'author_month_only'].includes(item?.time_basis) && item.month) return `${item.year ? `${item.year}年` : '年份未知 · '}${item.month}月 · 作者注明 · 照片未独立核验`;
  const basis = item?.photo_time_basis || item?.time_excerpt || fallback;
  return basis;
}

function currentMonthEvidence() {
  const target = integer(state.month, 0);
  if (!target) return state.data?.evidence || [];
  return (state.data?.evidence || []).filter((item) => integer(item?.month, 0) === target);
}
function publicationMonthEvidence() {
  return (state.data?.evidence || []).filter((item) => item.browse_time_basis === 'publication_month' && integer(item.browse_month) === integer(state.month));
}
function evidenceMonthMatch(item) { return !state.month || integer(item?.month, 0) === integer(state.month, 0); }
function evidenceModeMatch(item) {
  if (state.mode === 'all') return true;
  const year = yearOf(item);
  if (state.mode === 'recent') {
    const materialDate = item?.material_date || item?.published_at || item?.published_label;
    const materialYear = materialDate && String(materialDate).match(/^(\d{4})/);
    return Boolean(item?.mode === 'recent' || item?.recent === true || (materialYear && integer(materialYear[1]) >= todayYear() - 1));
  }
  return Boolean(item?.mode === 'historical' || item?.historical === true || (year && year < todayYear() - 1));
}
function evidenceQueryMatch(item) {
  const query = state.query.trim().toLowerCase(); if (!query) return true;
  const haystack = [item.title, item.excerpt, item.publisher, item.place_name, item.source_type, item.confidence_label].filter(Boolean).join(' ').toLowerCase();
  return query.split(/\s+/).every((term) => haystack.includes(term));
}
function visibleEvidence({ ignoreQuery = false } = {}) {
  const items = state.data?.evidence || [];
  // The destination endpoint already applies month/mode semantics. The client
  // only searches the returned slice so unknown-time background material stays
  // visible and is labeled instead of being silently removed.
  return items.filter((item) => ignoreQuery || evidenceQueryMatch(item));
}
function timeBasis(item) {
  if (item?.browse_time_basis === 'publication_month') return `${item.browse_year}年${item.browse_month}月发布 · 暂归档`;
  if (item?.time_basis === 'author_relative_date') return `推算 ${dateText(item.observed_start)}`;
  if (item?.time_basis === 'author_explicit_date' && item.observed_start) return `${dateText(item.observed_start)} · 作者注明日期`;
  if (['author_explicit_month', 'author_month_only'].includes(item?.time_basis) && item.month) return `${item.year ? `${item.year}年` : '年份未知 · '}${item.month}月 · 作者注明月份`;
  if (item?.time_excerpt) return String(item.time_excerpt);
  if (item?.observed_start) return `现场观察 ${dateText(item.observed_start)}`;
  if (item?.month) return `${item.year ? `${item.year}年` : '年份未知 · '}${item.month}月记录`;
  if (item?.time_basis && item.time_basis !== 'background') return String(item.time_basis);
  return '时间依据未提供';
}
function confidenceClass(item) {
  const value = String(item?.confidence_label || '').toLowerCase();
  if (value.includes('不足') || value.includes('低') || value.includes('待') || value.includes('背景') || value.includes('未知') || value.includes('未核验')) return 'weak';
  if (value.includes('高') || value.includes('确认') || value.includes('supported')) return 'strong';
  return 'neutral';
}
function renderEvidence() {
  if (!state.openAttractionId) return;
  const attraction = (state.data?.attractions || []).find((item) => String(item.id || item.place_id) === state.openAttractionId);
  if (attraction) populateDrawer(attraction);
  else closeDrawer();
}
function evidenceCard(item) {
  const card = make('article', 'evidence-card');
  const media = make('div', 'evidence-media'); const sourceMedia = firstMedia(item);
  if (sourceMedia) {
    addImage(media, sourceMedia, item.title || '资料实景图');
    const basis = photoTimeText(item, timeBasis(item));
    media.append(make('span', `photo-time${isUnknownTime(basis) ? ' unknown' : ''}`, `时间依据：${basis}`));
  } else { media.classList.add('media-empty'); media.append(make('span', '', '原文未提供可展示图片')); }
  card.append(media);
  const body = make('div', 'evidence-body');
  const tags = make('div', 'evidence-tags'); tags.append(make('span', 'tag tag-source', sourceText(item.source_type || item.publisher))); const hasTimeEvidence = Boolean(item.observed_start || item.month || ['author_explicit_date', 'author_month_only'].includes(item.time_basis)); tags.append(make('span', `tag time-tag${hasTimeEvidence ? '' : ' weak'}`, timeBasis(item))); tags.append(make('span', `tag confidence-tag ${confidenceClass(item)}`, item.confidence_label || '时间/地点待核对')); body.append(tags);
  if (Array.isArray(item.topics) && item.topics.length) {
    const topics = make('div', 'topic-list'); item.topics.slice(0, 4).forEach((topic) => topics.append(make('span', 'topic-chip', topic))); body.append(topics);
  }
  body.append(make('h3', '', item.title || '未命名资料'), make('p', 'evidence-excerpt', item.excerpt || '原文摘要暂未提供。'));
  const meta = make('dl', 'evidence-meta'); meta.append(make('dt', '', '来源'), make('dd', '', item.publisher || sourceText(item.source_type))); meta.append(make('dt', '', '时间依据'), make('dd', '', item.time_excerpt || timeBasis(item))); if (item.material_date || item.material_time_basis) meta.append(make('dt', '', '资料日期'), make('dd', '', `${item.material_date ? dateText(item.material_date) : '未提供'} · ${item.material_time_basis || '依据未提供'}`)); else if (item.published_label || item.published_at) meta.append(make('dt', '', '资料日期'), make('dd', '', item.published_label || dateText(item.published_at))); body.append(meta);
  const visual = item.visual_analysis;
  if (visual?.media_total) {
    const label = visual.independence_status === 'shared_material_unresolved' ? '与其他原帖共享部分图片，独立性待核对'
      : visual.independence_status === 'exact_album_dependency' ? '发现相同相册，不增加独立票数'
      : visual.complete ? '未发现精确重复；仍不能证明独立拍摄' : '图片尚未全部检查，暂不参与共识投票';
    meta.append(make('dt', '', '图片检查'), make('dd', '', `${visual.analyzed_media}/${visual.media_total} 张 · ${label}`));
  }
  if (item.visual_content?.total) meta.append(make('dt', '', '图片内容'), make('dd', '', `已自动检查 ${item.visual_content.analyzed}/${item.visual_content.total} 张的主体，用于辅助选图，不证明季节`));
  const footer = make('div', 'evidence-footer'); const url = safeUrl(item.url || item.source_url); if (url) { const link = make('a', 'source-link', '打开原文 ↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; footer.append(link); } if (item.kind) footer.append(make('span', 'kind-label', kindText(item.kind))); body.append(footer);
  card.append(body); return card;
}

function renderChanges() {
  const list = clear($('#changes-list')); const changes = state.data?.changes || [];
  $('#changes-summary').textContent = changes.length ? `${changes.length} 条版本记录 · 点开查看来源与变化理由` : '尚无状态变更 · 后续更新会保留在这里';
  if (!changes.length) { list.append(emptyBlock('还没有版本变化', '当稳定状态因新证据发生改变时，前后值和依据会留在这里。')); return; }
  changes.slice(0, 12).forEach((change) => {
    const row = make('article', 'change-item');
    row.append(make('time', '', dateText(change.created_at)), make('div', 'change-main'));
    const body = $('.change-main', row); body.append(make('h3', '', change.title || change.aspect || '资料状态更新'));
    const transition = make('p', 'change-transition'); transition.append(make('span', '', change.before_value || '尚无记录'), make('b', '', '→'), make('strong', '', change.after_value || '尚无记录')); body.append(transition);
    if (change.reason) body.append(make('p', 'change-reason', change.reason));
    list.append(row);
  });
}

function renderBrowserInfo() {
  const info = $('#browser-info');
  if (!info) return;
  info.hidden = !state.browserInfoExpanded;
  clear(info);
  if (!state.browserInfoExpanded) return;
  const heading = isBuiltinBrowser() ? '内置浏览器采集' : '内置浏览器状态';
  const status = state.browserStatus === 'login_required' ? '请在需要登录的平台页面完成登录。' : state.browserStatus === 'verification_required' ? '请在对应平台页面完成验证。' : state.executorReady ? '当前任务可以执行采集；各平台登录状态会在读取时分别检查。' : '可以先排队，再在当前 Codex 任务中说“继续处理采集队列”。';
  info.append(make('strong', '', heading), make('span', '', '小红书与微博由当前 Codex 任务通过内置浏览器采集。'), make('small', '', `${status} 对话结束后不会自动执行新任务。`));
}
function renderSourceOptions() {
  const container = clear($('#source-options')); if (!container) return;
  const choices = ['official', 'xiaohongshu', 'weibo'];
  choices.forEach((key, index) => {
    const source = state.sources.find((candidate) => matchesSource(candidate, key));
    const social = key !== 'official';
    const ready = social ? isBuiltinBrowser() : Boolean(source && isReadySource(source));
    const option = make('div', `source-option${ready ? '' : ' not-ready'}`);
    const label = make('label', 'source-choice');
    const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.value = key; checkbox.checked = ready && state.selectedSourceKeys.has(key); checkbox.disabled = !ready;
    checkbox.addEventListener('change', () => {
      checkbox.checked ? state.selectedSourceKeys.add(key) : state.selectedSourceKeys.delete(key);
      clearJobForContext();
      renderJob();
    });
    label.append(checkbox, make('span', 'source-option-name', SOURCE_LABELS[key]));
    const sourceNote = social ? (ready ? state.executorReady ? '内置浏览器采集' : '可排队，等待 Codex 执行' : '需要内置浏览器') : ready ? '可自动搜集' : '连接器尚未就绪';
    label.append(make('small', '', sourceNote)); option.append(label);
    if (social && !ready) {
      const login = make('button', 'source-login-button', '内置浏览器'); login.type = 'button'; login.addEventListener('click', toggleBrowserInfo); option.append(login);
    }
    container.append(option);
  });
  container.append(make('small', 'source-scope-note', '每个来源每批最多读取 6 篇；社交平台需要当前 Codex 任务执行。'));
  const login = $('#login-button'); if (login) { login.textContent = '内置浏览器'; login.disabled = false; login.setAttribute('aria-expanded', String(state.browserInfoExpanded)); }
  renderBrowserInfo();
}
function selectedSources() { return Array.from(document.querySelectorAll('#source-options input:checked')).map((input) => input.value); }

function campaignModeForState() { return state.monthScope === 'practical' ? 'incremental' : state.mode === 'historical' ? 'baseline' : 'incremental'; }
function campaignButtonText() { return state.monthScope === 'practical' ? '搜集衣食住行资料' : state.monthScope === 'all' ? (state.mode === 'historical' ? '补充全年历史资料' : '补充全年近期资料') : state.mode === 'historical' ? '搜集历史基线' : '搜集当前月份'; }
function renderCollectionScope() {
  const input = $('#collection-month-scope');
  if (input) input.value = state.monthScope;
  const note = $('#collection-scope-note');
  if (note) note.textContent = state.monthScope === 'practical' ? '按美食街、住宿、站外交通、游览时长、路线和接驳车轮换关键词检索，原文自动进入 JeV 分类；不按发布月份限制。' : state.monthScope === 'all'
    ? '从全年缺少资料的月份中选择本批搜索，分散覆盖四季；每批最多 3 个目标，不表示一次完成全年。'
    : `围绕当前选择的 ${currentMonthNumber()} 月补充资料。切换为全年补缺，可自动寻找其他月份的缺口。`;
  const button = $('#campaign-button');
  if (button) button.textContent = campaignButtonText();
}
function normalizedSourceSet(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))].sort();
}
function contextSources() {
  const inputs = document.querySelectorAll('#source-options input[type="checkbox"]');
  return inputs.length ? selectedSources() : Array.from(state.selectedSourceKeys);
}
function jobMatchesContext(job, sources = contextSources()) {
  if (!job) return false;
  return String(job.place_id || '') === String(state.placeId || '')
    && (job.month_scope || 'selected') === state.monthScope
    && (state.monthScope !== 'selected' || Number(job.month) === currentMonthNumber())
    && String(job.mode || '') === campaignModeForState()
    && JSON.stringify(normalizedSourceSet(job.sources)) === JSON.stringify(normalizedSourceSet(sources));
}
function contextKey(sources = contextSources()) {
  return [String(state.placeId || ''), state.monthScope !== 'selected' ? state.monthScope : currentMonthNumber(), state.monthScope, campaignModeForState(), normalizedSourceSet(sources).join(',')].join('|');
}
function clearJobForContext(sources = contextSources()) {
  if (state.job && !jobMatchesContext(state.job, sources)) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
    state.job = null;
  }
}
function syncJobFromDestination() {
  const jobs = Array.isArray(state.data?.jobs) ? state.data.jobs : [];
  const current = state.job;
  if (current && jobMatchesContext(current)) {
    const fresh = jobs.find((job) => String(job.id) === String(current.id) && jobMatchesContext(job));
    if (fresh) {
      state.job = fresh;
      return;
    }
    // Keep an active job when the destination response's recent-job window
    // does not contain it; pollJob refreshes it by ID below.
    if (jobActive(current)) return;
  }
  const matching = jobs.filter((job) => jobMatchesContext(job));
  state.job = matching.find(jobActive) || matching[0] || null;
}

function jobActive(job) {
  if (!job) return false;
  if (TERMINAL_JOB_STATUS.has(String(job.status || '').toLowerCase())) return false;
  return number(job.progress, 0) < 100 || ['queued', 'running', 'collecting', 'started', 'pending', 'awaiting_browser'].includes(String(job.status || '').toLowerCase());
}
function jobLabel(job) {
  const status = String(job?.status || '').toLowerCase();
  if (status === 'queued') return '排队中';
  if (status === 'running' || status === 'collecting' || status === 'started') return '正在搜集';
  if (status === 'succeeded' || status === 'completed' || status === 'success' || status === 'done') return '搜集完成';
  if (status === 'partial') return '部分完成';
  if (status === 'blocked') return '等待连接器';
  if (status === 'awaiting_browser') return '等待内置浏览器采集';
  if (status === 'failed' || status === 'error') return '搜集未完成';
  if (status === 'preview_ready') return '预览就绪';
  if (status === 'preview_failed') return '预览失败';
  return jobStageText(job?.stage) || '任务状态';
}
function sourceResultLabel(result) {
  const status = String(result?.status || '').toLowerCase();
  if (status === 'empty_results') return '没有相关结果';
  if (['ready', 'succeeded', 'success', 'completed'].includes(status)) return '完成';
  if (['queued', 'running', 'collecting'].includes(status)) return '进行中';
  if (['blocked', 'not_ready', 'not_configured', 'unauthorized', 'login_required'].includes(status)) return '连接器未就绪';
  if (status === 'failed' || status === 'error') return '失败';
  if (status === 'partial') return '部分完成';
  if (status === 'skipped') return '已跳过';
  if (status === 'awaiting_browser') return '等待内置浏览器采集';
  if (status === 'preview_ready') return '预览就绪';
  if (status === 'preview_failed') return '预览失败';
  return status || '未返回状态';
}
const BROWSER_PLAN_STATE_LABELS = {
  pending: '尚未开始',
  search_observed: '已观察搜索',
  detail_saved: '已保存详情',
  completed: '完成',
  empty_results: '空结果',
  skipped_quota: '本批配额已满',
  login_required: '需要登录',
  verification_required: '需要平台验证',
};
const BROWSER_EXECUTION_STATUS_LABELS = {
  pending: '待执行',
  claimed: '执行中',
  ready_to_submit: '详情已整理',
  submitted: '完成',
  login_required: '需要登录',
  verification_required: '需要平台验证',
};
function browserPlanProgress(plan) {
  if (!plan || typeof plan !== 'object') return '';
  const status = String(plan.state || 'pending').toLowerCase();
  const documents = Array.isArray(plan.documents) ? plan.documents.length : 0;
  if (status === 'search_observed' && documents) return `已保存详情 ${documents} 篇`;
  if (status === 'completed' && documents) return `完成 · 已保存 ${documents} 篇`;
  return BROWSER_PLAN_STATE_LABELS[status] || status || '尚未开始';
}
function browserExecutionProgress(execution) {
  if (!execution || typeof execution !== 'object') return '';
  const plans = Array.isArray(execution.plans) ? execution.plans : [];
  const status = String(execution.status || '').toLowerCase();
  if (['login_required', 'verification_required'].includes(status)) return BROWSER_EXECUTION_STATUS_LABELS[status];
  if (status === 'submitted') return '完成';
  const completed = plans.filter(plan => String(plan?.state || '').toLowerCase() === 'completed').length;
  const empty = plans.filter(plan => String(plan?.state || '').toLowerCase() === 'empty_results').length;
  const quotaSkipped = plans.filter(plan => String(plan?.state || '').toLowerCase() === 'skipped_quota').length;
  const observed = plans.filter(plan => Boolean(plan?.search_observed_at) || ['search_observed', 'completed', 'empty_results'].includes(String(plan?.state || '').toLowerCase())).length;
  const documents = integer(execution.documents_count, plans.reduce((total, plan) => total + (Array.isArray(plan?.documents) ? plan.documents.length : 0), 0));
  const parts = [];
  if (observed) parts.push(`已观察搜索 ${observed}/${plans.length || observed}`);
  if (documents) parts.push(`已保存详情 ${documents} 篇`);
  if (completed) parts.push(`完成 ${completed}/${plans.length || completed}`);
  if (empty) parts.push(`空结果 ${empty}/${plans.length || empty}`);
  if (quotaSkipped) parts.push(`配额结束 ${quotaSkipped}/${plans.length || quotaSkipped}`);
  return parts.join(' · ') || BROWSER_EXECUTION_STATUS_LABELS[status] || status || '待执行';
}
const JOB_STAT_LABELS = { fetched: '读取', created: '新增', duplicates: '重复', media: '图片线索', errors: '错误', failed: '失败', baselines: '基线候选', stable_candidates: '稳定候选' };
const JOB_STAGE_LABELS = { preview_ready: '预览就绪', preview_failed: '预览失败', awaiting_browser: '等待内置浏览器采集' };
function jobStageText(value) { const raw = String(value || ''); return JOB_STAGE_LABELS[raw.toLowerCase()] || raw; }
function jobStatsText(stats) {
  return Object.entries(stats || {}).reduce((labels, [key, value]) => {
    if (key === 'source_results' || key === 'queries') return labels;
    if (typeof value === 'number') labels.push(`${JOB_STAT_LABELS[key] || key} ${value}`);
    else if (key === 'errors' && Array.isArray(value)) labels.push(`${JOB_STAT_LABELS.errors} ${value.length}`);
    return labels;
  }, []);
}
function renderJob(job = state.job) {
  const panel = $('#job-panel'); if (!panel) return;
  if (!job) { panel.hidden = true; $('#collection-summary').textContent = '选择来源，补充当前月份或全年资料'; const collect = $('#collect-button'); if (collect) { collect.disabled = !state.placeId; collect.innerHTML = '自动搜集 <span aria-hidden="true">↗</span>'; } return; }
  panel.hidden = false; clear(panel);
  $('#collection-summary').textContent = `${jobLabel(job)} · 点开查看搜索与整理进度`;
  const progress = progressPercent(job.progress, job.status);
  const head = make('div', 'job-head'); head.append(make('div', 'job-title-wrap'), make('span', 'job-status', jobLabel(job))); const title = $('.job-title-wrap', head); title.append(make('p', 'eyebrow', 'COLLECTION RUN'), make('h2', '', job.query || (state.month ? `${state.month} 月资料搜集` : '目的地资料搜集'))); panel.append(head);
  const track = make('div', 'progress-track'); const bar = make('span', 'progress-bar'); bar.style.width = `${progress}%`; track.append(bar); panel.append(track);
  const details = make('div', 'job-details'); details.append(make('span', '', `${jobStageText(job.stage) || jobLabel(job)} · ${Math.round(progress)}%`)); const stats = jobStatsText(job.stats); if (stats.length) details.append(make('span', '', stats.join(' · '))); if (job.created_at) details.append(make('span', '', `开始于 ${dateText(job.created_at)}`)); panel.append(details);
  const sourceResults = job.stats?.source_results && typeof job.stats.source_results === 'object' ? job.stats.source_results : {};
  const browserExecutions = job.browser_executions && typeof job.browser_executions === 'object' ? job.browser_executions : {};
  if (Array.isArray(job.search_plan) && job.search_plan.length) {
    const plan = make('details', 'job-search-plan');
    plan.append(make('summary', '', job.month_scope === 'all' ? '全年补缺 · 本轮搜索重点与执行记录' : '本轮搜索重点与执行记录'));
    const list = make('ul');
    for (const target of job.search_plan) {
      const item = make('li');
      item.append(make('strong', '', target.focus === 'practical' ? `${target.name} · ${PRACTICAL_LABELS[target.category] || '实用信息'}` : `${target.name} · ${target.year} 年 ${target.month} 月`));
      item.append(make('p', '', target.focus === 'practical' ? target.reason : `${target.reason || '补充现场资料'}；规划时已有 ${integer(target.coverage_groups)} 组带时间依据的记录。`));
      for (const [source, query] of Object.entries(target.source_queries || {})) {
        const executed = (sourceResults[source]?.executed_plan_ids || []).includes(target.id);
        const checkpoint = Array.isArray(browserExecutions[source]?.plans) ? browserExecutions[source].plans.find(plan => String(plan?.plan_id) === String(target.id)) : null;
        const executionLabel = checkpoint ? browserPlanProgress(checkpoint) : executed ? '已搜索' : '尚无执行记录';
        const scope = query.publication_start ? ` · 发布范围 ${query.publication_start} 至 ${query.publication_end}` : '';
        item.append(make('p', '', `${SOURCE_LABELS[source] || source} · ${executionLabel}：${query.query}${scope}`));
      }
      list.append(item);
    }
    plan.append(list, make('p', 'job-note', job.month_scope === 'practical' ? '关键词用于召回原文；JeV 归类后保留来源。实际班次、价格和游玩时长须核对原文适用条件。排队不计为已搜索。' : '搜索范围用于找资料；照片归入哪个月份，仍由原帖的现场时间依据决定。排队和登录检查不会记为已搜索。'));
    panel.append(plan);
  }
  const sourceRows = [...new Set([...Object.keys(sourceResults), ...Object.keys(browserExecutions)])].map(key => [key, sourceResults[key], browserExecutions[key]]);
  if (sourceRows.length) {
    const resultList = make('div', 'job-source-results');
    sourceRows.forEach(([key, result, execution]) => {
      const checkpointLabel = browserExecutionProgress(execution);
      const resultLabel = result && String(result.status || '').toLowerCase() !== 'awaiting_browser' ? sourceResultLabel(result) : checkpointLabel || sourceResultLabel(result);
      const resultClass = resultLabel === '完成' ? 'source-result-ok' : /(登录|验证|连接器)/.test(resultLabel) ? 'source-result-blocked' : '';
      const row = make('div', 'job-source-result'); row.append(make('span', '', SOURCE_LABELS[key] || key), make('strong', resultClass, resultLabel));
      if (execution && checkpointLabel && checkpointLabel !== resultLabel) row.append(make('small', '', `检查点：${checkpointLabel}`));
      if (Number.isInteger(result?.documents)) row.append(make('small', '', `已读取 ${result.documents} 篇原文`));
      else if (integer(execution?.documents_count, 0)) row.append(make('small', '', `已保存 ${integer(execution.documents_count)} 篇原帖详情`));
      if (Array.isArray(result?.executed_queries) && result.executed_queries.length) row.append(make('small', '', `实际搜索：${result.executed_queries.join('；')}`));
      else {
        const observedQueries = (Array.isArray(execution?.plans) ? execution.plans : []).map(plan => plan?.executed_query).filter(Boolean);
        if (observedQueries.length) row.append(make('small', '', `已观察：${observedQueries.join('；')}`));
      }
      const message = errorText(result?.message || result?.error || result?.errors); if (message) row.append(make('small', '', message.slice(0, 180))); resultList.append(row);
    });
    panel.append(resultList);
  }
  const jobError = errorText(job.error || job.errors);
  if (jobError) panel.append(make('p', 'job-error', jobError));
  const active = jobActive(job); const collect = $('#collect-button'); if (collect) { collect.disabled = !state.placeId; collect.innerHTML = active ? '搜集进行中 <span aria-hidden="true">…</span>' : '自动搜集 <span aria-hidden="true">↗</span>'; }
  const label = jobLabel(job);
  const note = active ? label === '等待内置浏览器采集' ? '采集由当前 Codex 任务执行；各平台分别检查登录。对话结束后不会自动执行新任务。' : '任务仍在运行；页面会继续读取目的地接口获取最新进度。' : label === '搜集完成' ? '新资料会先保留为候选，时间和来源依据仍会显示在资料卡上。' : label === '部分完成' ? '只有返回成功的来源会进入资料；未连接的平台会保留为未就绪。' : label === '等待连接器' ? '请连接对应平台，或先选择已经配置好的官网来源。' : label === '预览就绪' ? '预览资料已准备好，来源和图片仍按当前筛选展示。' : label === '预览失败' ? '预览没有准备完成，失败原因已保留。' : '可以稍后重试，失败原因已保留。'; panel.append(make('p', 'job-note', note));
}
async function pollJob() {
  if (!state.job || !jobActive(state.job) || !jobMatchesContext(state.job)) return;
  const campaignId = String(state.job.id);
  const context = contextKey();
  try {
    const found = await request(`/api/campaign/${encodeURIComponent(campaignId)}`);
    if (context !== contextKey()) return;
    if (!jobMatchesContext(found)) {
      state.job = null;
      renderJob();
      return;
    }
    state.job = found;
    await loadDestination({ silent: true });
    if (context !== contextKey()) return;
    renderJob();
    if (state.job && jobActive(state.job) && jobMatchesContext(state.job)) state.pollTimer = setTimeout(pollJob, 1600);
    else { renderSourceOptions(); renderStats(); renderEvidence(); loadStorage(); }
  } catch (error) {
    if (context !== contextKey()) return;
    if (error?.status === 404) {
      state.job = null;
      renderJob();
      return;
    }
    state.pollTimer = setTimeout(pollJob, 2200);
  }
}
async function startCampaign() {
  $('#collection-workbench').open = true;
  const sources = selectedSources();
  if (jobActive(state.job) && jobMatchesContext(state.job, sources)) { document.querySelector('#job-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  clearJobForContext(sources);
  if (!sources.length) { showNotice('当前还没有可用的自动搜集连接器。点击“连接平台账号”，或等待官网来源配置完成。', true); return; }
  if (state.monthScope === 'practical' && !sources.some(source => ['xiaohongshu', 'weibo'].includes(source))) { showNotice('衣食住行关键词检索需要选择小红书或微博；官网可一起补充。', true); return; }
  const campaignMode = campaignModeForState();
  const button = $('#campaign-button'); if (button) { button.disabled = true; button.textContent = '正在创建任务…'; }
  hideNotice();
  try {
    const job = await post('/api/campaign', { place_id: state.placeId, month: currentMonthNumber(), month_scope: state.monthScope, mode: campaignMode, limit: 6, sources });
    if (jobMatchesContext(job)) state.job = job;
    else syncJobFromDestination();
    renderJob();
    showToast('搜集任务已创建，页面会自动更新进度。');
    pollJob();
  } catch (error) {
    const connector = error.status === 404 || error.status === 409 || /连接器|尚未|未接入|权限|平台|browser|login/i.test(error.message || '');
    showNotice(connector ? `连接器尚未就绪：${readableError(error)}` : `无法创建搜集任务：${readableError(error)}`, true);
  } finally {
    if (button) { button.disabled = false; button.textContent = campaignButtonText(); }
  }
}
function toggleBrowserInfo() {
  state.browserInfoExpanded = !state.browserInfoExpanded;
  renderSourceOptions();
}

function renderAll() {
  renderPlacePicker(); renderMode(); renderHero(); renderStats(); renderMonths(); renderEssentials(); renderBaseline(); renderVisualCohorts(); renderLandscapeUpdates(); renderMap(); renderAttractions(); renderEvidence(); renderChanges(); renderSourceOptions(); renderJob();
  const collect = $('#collect-button'); if (collect) { const active = jobActive(state.job); collect.disabled = !state.placeId; collect.innerHTML = active ? '搜集进行中 <span aria-hidden="true">…</span>' : '自动搜集 <span aria-hidden="true">↗</span>'; }
  renderCollectionScope();
  document.dispatchEvent(new CustomEvent('chinatour:data', { detail: state.data }));
  window.CHINATOUR_PREVIEW?.render();
}
const MODE_LABELS = { all: '全部资料', recent: '近两年发布', historical: '历年同月' };
function attractionEvidence(attraction) {
  const id = String(attraction?.id || attraction?.place_id || '');
  const name = String(attraction?.name || '').trim().toLowerCase();
  return (state.data?.evidence || []).filter((item) => {
    const itemId = String(item?.place_id || item?.attraction_id || '');
    const itemName = String(item?.place_name || '').trim().toLowerCase();
    return (id && itemId === id) || (name && itemName === name);
  });
}
function attractionMediaEntries(attraction) {
  const entries = [];
  const seen = new Set();
  const add = (candidate, item = attraction) => {
    const candidateUrl = typeof candidate === 'string' ? candidate : candidate?.url || candidate?.src || candidate?.photo_url;
    const url = safeUrl(candidateUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const sourceUrl = safeUrl(item === attraction
      ? attraction?.photo_source_url || attraction?.source_url
      : item?.url || item?.source_url || attraction?.photo_source_url || attraction?.source_url);
    const time = item === attraction
      ? photoTimeText(attraction, attraction?.photo_time_basis || '未确认')
      : photoTimeText(item, timeBasis(item));
    entries.push({
      url,
      credit: (typeof candidate === 'object' && candidate?.credit) || item?.photo_credit || item?.publisher || (item === attraction ? attraction?.photo_credit : '') || sourceText(item?.source_type),
      source: item?.publisher || (item?.source_type ? sourceText(item.source_type) : '') || attraction?.photo_credit || '来源未注明',
      sourceUrl,
      title: item?.title || '',
      time,
      landscape: candidate?.scene_hint?.eligible === true,
      subjectExcluded: candidate?.scene_hint?.reason === 'prominent_non_landscape_subject',
      observedMonth: monthOf(item) === currentMonthNumber(),
      monthMatched: integer(item?.browse_month || item?.month) === currentMonthNumber(),
    });
  };
  attractionEvidence(attraction).forEach((item) => {
    if (Array.isArray(item.media) && item.media.length) item.media.forEach((media) => add(media, item));
    else add(item.photo_url || item.image_url || item.media_url, item);
  });
  add(attraction?.photo_url || attraction?.image_url, attraction);
  return entries;
}
function drawerPhoto(entry, attraction, index) {
  const figure = make('figure', 'drawer-photo');
  const frame = make('div', 'drawer-photo-frame');
  addImage(frame, { url: entry.url, credit: entry.credit }, `${attraction.name || '景点'}实景图 ${index + 1}`);
  frame.append(make('span', `photo-time${isUnknownTime(entry.time) ? ' unknown' : ''}`, `时间依据：${entry.time}`));
  figure.append(frame);
  const caption = make('figcaption', 'drawer-photo-caption');
  caption.append(make('strong', '', entry.source), make('span', '', entry.time));
  if (entry.title) caption.append(make('small', '', entry.title));
  if (entry.sourceUrl) {
    const link = make('a', '', '查看来源 ↗'); link.href = entry.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; caption.append(link);
  }
  figure.append(caption);
  return figure;
}
function localMapFor(attraction) {
  const id = String(attraction.id || attraction.place_id || '');
  const map = attraction.local_map || state.data?.map?.local_maps?.[id];
  if (!map || typeof map !== 'object') return null;
  const sourceUrl = safeUrl(map.source_url);
  const imageUrl = safeUrl(map.image_url) || (/^\/static\/maps\/[a-z0-9_-]+\.(?:jpg|jpeg|png|webp|svg)$/i.test(map.image_url || '') ? map.image_url : null);
  return sourceUrl && imageUrl ? { ...map, sourceUrl, imageUrl } : null;
}
function drawerLocalMap(attraction) {
  const map = localMapFor(attraction); if (!map) return null;
  const section = make('section', 'drawer-local-map');
  section.append(make('h3', '', map.title || '景区内，怎么走'));
  const imageLink = make('a', 'local-map-image'); imageLink.href = map.imageUrl; imageLink.target = '_blank'; imageLink.rel = 'noopener noreferrer'; imageLink.title = '打开景区游览图';
  const image = make('img'); image.src = map.imageUrl; image.alt = `${attraction.name || '景区'}局部游览图`; image.loading = 'lazy'; image.decoding = 'async';
  image.addEventListener('error', () => section.remove(), { once: true }); imageLink.append(image); section.append(imageLink);
  if (map.description) section.append(make('p', '', map.description));
  const source = make('a', 'source-link', `${map.source_label || '游览图来源'} ↗`); source.href = map.sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; section.append(source);
  return section;
}
function drawerEvidenceRow(item, index) {
  const row = make('details', 'drawer-record'); row.dataset.recordId = String(item.id || index);
  const summary = make('summary');
  const tags = make('span', 'drawer-record-tags'); tags.append(make('span', 'tag tag-source', sourceText(item.source_type)), make('span', 'drawer-record-time', timeBasis(item)));
  summary.append(tags, make('strong', '', item.title || '原始资料'));
  row.append(summary);
  const body = make('div', 'drawer-record-body');
  body.append(make('p', '', item.excerpt || '原始记录未提供摘要，可打开来源继续阅读。'));
  const facts = make('dl', 'drawer-facts');
  facts.append(make('dt', '', '发布者'), make('dd', '', item.publisher || sourceText(item.source_type)));
  facts.append(make('dt', '', '时间依据'), make('dd', '', item.time_excerpt || timeBasis(item)));
  if (item.material_date || item.published_label) facts.append(make('dt', '', '资料发布'), make('dd', '', item.material_date ? dateText(item.material_date) : item.published_label));
  if (item.browse_time_basis === 'publication_month') facts.append(make('dt', '', '当前归档'), make('dd', '', '按发布月份暂归档，拍摄时间未知'));
  body.append(facts);
  const url = safeUrl(item.url || item.source_url);
  if (url) { const link = make('a', 'drawer-source', '打开原文 ↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; body.append(link); }
  row.append(body); return row;
}
function populateDrawer(attraction) {
  const content = clear($('#drawer-content')); if (!content || !attraction) return;
  $('#drawer-title').textContent = attraction.name || '景点详情';
  $('#drawer-kicker').textContent = `${state.data?.destination?.name || '目的地'} · ${state.month} 月 · ${MODE_LABELS[state.mode] || '全部资料'}`;
  const related = attractionEvidence(attraction);
  const allEntries = attractionMediaEntries(attraction);
  const preferred = cardMediaEntries(attraction);
  const preferredUrls = new Set(preferred.map((entry) => entry.url));
  const entries = [...preferred, ...allEntries.filter((entry) => !preferredUrls.has(entry.url))];
  content.append(make('p', 'drawer-description', attraction.description || '暂无经核对的景点简介。'));
  content.append(drawerPractical(attraction));
  const filterNote = make('p', 'drawer-photo-note', '照片保留原始来源；人物近景、低清和待审核图片不展示。按发布月份暂归档的照片，拍摄时间仍未知。'); content.append(filterNote);
  const localMap = drawerLocalMap(attraction); if (localMap) content.append(localMap);
  const galleryBlock = make('section', 'drawer-gallery-block');
  const galleryHeading = make('div', 'drawer-gallery-heading'); galleryHeading.append(make('h3', '', '这个月份的照片'), make('span', '', `${entries.length} 张 · 含标注的背景资料`)); galleryBlock.append(galleryHeading);
  if (entries.length) {
    const gallery = make('div', 'drawer-gallery'); entries.slice(0, 6).forEach((entry, index) => gallery.append(drawerPhoto(entry, attraction, index))); galleryBlock.append(gallery);
    if (entries.length > 6) {
      const more = make('details', 'drawer-more-photos'); more.append(make('summary', '', `展开其余 ${entries.length - 6} 张照片`));
      more.addEventListener('toggle', () => {
        if (!more.open || more.dataset.loaded) return;
        const rest = make('div', 'drawer-gallery'); entries.slice(6).forEach((entry, index) => rest.append(drawerPhoto(entry, attraction, index + 6))); more.append(rest); more.dataset.loaded = 'true';
      }); galleryBlock.append(more);
    }
  } else galleryBlock.append(emptyBlock('暂无合适的展示照片', '已有文字资料保留在下方，清晰的景色照片待补充。'));
  content.append(galleryBlock);
  const records = make('section', 'drawer-records');
  const heading = make('div', 'drawer-gallery-heading'); heading.append(make('h3', '', '相关真实资料'), make('span', '', `${related.length} 条`)); records.append(heading);
  if (related.length) {
    const sorted = [...related].sort((a, b) => Number(monthOf(b) === currentMonthNumber()) - Number(monthOf(a) === currentMonthNumber()));
    sorted.forEach((item, index) => records.append(drawerEvidenceRow(item, index)));
  } else records.append(make('p', 'drawer-photo-note', '当前筛选下暂无可关联的原始资料。'));
  content.append(records);
}
function openDrawer(attraction) {
  const drawer = $('#detail-drawer'); if (!drawer || !attraction) return;
  state.drawerReturnFocus = document.activeElement;
  state.openAttractionId = String(attraction.id || attraction.place_id || '');
  populateDrawer(attraction);
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); document.body.classList.add('drawer-open');
  $('.drawer-panel', drawer).scrollTop = 0; stopPhotoCycle(); $('#close-drawer')?.focus();
}
function closeDrawer() {
  const drawer = $('#detail-drawer'); if (!drawer) return;
  const wasOpen = drawer.classList.contains('open');
  drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); document.body.classList.remove('drawer-open'); state.openAttractionId = null;
  if (wasOpen && state.drawerReturnFocus?.isConnected) state.drawerReturnFocus.focus();
  state.drawerReturnFocus = null; startPhotoCycle();
}

$('#place-picker')?.addEventListener('change', (event) => { state.placeId = event.target.value; state.attractionLimit = 6; state.data = null; clearJobForContext(); updateUrl(); loadDestination(); });
$('#mode-filter')?.addEventListener('click', (event) => { const button = event.target.closest('[data-mode]'); if (!button) return; state.mode = button.dataset.mode; state.attractionLimit = 6; clearJobForContext(); updateUrl(); renderMode(); loadDestination(); });
$('#search-input')?.addEventListener('input', (event) => { state.query = event.target.value || ''; state.attractionLimit = 6; renderAttractions(); });
$('#collect-button')?.addEventListener('click', () => { const workbench = $('#collection-workbench'); workbench.open = true; workbench.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' }); });
$('#campaign-button')?.addEventListener('click', startCampaign);
$('#collection-month-scope')?.addEventListener('change', (event) => {
  state.monthScope = ['all', 'practical'].includes(event.target.value) ? event.target.value : 'selected';
  clearJobForContext(); syncJobFromDestination(); updateUrl(); renderCollectionScope(); renderJob();
  if (state.job && jobActive(state.job)) pollJob();
});
$('#login-button')?.addEventListener('click', toggleBrowserInfo);
$('#close-drawer')?.addEventListener('click', closeDrawer);
document.querySelector('[data-close-drawer]')?.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDrawer();
  if (event.key !== 'Tab' || !state.openAttractionId) return;
  const focusable = [...$('#detail-drawer').querySelectorAll('button, a[href], summary, [tabindex="0"]')].filter((element) => element.getClientRects().length && !element.disabled);
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stopPhotoCycle(); else startPhotoCycle(); });
reducedMotion.addEventListener('change', () => { for (const deck of photoDecks) deck.updateMotion(); startPhotoCycle(); });
window.addEventListener('beforeunload', () => { clearTimeout(state.pollTimer); clearInterval(state.browserTimer); stopPhotoCycle(); });

async function initialize() {
  renderAll();
  await loadOverview();
  if (!window.CHINATOUR_PREVIEW) {
    await loadStorage();
    await loadBrowserStatus();
    state.browserTimer = setInterval(() => loadBrowserStatus(), 30000);
  }
  await loadDestination();
  syncJobFromDestination();
  renderJob();
  window.CHINATOUR_PREVIEW?.render();
  if (state.job && jobActive(state.job)) pollJob();
}
initialize();

// Practical information stays compact until a visitor chooses a topic.
const PRACTICAL_LABELS = { clothing: '天气与穿衣', food: '当地吃什么', stay: '住在哪里', transport: '从车站出发', visit_duration: '游玩时长', route_length: '游览路线与长度', internal_transport: '园内交通' };
function practicalFacts(category, name = null) {
  return (state.data?.practical?.facts || []).filter((item) => item.category === category && (!name || item.place_name === name || item.place_names?.includes(name)));
}
function practicalSources(categories, name = null) {
  return (state.data?.practical?.classified_sources || []).filter((item) => (!name || item.place_name === name) && (item.categories || []).some((category) => categories.includes(category)));
}
function sourceDetails(source, note) {
  const details = make('details', 'practical-source'); details.append(make('summary', '', '查看原文与适用时间'));
  if (note) details.append(make('p', '', note));
  if (source?.excerpt) details.append(make('blockquote', '', source.excerpt));
  const meta = [source?.publisher, source?.published_at ? `发布 ${dateText(source.published_at)}` : '原文未标发布日期', source?.checked_at ? `读取 ${dateText(source.checked_at)}` : ''].filter(Boolean).join(' · ');
  details.append(make('p', 'practical-meta', meta));
  const href = safeUrl(source?.url);
  if (href) { const link = make('a', 'source-link', `${source.title || '打开具体来源'} ↗`); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; details.append(link); }
  return details;
}
function practicalFactCard(fact) {
  const card = make('article', 'practical-fact');
  if (fact.place_name) card.append(make('span', 'practical-place', fact.place_name));
  card.append(make('h4', '', fact.title), make('p', '', fact.text));
  if (fact.timetable) {
    const schedule = make('details', 'practical-source'); schedule.append(make('summary', '', '展开往返时刻表'));
    for (const direction of ['outbound', 'inbound']) {
      const table = make('table', 'climate-table'); const caption = make('caption', '', direction === 'outbound' ? '去程 · 工作日无 08:40、15:50 班次' : '返程 · 工作日无 10:00、16:00 班次'); table.append(caption);
      const head = make('thead'); const row = make('tr');
      for (const text of direction === 'outbound' ? ['溧阳站', '山水园', '南山竹海'] : ['南山竹海', '山水园', '溧阳站']) row.append(make('th', '', text));
      head.append(row); table.append(head); const body = make('tbody');
      for (const times of fact.timetable[direction] || []) { const tr = make('tr'); times.forEach((time) => tr.append(make('td', '', time))); body.append(tr); }
      table.append(body); schedule.append(table);
    }
    card.append(schedule);
  }
  if (fact.time_note) card.append(make('p', 'practical-validity', fact.time_note));
  card.append(sourceDetails(fact.source));
  return card;
}
function classifiedSourceList(items) {
  const group = make('details', 'practical-related');
  group.append(make('summary', '', `JeV 找到的相关原文 · ${items.length} 条`));
  group.append(make('p', 'practical-meta', '以下为自动归类的资料线索。价格、时长和路线仍是原作者的说法，未汇总成平均值，也未视为已核实事实。'));
  for (const item of items) {
    const row = make('details', 'practical-source-row');
    row.append(make('summary', '', item.title || item.excerpt?.slice(0, 40) || '相关资料'));
    row.append(make('p', '', item.excerpt || '请打开原文查看。'));
    row.append(make('small', '', `${sourceText(item.source_type)} · ${item.publisher || '发布者未注明'} · ${item.published_at ? dateText(item.published_at) : '发布时间未提供'}`));
    const href = safeUrl(item.url);
    if (href) { const link = make('a', 'source-link', '查看原帖 ↗'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link); }
    group.append(row);
  }
  return group;
}
function temperature(value, unit = '°') { return Number.isFinite(value) ? `${value.toFixed(1)}${unit}` : '待补充'; }
function climatePanel(climate) {
  const block = make('div', 'climate-panel');
  if (!climate?.months?.length) { block.append(make('p', '', '尚未取得有统计口径的月平均气温。')); return block; }
  const current = climate.months.find((m) => m.month === currentMonthNumber());
  if (current) {
    const reading = make('div', 'climate-reading');
    reading.append(make('strong', '', `${temperature(current.mean_c, '°C')}`), make('p', '', `${state.month} 月平均气温`), make('span', '', `平均日最低 ${temperature(current.mean_low_c, '°C')} / 最高 ${temperature(current.mean_high_c, '°C')}`)); block.append(reading);
  }
  block.append(make('p', 'practical-meta', `${climate.label} · 历史网格估计，非当月天气预报`));
  const chart = make('div', 'climate-chart'); chart.setAttribute('aria-label', '12 个月平均气温');
  for (const entry of climate.months) {
    const col = make('div', `climate-column${entry.month === currentMonthNumber() ? ' selected' : ''}`);
    const bar = make('i'); bar.style.height = `${Math.max(4, (entry.mean_c + 5) * 2.9)}px`;
    col.append(make('strong', '', temperature(entry.mean_c)), bar, make('span', '', `${entry.month}月`));
    chart.append(col);
  }
  block.append(chart);
  const tableDetails = make('details', 'practical-source'); tableDetails.append(make('summary', '', '全年高低温与统计口径'));
  const table = make('table', 'climate-table'); const head = make('thead'); const headRow = make('tr');
  for (const label of ['月份', '平均气温', '平均日最低', '平均日最高']) headRow.append(make('th', '', label));
  head.append(headRow); table.append(head); const body = make('tbody');
  for (const entry of climate.months) { const row = make('tr'); [entry.month + '月', temperature(entry.mean_c, '°C'), temperature(entry.mean_low_c, '°C'), temperature(entry.mean_high_c, '°C')].forEach((value) => row.append(make('td', '', value))); body.append(row); }
  table.append(body); tableDetails.append(table, make('p', '', climate.method));
  for (const note of climate.notes || []) tableDetails.append(make('p', '', note));
  tableDetails.append(sourceDetails(climate.source)); block.append(tableDetails);
  return block;
}
function renderEssentials() {
  const grid = clear($('#essentials-grid')); const panel = clear($('#essentials-panel')); if (!grid || !panel) return;
  const data = state.data?.practical || {}; const current = data.climate?.months?.find((entry) => entry.month === currentMonthNumber());
  const screening = data.screening || {}; const status = $('#practical-screening-note');
  if (status) status.textContent = `实用原文分类：已完成 ${screening.classified || 0} / ${screening.total_sources || 0} 条；排队 ${screening.queued || 0}，处理中 ${screening.running || 0}，失败 ${screening.failed || 0}，尚未入队 ${screening.unqueued || 0}。分类用于找相关资料，不判断事实真伪。`;
  const food = practicalFacts('food'); const stays = practicalFacts('stay'); const travel = practicalFacts('transport');
  const tiles = [
    { id: 'clothing', icon: '衣', title: current ? `${state.month} 月均温 ${temperature(current.mean_c, '°C')}` : '每月气温', subtitle: '看全年温度变化' },
    { id: 'food', icon: '食', title: '小吃街与地方味', subtitle: food.length ? `${food.length} 条有来源的信息` : '从真实攻略找线索' },
    { id: 'stay', icon: '住', title: '酒店与山间民宿', subtitle: stays.length ? `${stays.length} 条住宿资料` : '房型、价位与评级' },
    { id: 'transport', icon: '行', title: state.placeId === 'liyang' ? '从溧阳站出发' : '如何抵达景点', subtitle: travel.length ? '公交线路 · 自驾路径' : '具体线路待补充' },
  ];
  for (const tile of tiles) {
    const button = make('button', `essential-button${state.practicalTab === tile.id ? ' active' : ''}`); button.type = 'button'; button.id = `essential-${tile.id}`;
    button.setAttribute('aria-expanded', String(state.practicalTab === tile.id)); button.setAttribute('aria-controls', 'essentials-panel');
    const text = make('span', 'essential-copy'); text.append(make('strong', '', tile.title), make('small', '', tile.subtitle));
    button.append(make('span', 'essential-mark', tile.icon), text, make('span', 'essential-arrow', state.practicalTab === tile.id ? '−' : '+'));
    button.addEventListener('click', () => { state.practicalTab = state.practicalTab === tile.id ? null : tile.id; renderEssentials(); $(`#essential-${tile.id}`)?.focus(); }); grid.append(button);
  }
  panel.hidden = !state.practicalTab;
  if (!state.practicalTab) return;
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', `essential-${state.practicalTab}`);
  const heading = make('div', 'essentials-heading'); heading.append(make('h3', '', PRACTICAL_LABELS[state.practicalTab]));
  const close = make('button', 'button button-quiet', '收起 ×'); close.type = 'button'; close.addEventListener('click', () => { const id = state.practicalTab; state.practicalTab = null; renderEssentials(); $(`#essential-${id}`)?.focus(); }); heading.append(close); panel.append(heading);
  if (state.practicalTab === 'clothing') {
    panel.append(climatePanel(data.climate));
    for (const fact of practicalFacts('clothing')) panel.append(practicalFactCard(fact));
  }
  else {
    const facts = practicalFacts(state.practicalTab); const list = make('div', 'practical-facts-grid');
    for (const fact of facts) list.append(practicalFactCard(fact));
    if (!facts.length) list.append(make('p', 'practical-meta', '暂缺可直接使用的信息；下方保留相关原文，继续补充后再整理。'));
    panel.append(list);
    if (state.practicalTab === 'stay') panel.append(make('p', 'practical-meta', '房价只展示有日期、房型和价格口径的报价；暂无可比样本时，不计算“平均房价”。酒店星级与平台评分分别记录。'));
    if (state.practicalTab === 'transport') panel.append(make('p', 'practical-meta', '以溧阳站作为本页出发点。尚未核实的地铁、班次、票价和车程不填估计值；具体线路留存原文的适用时间。'));
  }
  const related = practicalSources([state.practicalTab]); if (related.length) panel.append(classifiedSourceList(related));
}
function drawerPractical(attraction) {
  const section = make('section', 'drawer-practical'); section.append(make('h3', '', '怎样安排这一次游览'));
  const name = attraction.name;
  for (const category of ['visit_duration', 'route_length', 'internal_transport', 'transport']) {
    const facts = practicalFacts(category, name);
    const details = make('details', 'practical-drawer-row'); const summary = make('summary');
    summary.append(make('strong', '', category === 'transport' ? '如何抵达这里' : PRACTICAL_LABELS[category]), make('span', '', facts.length ? `${facts.length} 条来源信息` : '待补充'));
    details.append(summary);
    for (const fact of facts) details.append(practicalFactCard(fact));
    if (!facts.length) details.append(make('p', 'practical-meta', category === 'visit_duration' ? '尚无可比较的全程游玩时长；不把交通耗时或排队时间当作游玩时长。' : '当前资料还没有提供可核对的具体信息。'));
    section.append(details);
  }
  const related = practicalSources(['visit_duration', 'route_length', 'internal_transport', 'transport'], name);
  if (related.length) section.append(classifiedSourceList(related));
  return section;
}
