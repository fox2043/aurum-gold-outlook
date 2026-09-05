const $ = s => document.querySelector(s);
const state = { data: null };
const n = (v, d = 2) => v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '--';
const pct = v => v != null && v !== '' && Number.isFinite(Number(v)) ? `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%` : '--';
const tone = v => Number(v) > 0 ? 'positive' : Number(v) < 0 ? 'negative' : 'neutral';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const text = (id, value) => { const el = $(id); if (el) el.textContent = value; };
const fmtTime = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
function clock() {
  text('#clock',new Date().toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}));
  if (!state.data) return;
  const m=state.data.market, q=GoldQuality, recent=q.fresh(m.gold.quoteTime,.25);
  text('#freshness',(recent?'报价源时间 ':'延迟/休市待核对 · 源时间 ')+(m.gold.quoteTime||'未知'));
  text('#systemState',recent?'公开报价时效有效':'报价非实时 / 等待源更新');
  text('#goldVerification',m.sourceQuality?.status==='matched'?'腾讯/新浪 XAU 最近核对一致':m.sourceQuality?.status==='disagreement'?'XAU报价冲突 · 暂停预测':'XAU仅一路有效 · 待交叉核对');
  const d=state.data, issues=[];
  if(!recent) issues.push('行情延迟或休市');
  if(m.sourceQuality?.status==='disagreement') issues.push('同品种报价冲突');
  if(!q.fresh(d.news?.latestPublishedAt,48)) issues.push('新闻缺少近48小时内容');
  if(!q.fresh(d.deployment?.expertWeeklyUpdatedAt,6)) issues.push('专家源检查超时');
  text('#sourceSummary','数据源核验 · '+(issues.join(' / ')||'查看报价口径与预测依据'));
}
function liveAsset(f,old,provider) {return {...GoldQuality.quote(f,old),provider};}
function addPoint(asset) {
  if(!GoldQuality.fresh(asset.quoteTime,24)) return;
  const time=new Date(GoldQuality.stamp(asset.quoteTime)).toISOString();
  asset.intraday=[...(asset.intraday||[]).filter(x=>x.time!==time && Date.now()-Date.parse(x.time)<86400000),{time,value:asset.value}].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)).slice(-290);
}

function getTencent() { return new Promise((resolve,reject)=>{ const old=$('#tencentQuote'); if(old) old.remove(); const s=document.createElement('script'); s.id='tencentQuote'; s.src=`https://qt.gtimg.cn/q=hf_GC,hf_XAU&_=${Date.now()}`; const timer=setTimeout(()=>{s.remove();reject(Error('timeout'));},8000); s.onload=()=>{clearTimeout(timer);resolve([window.v_hf_GC,window.v_hf_XAU]);}; s.onerror=()=>{clearTimeout(timer);reject(Error('load failed'));}; document.head.appendChild(s); }); }
async function refreshLive(data) {
  try {
    const [gc,xau]=await getTencent(), m=data.market;
    m.gold=liveAsset(String(xau).split(','),{...m.gold,symbol:'XAU',name:'伦敦现货黄金'},'腾讯公开伦敦现货 XAU');
    try {m.spotGold=liveAsset(String(gc).split(','),{...(m.spotGold||{}),symbol:'GC',name:'COMEX 黄金主连'},'腾讯公开COMEX期货');} catch(e){console.warn(e);}
    addPoint(m.gold);
    const fx=Number(m.fx?.value);
    if(fx>0 && GoldQuality.fresh(m.fx?.quoteTime,72)) m.domesticReference={value:m.gold.value*fx/31.1034768,quoteTime:m.gold.quoteTime,change:null,provider:'伦敦现货×参考汇率；非国内成交价'};
    else m.domesticReference=null;
    m.liveUpdatedAt=new Date().toISOString();
    return true;
  } catch(e) {console.warn('quote unavailable',e);return false;}
}
function renderKpis(m) {
  const domestic=GoldQuality.fresh(m.cmbGold?.quoteTime,96)?m.cmbGold:null;
  const rows=[['伦敦现货黄金 · 公开报价',m.gold,'USD/OZ'],['COMEX 黄金主连 · 期货',m.spotGold,'USD/OZ'],['国内 Au99.99 · 招行官网转发',domestic,'CNY/G']];
  $('#kpiRibbon').innerHTML=rows.map(([name,a,u])=>'<article class="kpi"><small><span>'+name+'</span><span>'+u+'</span></small><strong>'+n(a?.value)+'</strong><em class="'+tone(a?.change)+'">'+pct(a?.change)+'</em><p>'+esc(a?.quoteTime||'缺少有效源报价')+'</p><p>'+esc(a?.provider||'上金所品种；非App客户成交价')+'</p></article>').join('');
  text('#sourceAudit','XAU：'+(m.gold.provider||'公开报价')+'；源时间 '+(m.gold.quoteTime||'未知')+'。'+(m.sourceQuality?.note||'尚无双源核对结果')+' 最近核对时间：'+(m.sourceQuality?.checkedAt||'未知')+'。国内金价使用招行官网 Au99.99 公开转发行情，非账户金成交价。日K来源：'+(m.gold.historyProvider||'待核验')+'。专家为具名机构媒体转述，原文链接供核对。');
}


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
  text('#dailyStamp', `伦敦金日K · ${rows.at(-1).date} · 每5分钟同步`);
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

