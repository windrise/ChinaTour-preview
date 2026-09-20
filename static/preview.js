/* Static, read-only transport for exported GitHub Pages previews. */
(() => {
  'use strict';
  const meta = window.CHINATOUR_PREVIEW_META;
  if (!meta) return;
  const base = new URL('./', location.href);
  const assetUrl = value => new URL(String(value).replace(/^\//, ''), base).href;
  const mediaUrl = value => {
    const match = String(value || '').match(/^\/api\/media\/([a-f0-9]{24})$/i);
    return match && meta.media[match[1]] ? assetUrl(meta.media[match[1]]) : null;
  };
  function hydrate(value) {
    if (typeof value === 'string' && value.startsWith('/static/')) return assetUrl(value);
    if (Array.isArray(value)) return value.map(hydrate);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,hydrate(v)]));
    return value;
  }
  const reply = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
  async function request(path, options = {}) {
    if ((options.method || 'GET').toUpperCase() !== 'GET') return reply({detail:'在线预览仅供浏览；采集在本机工作台运行。'},405);
    const url = new URL(path, location.origin);
    let filename;
    if (url.pathname === '/api/overview') filename = 'api/overview.json';
    else if (url.pathname === '/api/places') filename = 'api/places.json';
    else if (url.pathname === '/api/destination') {
      const place = url.searchParams.get('place_id') || meta.defaultPlace;
      const month = Number(url.searchParams.get('month') || meta.defaultMonth);
      const mode = url.searchParams.get('mode') || 'all';
      if (place !== meta.defaultPlace || !Number.isInteger(month) || month < 1 || month > 12 || !['all','recent','historical'].includes(mode)) return reply({detail:'此预览只包含溧阳的十二个月资料。'},404);
      filename = `api/destination-${place}-${month}-${mode}.json`;
    } else return reply({detail:'此功能仅在本机工作台提供。'},404);
    const result = await fetch(assetUrl(filename) + '?v=' + encodeURIComponent(meta.snapshotAt));
    if (!result.ok) return reply({detail:'预览资料加载失败，请刷新重试。'},result.status);
    return reply(hydrate(await result.json()));
  }
  function render() {
    document.body.classList.add('preview-mode');
    const campaign = document.getElementById('campaign-button');
    if (campaign) { campaign.disabled = true; campaign.textContent = '采集在本机运行'; }
    const scope = document.getElementById('collection-month-scope');
    if (scope) scope.disabled = true;
    const summary = document.getElementById('collection-summary');
    if (summary) summary.textContent = '在线预览只读 · 后续采集在本机工作台运行';
    const note = document.getElementById('storage-note');
    if (note) note.textContent = '此页面展示一次已发布的资料快照；采集完成后需重新发布，才会更新在线内容。';
    const sourceOptions = document.getElementById('source-options');
    if (sourceOptions) sourceOptions.textContent = '已接入：官方来源、小红书、微博。社交采集依赖已登录的本机浏览器。';
    if (!document.getElementById('preview-badge')) {
      const badge = document.createElement('div'); badge.id = 'preview-badge'; badge.className = 'preview-badge';
      const date = new Date(meta.snapshotAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
      badge.textContent = `在线预览 · 资料快照 ${date} · 采集在本机运行`;
      document.querySelector('.site-header').after(badge);
    }
  }
  window.CHINATOUR_PREVIEW = { request, assetUrl, mediaUrl, render, basePath:base.pathname, snapshotAt:meta.snapshotAt };
})();
