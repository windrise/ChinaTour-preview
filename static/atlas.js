/* Local, dependency-free geographic entrance. Source geometry is kept intact. */
(() => {
  'use strict';
  const entry = document.getElementById('atlas-entry');
  if (!entry) return;
  const $a = (selector) => document.querySelector(selector);
  const ns = 'http://www.w3.org/2000/svg';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let geometry, camera, stage = 'china', animation = 0, journey = 0;
  let svg, mapGroup, labels, countryGroup, provinceGroup, localGroup, inset;
  const W = 900, H = 620;
  let selectedId = new URLSearchParams(location.search).get('place_id') || window.CHINATOUR_PREVIEW_META?.defaultPlace || '';
  let destinations = [];
  function destination() { return destinations.find(item => item.id === selectedId) || { id:selectedId, name:'目的地', latin:'CHINA', province_name:'省域' }; }
  function featuresFor(level) {
    const place = destination();
    return geometry?.[level === 'china' ? 'china' : level === 'province' ? place.province_key : place.local_key]?.features || [];
  }
  function centerOf(place) { return place.center || geometry?.[place.local_key]?.features?.[0]?.properties?.center; }
  function stageCopy(level) {
    const p = destination();
    if (level === 'china') return { chapter:'01 / 从中国出发', title:['山河有时，','去见此刻。'], description:['把散落的真实风景，放回地图与四季。','从一个月份，找到你想去的地方。'], caption:`中国 · 选择${p.name}，沿地图逐级抵达`, location:`这一站 · ${p.province_name}`, note:p.tagline || '循着地图，走进真实风景。' };
    if (level === 'province') return { chapter:`02 / 放大${p.province_name}`, title:[`沿着${p.province_name}，`,'找到这一站。'], description:[p.province_description || `在${p.province_name}的地图里，找到${p.name}。`,'先认清方位，再慢慢走近。'], caption:`${p.province_name} · ${p.name}的地理位置`, location:p.province_name, note:`下一站，走进${p.name}。` };
    return { chapter:`03 / 抵达${p.name}`, title:[`走进${p.name}，`,'四时有景。'], description:[p.description || p.tagline || '跟着真实资料，认识这个地方。',`用有出处的照片，认识这个月份的${p.name}。`], caption:`${p.name} · 开始查看月份与景点`, location:'目的地已抵达', note:'打开实景、园内导览与真实资料。' };
  }
  function el(tag, attrs = {}, text) {
    const node = document.createElementNS(ns,tag);
    Object.entries(attrs).forEach(([key,value]) => node.setAttribute(key,String(value)));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function project([lon,lat]) { return [lon, -Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))*180/Math.PI]; }
  function coordinateRings(feature) {
    const g = feature.geometry;
    if (g.type === 'Polygon') return g.coordinates;
    if (g.type === 'MultiPolygon') return g.coordinates.flat();
    if (g.type === 'LineString') return [g.coordinates];
    if (g.type === 'MultiLineString') return g.coordinates;
    return [];
  }
  function pathData(feature) {
    return coordinateRings(feature).map(ring => ring.map((p,i) => `${i?'L':'M'}${project(p).map(v=>v.toFixed(5)).join(',')}`).join('') + (feature.geometry.type.includes('Polygon')?'Z':'')).join('');
  }
  function bounds(features, predicate=()=>true) {
    const pts=features.flatMap(coordinateRings).flat().filter(predicate).map(project);
    return [Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];
  }
  function fitted(box,padding=.13) {
    let width=(box[2]-box[0])*(1+padding),height=(box[3]-box[1])*(1+padding);
    const cx=(box[0]+box[2])/2,cy=(box[1]+box[3])/2;
    if(width/height>W/H) height=width*H/W; else width=height*W/H;
    return [cx-width/2,cy-height/2,width,height];
  }
  function toScreen(point) {
    const p=project(point); return [(p[0]-camera[0])*W/camera[2],(p[1]-camera[1])*H/camera[3]];
  }
  function textAt(x,y,text,cls='atlas-dot-text') { return el('text',{x,y,class:cls},text); }
  function build() {
    const place = destination();
    svg=el('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':`中国省界、${place.province_name}市界与${place.name}轮廓`});
    const defs=el('defs');
    const pattern=el('pattern',{id:'atlas-grain',width:5,height:5,patternUnits:'userSpaceOnUse'});
    pattern.append(el('circle',{cx:1,cy:1,r:.4,fill:'#9bbaaa',opacity:.22}));defs.append(pattern);svg.append(defs);
    mapGroup=el('g'); countryGroup=el('g'); provinceGroup=el('g',{opacity:0});localGroup=el('g',{opacity:0});
    featuresFor('china').forEach(f => countryGroup.append(el('path',{d:pathData(f),class:`atlas-province${Number(f.properties.adcode)===Number(place.province_adcode)?' is-selected':''}`})));
    featuresFor('province').forEach(f=>provinceGroup.append(el('path',{d:pathData(f),class:`atlas-city${Number(f.properties.adcode)===Number(place.city_adcode)?' is-selected':''}`})));
    featuresFor('local').forEach(f=>localGroup.append(el('path',{d:pathData(f),class:'atlas-local-shape'})));
    mapGroup.append(countryGroup,provinceGroup,localGroup);svg.append(mapGroup);labels=el('g');svg.append(labels);
    // The same unmodified southern geometry is also shown in a separate inset.
    // This lets the national outline remain legible without discarding islands.
    inset=el('svg',{x:775,y:450,width:80,height:110,viewBox:'105 -25 20 24','aria-label':'南海诸岛附图'});
    inset.append(el('rect',{x:105,y:-25,width:20,height:24,fill:'#0b161a',stroke:'#526d60','stroke-width':.12}));
    geometry.china.features.forEach(f=>inset.append(el('path',{d:pathData(f),fill:'#1b3430',stroke:'#638371','stroke-width':.12})));
    svg.append(inset);$a('#atlas-map-mount').replaceChildren(svg);
    camera=fitted(bounds(geometry.china.features,p=>p[1]>=18),.08);
    draw();entry.classList.add('is-ready');
  }
  function pin(point,title,sub,action,placeId=selectedId) {
    if (!Array.isArray(point) || point.length < 2) return;
    const [x,y]=toScreen(point);if(x<0||x>W||y<0||y>H)return;
    const g=el('g',{transform:`translate(${x},${y})`,class:`atlas-map-trigger${placeId===selectedId?' is-selected':''}`,role:'button',tabindex:'0','aria-label':`${action==='browse'?'进入':'选择'}${title}${action==='browse'?'资料':''}`});
    g.append(el('circle',{r:27,class:'atlas-pin-ring'}),el('circle',{r:15,class:'atlas-pin-ring'}),el('circle',{r:6,class:'atlas-pin-core'}));
    const right=x<W-160;const tx=right?37:-37;const anchor=right?'start':'end';
    g.append(el('path',{d:`M${right?13:-13},0 H${right?29:-29}`,stroke:'#d8bb83','stroke-width':.8}),textAt(tx,1,title,'atlas-pin-label'),textAt(tx,19,sub,'atlas-pin-sub'));
    g.querySelectorAll('text').forEach(t=>t.setAttribute('text-anchor',anchor));
    const click=()=>{ if (placeId!==selectedId) selectPlace(placeId); action==='browse'?showDestination():travel(); };g.addEventListener('click',click);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();click();}});labels.append(g);
  }
  function draw() {
    if(!camera)return;
    mapGroup.setAttribute('transform',`scale(${W/camera[2]}) translate(${-camera[0]},${-camera[1]})`);
    labels.replaceChildren();
    const place=destination(); const center=centerOf(place);
    if(stage==='china') {
      [['西藏',[88,31]],['新疆',[86,42]],['四川',[102,30]],['内蒙古',[112,44]]].forEach(([name,p])=>{const [x,y]=toScreen(p);labels.append(textAt(x,y,name,'atlas-city-label'));});
      destinations.forEach(item=>pin(centerOf(item),item.name,`${item.province_name} / ${item.latin || item.id.toUpperCase()}`,'travel',item.id));
      labels.append(textAt(815,580,'南海诸岛','atlas-city-label'));
    } else if(stage==='province') {
      featuresFor('province').forEach(f=>{if(Number(f.properties.adcode)===Number(place.city_adcode))return;const p=f.properties.centroid||f.properties.center;if(!p)return;const [x,y]=toScreen(p);if(y>20&&y<H-20)labels.append(textAt(x,y,String(f.properties.name || '').replace('市',''),'atlas-city-label'));});
      pin(center,place.name,place.latin || place.id.toUpperCase(),'travel');
    } else {
      pin(center,place.name,'EXPLORE THE SEASONS','browse');
      if (center) { const [x,y]=toScreen(center);labels.append(textAt(x,y+120,place.latin || place.id.toUpperCase(),'atlas-map-watermark')); }
    }
    inset.style.display=stage==='china'?'':'none';
  }
  function setCopy(next) {
    const place=destination(); const value=stageCopy(next);$a('#atlas-chapter').textContent=value.chapter;
    const title=$a('#atlas-title');title.replaceChildren(document.createTextNode(value.title[0]),document.createElement('br'));
    const span=document.createElement('span');span.textContent=value.title[1];title.append(span);
    const description=$a('#atlas-description');description.replaceChildren(document.createTextNode(value.description[0]),document.createElement('br'),document.createTextNode(value.description[1]));
    $a('#atlas-map-caption').textContent=value.caption;$a('.atlas-pick-label').textContent=value.location;$a('#atlas-pick-note').textContent=value.note;
    document.querySelectorAll('[data-atlas-stage]').forEach(button=>{if(button.dataset.atlasStage===next)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
    entry.dataset.stage=next;$a('#atlas-announcement').textContent=value.caption;
    $a('#atlas-enter').setAttribute('aria-label',next==='local'?`进入${place.name}资料`:`选择${place.name}，沿中国与${place.province_name}地图进入`);
    $a('#atlas-enter strong').textContent=place.name;$a('#atlas-enter small').textContent=place.latin || place.id.toUpperCase();
    $a('#atlas-skip').replaceChildren(document.createTextNode(`直接浏览${place.name}资料 `));$a('#atlas-skip').append(document.createTextNode('→'));
    $a('[data-atlas-stage="province"]>span').textContent=place.province_name;$a('[data-atlas-stage="local"]>span').textContent=place.name;
    $a('#atlas-place-picker').value=selectedId;
    const center=centerOf(place);$a('#atlas-coordinate').textContent=center?`${Math.abs(center[1]).toFixed(2)}° ${center[1]>=0?'N':'S'} / ${Math.abs(center[0]).toFixed(2)}° ${center[0]>=0?'E':'W'}`:'';
    $a('#atlas-map-mount').setAttribute('aria-label',`中国、${place.province_name}与${place.name}的地理层级地图`);
  }
  function changeStage(next,animate=true) {
    if(!['china','province','local'].includes(next))return Promise.resolve();
    stage=next;setCopy(next);if(!geometry)return Promise.resolve();
    const features=featuresFor(next);if(!features.length)return Promise.resolve();
    const target=fitted(bounds(features,next==='china'?p=>p[1]>=18:()=>true),next==='china'?.08:.32);
    const start=camera.slice();const duration=animate&&!motion.matches?1050:0;const started=performance.now();const seq=++animation;
    countryGroup.style.opacity=next==='china'?'1':next==='province'?'.13':'.035';provinceGroup.style.opacity=next==='china'?'0':next==='province'?'1':'.12';localGroup.style.opacity=next==='local'?'1':'0';
    return new Promise(resolve=>{
      const step=now=>{if(seq!==animation){resolve();return;}const t=duration?Math.min(1,(now-started)/duration):1;const eased=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
        // Log interpolation gives a camera-like zoom rather than a linear jump.
        const width=start[2]*Math.pow(target[2]/start[2],eased);const height=width*H/W;
        const cx=(start[0]+start[2]/2)*(1-eased)+(target[0]+target[2]/2)*eased,cy=(start[1]+start[3]/2)*(1-eased)+(target[1]+target[3]/2)*eased;
        camera=[cx-width/2,cy-height/2,width,height];draw();if(t<1)requestAnimationFrame(step);else resolve();};requestAnimationFrame(step);
    });
  }
  async function travel() {
    if(!geometry){showDestination();return;}
    if(entry.classList.contains('is-travelling'))return;
    const token=++journey;entry.classList.add('is-travelling');
    $a('#atlas-enter').disabled=true;
    if(stage==='china'){await changeStage('province');if(token!==journey)return;await new Promise(resolve=>setTimeout(resolve,motion.matches?0:650));}
    if(token!==journey)return;
    if(stage!=='local'){await changeStage('local');if(token!==journey)return;await new Promise(resolve=>setTimeout(resolve,motion.matches?0:750));}
    if(token===journey)showDestination();
  }
  function cancelJourney() {journey++;animation++;entry.classList.remove('is-travelling');$a('#atlas-enter').disabled=false;}
  function selectPlace(placeId,notify=true) {
    if(!destinations.some(item=>item.id===placeId))return;
    cancelJourney();selectedId=placeId;stage='china';build();changeStage('china',false);
    if(notify)document.dispatchEvent(new CustomEvent('chinatour:select-place',{detail:{placeId}}));
  }
  function showDestination(target='#month-explorer',update=true) {
    target=target==='#destination-map'?target:'#month-explorer';
    cancelJourney();document.body.classList.remove('atlas-landing');entry.setAttribute('aria-hidden','true');
    $a('#atlas-home').classList.remove('active');
    if(update){const url=new URL(location.href);url.searchParams.set('view','destination');if(selectedId)url.searchParams.set('place_id',selectedId);url.hash=target;history.pushState({atlas:false},'',url);}
    window.scrollTo({top:0,behavior:'instant'});
    if(target!=='#month-explorer')document.querySelector(target)?.scrollIntoView({behavior:motion.matches?'instant':'smooth'});
    else $a('#destination-title')?.focus({preventScroll:true});
    document.dispatchEvent(new CustomEvent('atlas:entered'));
  }
  function showAtlas(update=true) {
    cancelJourney();document.body.classList.add('atlas-landing');entry.removeAttribute('aria-hidden');$a('#atlas-home').classList.add('active');
    changeStage('china',false);if(update){const url=new URL(location.href);url.searchParams.delete('view');url.hash='';history.pushState({atlas:true},'',url);}window.scrollTo({top:0,behavior:'instant'});
  }
  $a('#atlas-enter').addEventListener('click',()=>stage==='local'?showDestination():travel());
  $a('#atlas-place-picker').addEventListener('change',event=>selectPlace(event.target.value));
  document.addEventListener('chinatour:place-selected',event=>{if(event.detail?.placeId!==selectedId)selectPlace(event.detail?.placeId,false);});
  $a('#atlas-skip').addEventListener('click',()=>showDestination());
  $a('#atlas-home').addEventListener('click',()=>showAtlas());
  document.querySelectorAll('[data-atlas-stage]').forEach(button=>button.addEventListener('click',()=>{cancelJourney();changeStage(button.dataset.atlasStage);}));
  document.querySelectorAll('.header-nav a[href^="#"]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();showDestination(link.getAttribute('href'));}));
  window.addEventListener('popstate',()=>{const params=new URLSearchParams(location.search);const next=params.get('place_id')||window.CHINATOUR_PREVIEW_META?.defaultPlace||destinations[0]?.id;if(next!==selectedId)selectPlace(next,false);if(params.get('view')==='destination')showDestination(location.hash||'#month-explorer',false);else showAtlas(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('atlas-landing')){cancelJourney();changeStage('china');}});
  document.addEventListener('chinatour:data',event=>{
    const data=event.detail;const hero=$a('#destination-hero-photo');const credit=$a('#destination-hero-credit');
    if(data?.destination?.id&&data.destination.id!==selectedId)selectPlace(data.destination.id,false);
    // Keep the editorial background separate from evidence for the chosen month.
    // Use the existing subject gate so portraits and unclassified frames do not become a hero.
    const candidates=(data?.evidence||[]).flatMap(item=>(item.media||[])
      .filter(media=>media.scene_hint?.eligible&&/^\/api\/media\/[a-f0-9]{24}$/.test(media.url||''))
      .map(media=>({item,media,rank:Math.max(0,...Object.values(media.scene_hint.scene_scores||{}).filter(Number.isFinite))})))
      .sort((a,b)=>b.rank-a.rank);
    const selected=candidates[0];
    if(!selected){hero.removeAttribute('src');credit.hidden=true;return;}
    const src=window.CHINATOUR_PREVIEW?window.CHINATOUR_PREVIEW.mediaUrl(selected.media.url):selected.media.url;
    if(!src){hero.removeAttribute('src');credit.hidden=true;return;}
    hero.src=src;hero.alt=`${selected.item.place_name||'目的地'}背景照片`;
    const source=selected.item.url||selected.item.source_url||'';
    if(/^https?:\/\//.test(source)){
      credit.href=source;credit.textContent=`背景图 · ${selected.item.publisher||'查看来源'} · 不作为当月实景依据 ↗`;credit.hidden=false;
    }else credit.hidden=true;
  });
  $a('#destination-title').setAttribute('tabindex','-1');
  if(new URLSearchParams(location.search).get('view')==='destination')showDestination(location.hash||'#month-explorer',false);
  fetch(window.CHINATOUR_PREVIEW?window.CHINATOUR_PREVIEW.assetUrl('/static/atlas-geography.json'):'/static/atlas-geography.json').then(r=>{if(!r.ok)throw new Error('map');return r.json();}).then(data=>{
    geometry=data;
    const available=window.CHINATOUR_PREVIEW_META?.places?.map(item=>typeof item==='string'?item:item.id);
    destinations=Object.entries(data.destinations||{}).map(([id,item])=>({...item,id})).filter(item=>(!available||available.includes(item.id))&&data[item.province_key]?.features?.length&&data[item.local_key]?.features?.length);
    if(!destinations.length)throw new Error('destinations');
    const picker=$a('#atlas-place-picker');picker.replaceChildren();destinations.forEach(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=`${item.name} · ${item.province_name}`;picker.append(option);});picker.disabled=false;
    const requested=destinations.some(item=>item.id===selectedId)?selectedId:destinations[0].id;
    selectPlace(requested,requested!==selectedId);
  }).catch(()=>{$a('#atlas-map-failure').hidden=false;});
})();