function renderNews(news) { const items=(news.items||[]).filter(x=>x.category==='黄金' && GoldQuality.fresh(x.publishedAt,48)); $('#newsTimeline').innerHTML=items.length?items.map(x=>`<a class="news-item" href="${esc(x.url)}" target="_blank" rel="noopener"><time>${esc(x.time)}</time><div><h3>${esc(x.title)}</h3><p>${esc(x.summary||'公开黄金资讯')}</p><span>${esc(x.source||'公开来源')}</span></div></a>`).join(''):'<div class="news-item"><div>等待下一次公开资讯更新</div></div>'; if(news.updatedAt) text('#newsStamp',`每6小时更新 · ${new Date(news.updatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}`); }
function renderExperts(data) { const items=(data.weeklyExpertUpdates||[]).filter(x=>GoldQuality.fresh(x.publishedAt||x.date,168)); $('#expertGrid').innerHTML=items.length?items.slice(0,6).map(x=>`<article class="expert-card"><small>${esc(x.institution)}</small><h3>${esc(x.expert)}</h3><p>${esc(x.view)}</p><footer><span>${esc(x.date)} · ${esc(x.source)}</span><a href="${esc(x.url)}" target="_blank" rel="noopener">查看原文 ↗</a></footer></article>`).join(''):'<article class="expert-card"><small>SCHEDULED REFRESH</small><h3>专家观点聚合中</h3><p>每 6 小时自动抓取公开机构黄金预测观点（新华财经 + 金十 + Google News）。未检索到符合条件的近期观点时，本区保持资料不足提示。</p><footer><span>自动更新中</span></footer></article>'; text('#expertStamp',data.deployment?.expertWeeklyUpdatedAt ? `每6小时检查 · 最近 ${new Date(data.deployment.expertWeeklyUpdatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}` : '每 6 小时公开源更新'); }

