const $ = s => document.querySelector(s);
const state = { data: null };
const n = (v, d = 2) => Number.isFinite(Number(v)) ? Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '--';
const pct = v => Number.isFinite(Number(v)) ? `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%` : '--';
const tone = v => Number(v) > 0 ? 'positive' : Number(v) < 0 ? 'negative' : 'neutral';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const text = (id, value) => { const el = $(id); if (el) el.textContent = value; };
const fmtTime = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
function clock() { text('#clock', new Date().toLocaleTimeString('zh-CN', { hour12:false })); if (state.data?.market.liveUpdatedAt) text('#freshness', `联网报价 · ${Math.max(0, Math.round((Date.now() - new Date(state.data.market.liveUpdatedAt)) / 1000))} 秒前`); }

function liveAsset(f, old, provider) { const value=Number(f[0]), previous=Number(f[7]), date=f[12], time=f[6]; if (!Number.isFinite(value)) throw Error('invalid quote'); return {...old, value, previous, change:previous ? (value/previous-1)*100 : old.change, open:Number(f[2]), high:Number(f[4]), low:Number(f[5]), quoteTime:`${date} ${time}`, provider}; }
function addPoint(asset) { const pts=asset.intraday||[]; const last=pts.at(-1); if(last && Date.now()-new Date(last.time).getTime()<150000) return; asset.intraday=[...pts,{time:new Date().toISOString(),value:asset.value}].slice(-290); }
function getTencent() { return new Promise((resolve,reject)=>{ const old=$('#tencentQuote'); if(old) old.remove(); const s=document.createElement('script'); s.id='tencentQuote'; s.src=`https://qt.gtimg.cn/q=hf_GC,hf_XAU&_=${Date.now()}`; const timer=setTimeout(()=>{s.remove();reject(Error('timeout'));},8000); s.onload=()=>{clearTimeout(timer);resolve([window.v_hf_GC,window.v_hf_XAU]);}; s.onerror=()=>{clearTimeout(timer);reject(Error('load failed'));}; document.head.appendChild(s); }); }
async function refreshLive(data) { try { const [gc,xau] = await getTencent(); const m=data.market; m.gold=liveAsset(String(gc).split(','),m.gold,'腾讯全球期货行情 · COMEX GC（实时）'); m.spotGold=liveAsset(String(xau).split(','),m.spotGold||{},'腾讯全球期货行情 · 伦敦现货 XAU（实时）'); addPoint(m.gold); const fx=Number(m.fx?.value); if(Number.isFinite(fx)) { const value=m.spotGold.value*fx/31.1034768,old=m.domesticReference||{}; m.domesticReference={value,change:old.value?(value/old.value-1)*100:0,quoteTime:m.spotGold.quoteTime,provider:'伦敦现货 × USD/CNY 折算的国内人民币克价参考'}; } m.liveUpdatedAt=new Date().toISOString(); if(data.goldForecast) data.goldForecast.marketDate=String(gc).split(',')[12]; return true; } catch(e) { console.warn('quote unavailable',e); return false; } }

function renderKpis(m) { const rows=[['COMEX 黄金主连 · 实时',m.gold,'USD/OZ'],['伦敦现货黄金 · 实时',m.spotGold,'USD/OZ'],['国内金价参考 · 人民币克价',m.domesticReference,'CNY/G']]; $('#kpiRibbon').innerHTML=rows.map(([name,a,u])=>`<article class="kpi"><small><span>${name}</span><span>${u}</span></small><strong>${n(a?.value)}</strong><em class="${tone(a?.change)}">${pct(a?.change)}</em><p>${esc(a?.quoteTime||'公开行情计算中')}</p></article>`).join(''); }

