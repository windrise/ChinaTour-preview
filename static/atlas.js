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
  const stages = {
    china: { chapter:'01 / 从中国出发', title:['山河有时，','去见此刻。'], description:['把散落的真实风景，放回地图与四季。','从一个月份，找到你想去的地方。'], caption:'中国 · 选择溧阳，沿地图逐级抵达', location:'第一站 · 江苏', note:'一城湖光，万亩竹海。' },
    jiangsu: { chapter:'02 / 放大江苏', title:['沿着江南，','找到这一站。'], description:['从长江水岸，到苏南山野。','溧阳，藏在江苏西南的一片湖山里。'], caption:'江苏 · 溧阳位于常州市西南部', location:'江苏 · 常州', note:'下一站，走进溧阳。' },
    liyang: { chapter:'03 / 抵达溧阳', title:['一城湖光，','四时有景。'], description:['天目湖的水，南山的竹。','用有出处的照片，认识这个月份的溧阳。'], caption:'溧阳 · 开始查看月份与景点', location:'目的地已抵达', note:'打开实景、园内导览与真实资料。' },
  };
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
    svg=el('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':'中国省界、江苏市界与溧阳市轮廓'});
    const defs=el('defs');
    const pattern=el('pattern',{id:'atlas-grain',width:5,height:5,patternUnits:'userSpaceOnUse'});
    pattern.append(el('circle',{cx:1,cy:1,r:.4,fill:'#9bbaaa',opacity:.22}));defs.append(pattern);svg.append(defs);
    mapGroup=el('g'); countryGroup=el('g'); provinceGroup=el('g',{opacity:0});localGroup=el('g',{opacity:0});
    geometry.china.features.forEach(f => countryGroup.append(el('path',{d:pathData(f),class:`atlas-province${Number(f.properties.adcode)===320000?' is-jiangsu':''}`})));
    geometry.jiangsu.features.forEach(f=>provinceGroup.append(el('path',{d:pathData(f),class:`atlas-city${Number(f.properties.adcode)===320400?' is-changzhou':''}`})));
    geometry.liyang.features.forEach(f=>localGroup.append(el('path',{d:pathData(f),class:'atlas-liyang-shape'})));
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
  function pin(point,title,sub,action) {
    const [x,y]=toScreen(point);if(x<0||x>W||y<0||y>H)return;
    const g=el('g',{transform:`translate(${x},${y})`,class:'atlas-map-trigger',role:'button',tabindex:'0','aria-label':action==='browse'?'进入溧阳资料':'选择溧阳'});
    g.append(el('circle',{r:27,class:'atlas-pin-ring'}),el('circle',{r:15,class:'atlas-pin-ring'}),el('circle',{r:6,class:'atlas-pin-core'}));
    const right=x<W-160;const tx=right?37:-37;const anchor=right?'start':'end';
    g.append(el('path',{d:`M${right?13:-13},0 H${right?29:-29}`,stroke:'#d8bb83','stroke-width':.8}),textAt(tx,1,title,'atlas-pin-label'),textAt(tx,19,sub,'atlas-pin-sub'));
    g.querySelectorAll('text').forEach(t=>t.setAttribute('text-anchor',anchor));
    const click=()=>action==='browse'?showDestination():travel();g.addEventListener('click',click);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();click();}});labels.append(g);
  }
  function draw() {
    if(!camera)return;
    mapGroup.setAttribute('transform',`scale(${W/camera[2]}) translate(${-camera[0]},${-camera[1]})`);
    labels.replaceChildren();
    const center=geometry.liyang.features[0].properties.center||[119.4842,31.4271];
    if(stage==='china') {
      [['西藏',[88,31]],['新疆',[86,42]],['四川',[102,30]],['内蒙古',[112,44]]].forEach(([name,p])=>{const [x,y]=toScreen(p);labels.append(textAt(x,y,name,'atlas-city-label'));});
      pin(center,'溧阳','JIANGSU / LIYANG','travel');
      labels.append(textAt(815,580,'南海诸岛','atlas-city-label'));
    } else if(stage==='jiangsu') {
      geometry.jiangsu.features.forEach(f=>{if(Number(f.properties.adcode)===320400)return;const p=f.properties.centroid||f.properties.center;if(!p)return;const [x,y]=toScreen(p);if(y>20&&y<H-20)labels.append(textAt(x,y,f.properties.name.replace('市',''),'atlas-city-label'));});
      pin(center,'溧阳','CHANGZHOU / LIYANG','travel');
    } else {
      pin(center,'溧阳','EXPLORE THE SEASONS','browse');
      const [x,y]=toScreen(center);labels.append(textAt(x,y+120,'LIYANG','atlas-map-watermark'));
    }
    inset.style.display=stage==='china'?'':'none';
  }
  function setCopy(next) {
    const value=stages[next];$a('#atlas-chapter').textContent=value.chapter;
    const title=$a('#atlas-title');title.replaceChildren(document.createTextNode(value.title[0]),document.createElement('br'));
    const span=document.createElement('span');span.textContent=value.title[1];title.append(span);
    const description=$a('#atlas-description');description.replaceChildren(document.createTextNode(value.description[0]),document.createElement('br'),document.createTextNode(value.description[1]));
    $a('#atlas-map-caption').textContent=value.caption;$a('.atlas-pick-label').textContent=value.location;$a('#atlas-pick-note').textContent=value.note;
    document.querySelectorAll('[data-atlas-stage]').forEach(button=>{if(button.dataset.atlasStage===next)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
    entry.dataset.stage=next;$a('#atlas-announcement').textContent=value.caption;
    $a('#atlas-enter').setAttribute('aria-label',next==='liyang'?'进入溧阳资料':'选择溧阳，沿中国与江苏地图进入');
  }
  function changeStage(next,animate=true) {
    stage=next;setCopy(next);if(!geometry)return Promise.resolve();
    const features=geometry[next].features;
    const target=fitted(bounds(features,next==='china'?p=>p[1]>=18:()=>true),next==='china'?.08:.32);
    const start=camera.slice();const duration=animate&&!motion.matches?1050:0;const started=performance.now();const seq=++animation;
    countryGroup.style.opacity=next==='china'?'1':next==='jiangsu'?'.13':'.035';provinceGroup.style.opacity=next==='china'?'0':next==='jiangsu'?'1':'.12';localGroup.style.opacity=next==='liyang'?'1':'0';
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
    if(stage==='china'){await changeStage('jiangsu');if(token!==journey)return;await new Promise(resolve=>setTimeout(resolve,motion.matches?0:650));}
    if(token!==journey)return;
    if(stage!=='liyang'){await changeStage('liyang');if(token!==journey)return;await new Promise(resolve=>setTimeout(resolve,motion.matches?0:750));}
    if(token===journey)showDestination();
  }
  function cancelJourney() {journey++;animation++;entry.classList.remove('is-travelling');$a('#atlas-enter').disabled=false;}
  function showDestination(target='#month-explorer',update=true) {
    target=target==='#destination-map'?target:'#month-explorer';
    cancelJourney();document.body.classList.remove('atlas-landing');entry.setAttribute('aria-hidden','true');
    $a('#atlas-home').classList.remove('active');
    if(update){const url=new URL(location.href);url.searchParams.set('view','destination');url.searchParams.set('place_id','liyang');url.hash=target;history.pushState({atlas:false},'',url);}
    window.scrollTo({top:0,behavior:'instant'});
    if(target!=='#month-explorer')document.querySelector(target)?.scrollIntoView({behavior:motion.matches?'instant':'smooth'});
    else $a('#destination-title')?.focus({preventScroll:true});
    document.dispatchEvent(new CustomEvent('atlas:entered'));
  }
  function showAtlas(update=true) {
    cancelJourney();document.body.classList.add('atlas-landing');entry.removeAttribute('aria-hidden');$a('#atlas-home').classList.add('active');
    changeStage('china',false);if(update){const url=new URL(location.href);url.searchParams.delete('view');url.hash='';history.pushState({atlas:true},'',url);}window.scrollTo({top:0,behavior:'instant'});
  }
  $a('#atlas-enter').addEventListener('click',()=>stage==='liyang'?showDestination():travel());
  $a('#atlas-skip').addEventListener('click',()=>showDestination());
  $a('#atlas-home').addEventListener('click',()=>showAtlas());
  document.querySelectorAll('[data-atlas-stage]').forEach(button=>button.addEventListener('click',()=>{cancelJourney();changeStage(button.dataset.atlasStage);}));
  document.querySelectorAll('.header-nav a[href^="#"]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();showDestination(link.getAttribute('href'));}));
  window.addEventListener('popstate',()=>{if(new URLSearchParams(location.search).get('view')==='destination')showDestination(location.hash||'#month-explorer',false);else showAtlas(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('atlas-landing')){cancelJourney();changeStage('china');}});
  document.addEventListener('chinatour:data',event=>{
    const data=event.detail;const hero=$a('#destination-hero-photo');const credit=$a('#destination-hero-credit');
    // Keep the editorial background separate from evidence for the chosen month.
    // Use the existing subject gate so portraits and unclassified frames do not become a hero.
    const candidates=(data?.evidence||[]).flatMap(item=>(item.media||[])
      .filter(media=>media.scene_hint?.eligible&&/^\/api\/media\/[a-f0-9]{24}$/.test(media.url||''))
      .map(media=>({item,media,rank:(item.place_name==='天目湖山水园'?10:0)+(media.scene_hint.scene_scores?.water||0)})))
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
  fetch(window.CHINATOUR_PREVIEW?window.CHINATOUR_PREVIEW.assetUrl('/static/atlas-geography.json'):'/static/atlas-geography.json').then(r=>{if(!r.ok)throw new Error('map');return r.json();}).then(data=>{geometry=data;build();changeStage(stage,false);}).catch(()=>{$a('#atlas-map-failure').hidden=false;});
})();