function renderInsights(data) {
  const a = data.analysis || {};
  const items = (a.conclusions || []).slice(0, 4);
  const color = t => t === 'positive' ? 'var(--up)' : t === 'negative' ? 'var(--down)' : 'var(--cyan)';
  $('#insightStack').innerHTML = items.length ? items.map(x => `<div class="signal" style="--tone:${color(x.tone)}"><small>${esc(x.label || '模型信号')}</small><strong>${esc(x.verdict || '')}</strong><p>${esc(x.trigger || '')}</p></div>`).join('') : '<div class="loading"></div>';
  text('#invalidation', a.invalidation || '价格脱离近5日区间并获得成交确认');
}
function renderForecastExtras(f, price) {
  $('#outlookMap').style.display = f.expectedRange ? '' : 'none';
  const sc = f.scenarios || {};
  text('#baseCaseText', f.bias || '--');
  text('#bullCaseTarget', f.resistance != null ? n(f.resistance, 1) : '--');
  text('#bullCaseText', `${sc.bull != null ? sc.bull + '% 概率 · ' : ''}${f.triggerUp || ''}`);
  text('#bearCaseTarget', f.support != null ? n(f.support, 1) : '--');
  text('#bearCaseText', `${sc.bear != null ? sc.bear + '% 概率 · ' : ''}${f.triggerDown || ''}`);
  text('#goldMa20', f.atr != null ? `${n(f.atr, 1)} USD/OZ` : '--');
  const lo = Math.min(f.support ?? Infinity, price ?? Infinity, ...(f.expectedRange || [Infinity]));
  const hi = Math.max(f.resistance ?? -Infinity, price ?? -Infinity, ...(f.expectedRange || [-Infinity]));
  const span = (hi - lo) || 1;
  const pos = v => Number.isFinite(v) ? Math.max(1, Math.min(99, (v - lo) / span * 100)) : 50;
  text('#mapHigh', n(hi, 0)); text('#mapCurrent', n(price, 0)); text('#mapLow', n(lo, 0));
  const setLeft = (sel, v) => { const el = $(sel); if (el) el.style.left = pos(v) + '%'; };
  setLeft('#currentMarker', price); setLeft('#supportMarker', f.support); setLeft('#resistanceMarker', f.resistance);
  const win = $('#forecastWindow');
  if (win && f.expectedRange) { win.style.left = pos(f.expectedRange[0]) + '%'; win.style.right = (100 - pos(f.expectedRange[1])) + '%'; }
  const stamp = f.computedAt ? `随有效快照重算 · ${new Date(f.computedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}` : '每2小时更新';
  text('#forecastDate', `${f.marketDate || '--'} · ${stamp}`);
  text('#confidence',state.data?.forecastEvaluation?.count ? '核验中' : '待验证');
  text('#expertWeight', `${f.weights?.expertViews ?? 50}%`);
  text('#marketWeight', `${f.weights?.marketAndMacroData ?? 50}%`);
  const signal = f.signals || {}, votes = signal.expertVotes || {};
  const shock = signal.eventShockPenalty ? ` · 事件冲击 -${signal.eventShockPenalty}` : '';
  text('#forecastSignal', `专家 ${n(signal.expertScore,1)} / 数据 ${n(signal.marketScore,1)} / 综合 ${n(signal.combinedScore,1)} · 专家观点 ${votes.total ?? 0} 条${shock}`);
}
function render(data) { if(data.goldForecast && (!GoldQuality.fresh(data.goldForecast.quoteTime||data.market.gold.quoteTime,72) || !GoldQuality.fresh(data.goldForecast.computedAt,6))) {data.goldForecast={...data.goldForecast,status:'suspended',bias:'预测已过期 · 等待重算',expectedRange:null,action:'预测输入或计算时间过期，暂不显示有效预测区间。'};} state.data=data;const m=data.market,a=m.gold,f=data.goldForecast||{};renderKpis(m);text('#systemState',m.liveUpdatedAt?'公网行情已连接':'公开快照加载中');text('#heroSymbol',`${a.symbol||'XAU'} · ${a.name||'伦敦现货黄金'}`);text('#heroValue',n(a.value));text('#heroChange',pct(a.change));$('#heroChange').className=tone(a.change);text('#heroOpen',n(a.open));text('#heroHigh',n(a.high));text('#heroLow',n(a.low));text('#heroAmplitude',n(m.spotGold?.value));text('#heroAmount',a.quoteTime||'--');text('#regime',f.bias||'等待模型更新');text('#confidence',f.confidence||'--');text('#forecastNarrative',f.action||'基于公开行情的规则化情景');text('#baseCaseTarget',`${n(f.expectedRange?.[0],1)} — ${n(f.expectedRange?.[1],1)}`);text('#goldSupport',`${n(f.support,1)} USD/OZ`);text('#goldResistance',`${n(f.resistance,1)} USD/OZ`);renderForecastExtras(f,a.value);renderNews(data.news||{});renderExperts(data);renderInsights(data);drawDaily(a);drawIntraday(a);clock(); }
let resizeTimer; addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(state.data){drawDaily(state.data.market.gold);drawIntraday(state.data.market.gold);}},200);});
async function load(){try{const r=await fetch(`./data/dashboard.json?t=${Date.now()}`,{cache:'no-store'});const data=await r.json();await refreshLive(data);render(data);}catch(e){console.error(e);text('#systemState','数据连接暂不可用');}}
$('#refreshBtn').onclick=load;$('#fullscreenBtn').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();setInterval(clock,1000);setInterval(()=>state.data&&refreshLive(state.data).then(()=>render(state.data)),15000);setInterval(load,300000);load();