/* ---------- chart engine ---------- */
function setupCanvas(el, cssHeight) { const r=el.getBoundingClientRect(); const d=Math.min(devicePixelRatio||1,2); el.width=Math.max(1,Math.round(r.width*d)); el.height=Math.max(1,Math.round((cssHeight||r.height)*d)); const c=el.getContext('2d'); c.setTransform(d,0,0,d,0,0); return [c, r.width, cssHeight||r.height]; }
function drawCurve(el, points, opts) {
  // points: [{t: x-position value (Date ms or string), v: number}] ; opts: {height, xTicks(n)->[{pos,label}], mode:'daily'|'time'}
  if (!el || points.length < 2) return false;
  const W = el.parentElement.clientWidth, H = opts.height;
  const [c] = setupCanvas(el, H);
  const padL = 14, padR = 62, padT = 26, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const v = points.map(p => p.v);
  let lo = Math.min(...v), hi = Math.max(...v);
  const pad = Math.max((hi - lo) * 0.12, hi * 0.0015);
  lo -= pad; hi += pad;
  const X = i => padL + i * iw / (points.length - 1);
  const Y = val => padT + (hi - val) / (hi - lo) * ih;

  c.clearRect(0, 0, W, H);
  // horizontal grid + right price labels
  c.font = '500 10px "DM Mono", monospace';
  c.textAlign = 'left'; c.textBaseline = 'middle';
  for (let g = 0; g <= 4; g++) {
    const val = lo + (hi - lo) * g / 4, y = Y(val);
    c.strokeStyle = 'rgba(211,166,78,0.10)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(padL, y); c.lineTo(padL + iw, y); c.stroke();
    c.fillStyle = 'rgba(246,222,176,0.55)';
    c.fillText(val.toFixed(0), padL + iw + 8, y);
  }
  // area gradient
  const grad = c.createLinearGradient(0, padT, 0, padT + ih);
  grad.addColorStop(0, 'rgba(211,166,78,0.32)'); grad.addColorStop(1, 'rgba(211,166,78,0.02)');
  c.beginPath();
  points.forEach((p, i) => i ? c.lineTo(X(i), Y(p.v)) : c.moveTo(X(i), Y(p.v)));
  c.lineTo(X(points.length - 1), padT + ih); c.lineTo(X(0), padT + ih); c.closePath();
  c.fillStyle = grad; c.fill();
  // main line
  c.beginPath();
  points.forEach((p, i) => i ? c.lineTo(X(i), Y(p.v)) : c.moveTo(X(i), Y(p.v)));
  c.strokeStyle = '#d3a64e'; c.lineWidth = 1.8; c.lineJoin = 'round'; c.stroke();
  // x ticks
  c.fillStyle = 'rgba(246,222,176,0.6)'; c.textAlign = 'center'; c.textBaseline = 'top';
  const ticks = opts.xTicks(points);
  ticks.forEach(({ pos, label }) => c.fillText(label, Math.min(Math.max(pos, padL + 14), padL + iw - 14), padT + ih + 9));
  // last point + label
  const lastP = points.at(-1), lx = X(points.length - 1), ly = Y(lastP.v);
  c.beginPath(); c.arc(lx, ly, 3.2, 0, Math.PI * 2); c.fillStyle = '#f2d38b'; c.fill();
  c.beginPath(); c.arc(lx, ly, 7, 0, Math.PI * 2); c.strokeStyle = 'rgba(242,211,139,0.35)'; c.lineWidth = 1; c.stroke();
  const label = lastP.v.toFixed(1), lw = c.measureText(label).width + 12;
  const boxY = Math.min(Math.max(ly - 9, padT), padT + ih - 18);
  c.fillStyle = '#f2d38b'; c.beginPath(); c.roundRect(lx - 6, boxY, Math.min(lw, padR - 8), 18, 4); c.fill();
  c.fillStyle = '#141005'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = '700 10px "DM Mono", monospace';
  c.fillText(label, lx - 1, boxY + 9.5);
  return true;
}
function drawDaily(asset) {
  const el = $('#stockChart'); const rows = (asset.candles || []).slice(-30);
  $('#stockEmpty') && ($('#stockEmpty').style.display = rows.length < 2 ? 'flex' : 'none');
  if (!el || rows.length < 2) return;
  const today = new Date().toLocaleDateString('en-CA');
  const pts = rows.map(r => ({ t: r.date, v: r.date === today && Number.isFinite(asset.value) ? asset.value : r.close }));
  const ok = drawCurve(el, pts, {
    height: 250,
    xTicks(points) {
      const idx = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(f * (points.length - 1)));
      return [...new Set(idx)].map(i => ({ pos: 14 + i * (el.parentElement.clientWidth - 76) / (points.length - 1), label: points[i].t.slice(5).replace('-', '/') }));
    }
  });
  if (!ok) return;
  const v = pts.map(p => p.v), hi = Math.max(...v), lo = Math.min(...v);
  text('#dayHigh', n(hi, 1)); text('#dayLow', n(lo, 1));
  const first = v[0], last = v.at(-1), ch = (last / first - 1) * 100;
  const el2 = $('#dayChange'); text('#dayChange', pct(ch)); el2.className = tone(ch);
  text('#dailyStamp', `东方财富日K · ${rows.at(-1).date} · 每5分钟同步`);
}
function drawIntraday(asset) {
  const el = $('#intradayChart'); const p = (asset.intraday || []).filter(x => Number.isFinite(Number(x.value)));
  $('#intradayEmpty') && ($('#intradayEmpty').style.display = p.length < 2 ? 'flex' : 'none');
  if (!el || p.length < 2) return;
  const pts = p.map(x => ({ t: new Date(x.time).getTime(), v: +x.value }));
  const w = el.parentElement.clientWidth;
  const ok = drawCurve(el, pts, {
    height: 190,
    xTicks(points) {
      const end = points.at(-1).t, start = points[0].t;
      const out = [];
      for (let h = 0; h <= 24; h += 6) {
        const target = end - (24 - h) * 3600000;
        if (target < start - 600000) continue;
        let best = 0, bd = Infinity;
        points.forEach((q, i) => { const d = Math.abs(q.t - target); if (d < bd) { bd = d; best = i; } });
        out.push({ pos: 14 + best * (w - 76) / (points.length - 1), label: h === 24 ? '现在' : h === 0 ? '-24h' : `-${24 - h}h` });
      }
      const firstLabel = new Date(start); const hh = `${String(firstLabel.getHours()).padStart(2,'0')}:${String(firstLabel.getMinutes()).padStart(2,'0')}`;
      out.push({ pos: 14, label: hh });
      return out;
    }
  });
  if (!ok) return;
  const v = pts.map(x => x.v), hi = Math.max(...v), lo = Math.min(...v);
  text('#intradayHigh', n(hi, 1)); text('#intradayLow', n(lo, 1));
  const ch = (v.at(-1) / v[0] - 1) * 100;
  text('#intradayChange', pct(ch)); $('#intradayChange').className = tone(ch);
  text('#intradayCount', `${p.length} 点`);
  const stamp = asset.historyUpdatedAt ? `${fmtTime(asset.historyUpdatedAt)} 同步` : '实时采样中';
  text('#intradayStamp', `24h 5分钟线 · ${stamp} + 页面实时`);
}

function renderNews(news) { const items=(news.items||[]).filter(x=>x.category==='黄金'); $('#newsTimeline').innerHTML=items.length?items.map(x=>`<a class="news-item" href="${esc(x.url)}" target="_blank" rel="noopener"><time>${esc(x.time)}</time><div><h3>${esc(x.title)}</h3><p>${esc(x.summary||'公开黄金资讯')}</p><span>${esc(x.source||'公开来源')}</span></div></a>`).join(''):'<div class="news-item"><div>等待下一次公开资讯更新</div></div>'; if(news.updatedAt) text('#newsStamp',`每6小时更新 · ${new Date(news.updatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}`); }
function renderExperts(data) { const items=data.weeklyExpertUpdates?.length?data.weeklyExpertUpdates:(data.experts||[]); $('#expertGrid').innerHTML=items.length?items.slice(0,6).map(x=>`<article class="expert-card"><small>${esc(x.institution)}</small><h3>${esc(x.expert)}</h3><p>${esc(x.view)}</p><footer><span>${esc(x.date)} · ${esc(x.source)}</span><a href="${esc(x.url)}" target="_blank" rel="noopener">查看原文 ↗</a></footer></article>`).join(''):'<article class="expert-card"><small>SCHEDULED REFRESH</small><h3>专家观点聚合中</h3><p>每 6 小时自动抓取公开机构黄金预测观点（Google News 预测聚合 + 金十机构快讯）。下一次更新将自动填充本区。</p><footer><span>自动更新中</span></footer></article>'; text('#expertStamp',data.deployment?.expertWeeklyUpdatedAt ? `每6小时更新 · 最近 ${new Date(data.deployment.expertWeeklyUpdatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}` : '每 6 小时公开源更新'); }

function renderInsights(data) {
  const a = data.analysis || {};
  const items = (a.conclusions || []).slice(0, 4);
  const color = t => t === 'positive' ? 'var(--up)' : t === 'negative' ? 'var(--down)' : 'var(--cyan)';
  $('#insightStack').innerHTML = items.length ? items.map(x => `<div class="signal" style="--tone:${color(x.tone)}"><small>${esc(x.label || '模型信号')}</small><strong>${esc(x.verdict || '')}</strong><p>${esc(x.trigger || '')}</p></div>`).join('') : '<div class="loading"></div>';
  text('#invalidation', a.invalidation || '价格脱离近5日区间并获得成交确认');
}
function render(data) { state.data=data;const m=data.market,a=m.gold,f=data.goldForecast||{};renderKpis(m);text('#systemState',m.liveUpdatedAt?'公网行情已连接':'公开快照加载中');text('#heroSymbol',`${a.symbol||'GC'} · ${a.name||'COMEX 黄金主连'}`);text('#heroValue',n(a.value));text('#heroChange',pct(a.change));$('#heroChange').className=tone(a.change);text('#heroOpen',n(a.open));text('#heroHigh',n(a.high));text('#heroLow',n(a.low));text('#heroAmplitude',n(m.spotGold?.value));text('#heroAmount',a.quoteTime||'--');text('#forecastDate',`${f.marketDate||'--'} · ${f.horizon||'未来 1—5 日'}`);text('#regime',f.bias||'等待模型更新');text('#confidence',f.confidence||'--');text('#forecastNarrative',f.action||'基于公开行情的规则化情景');text('#baseCaseTarget',`${n(f.expectedRange?.[0],1)} — ${n(f.expectedRange?.[1],1)}`);text('#goldSupport',`${n(f.support,1)} USD/OZ`);text('#goldResistance',`${n(f.resistance,1)} USD/OZ`);renderNews(data.news||{});renderExperts(data);renderInsights(data);drawDaily(a);drawIntraday(a);clock(); }
let resizeTimer; addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(state.data){drawDaily(state.data.market.gold);drawIntraday(state.data.market.gold);}},200);});
async function load(){try{const r=await fetch(`./data/dashboard.json?t=${Date.now()}`,{cache:'no-store'});const data=await r.json();await refreshLive(data);render(data);}catch(e){console.error(e);text('#systemState','数据连接暂不可用');}}
$('#refreshBtn').onclick=load;$('#fullscreenBtn').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();setInterval(clock,1000);setInterval(()=>state.data&&refreshLive(state.data).then(()=>render(state.data)),15000);setInterval(load,300000);load();
