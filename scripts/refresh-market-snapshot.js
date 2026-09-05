const fs = require('fs');
const path = require('path');
const https = require('https');
const quality = require('../data-quality');

const target = path.join(__dirname, '..', 'data', 'dashboard.json');
const endpoint = 'https://qt.gtimg.cn/q=hf_GC,hf_XAU';
function getText(url) { return new Promise((resolve, reject) => {
  const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 AURUM-SIGNAL/1.0', Referer: url.includes('sinajs')?'https://finance.sina.com.cn/':'https://gu.qq.com/', 'Accept-Encoding': 'identity' } }, res => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => res.statusCode === 200 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(Error(`Tencent HTTP ${res.statusCode}`)));
  });
  req.setTimeout(20_000, () => req.destroy(Error('Tencent request timeout'))); req.on('error', reject);
}); }
(async () => {
  const results = await Promise.allSettled([getText(endpoint),getText('https://hq.sinajs.cn/list=hf_XAU')]);
  const text = results[0].status==='fulfilled'?results[0].value:'';
  const gcMatch = text.match(/v_hf_GC="([^"]+)"/);
  const spotMatch = text.match(/v_hf_XAU="([^"]+)"/);
  const sinaMatch = results[1].status==='fulfilled'?results[1].value.match(/hq_str_hf_XAU="([^"]+)"/):null;
  if (!spotMatch && !sinaMatch) throw Error('两个XAU公开接口均不可用');
  const dashboard = JSON.parse(fs.readFileSync(target, 'utf8'));

  // Primary asset: London spot gold XAU (drives hero quote, charts and forecast).
  const candidates = [];
  for (const [match,provider] of [[spotMatch,'腾讯'],[sinaMatch,'新浪']]) if(match) {
    try {const fields=match[1].split(',');candidates.push({fields,provider,quote:quality.quote(fields,dashboard.market.gold)});} catch(e){console.warn(provider+': '+e.message);}
  }
  if(!candidates.length) throw Error('所有XAU报价均未通过字段/时间检查');
  candidates.sort((a,b)=>quality.stamp(b.quote.quoteTime)-quality.stamp(a.quote.quoteTime));
  const selected=candidates[0], spot = selected.fields;
  const spotPrice = Number(spot[0]);
  const spotPrevious = Number(spot[7]);
  const checked = quality.quote(spot, dashboard.market.gold);
  dashboard.market.gold = {
    ...checked,
    symbol: 'XAU', name: '伦敦现货黄金',
    value: spotPrice, open: Number(spot[8]), high: Number(spot[4]), low: Number(spot[5]),
    previous: Number.isFinite(spotPrevious) ? spotPrevious : dashboard.market.gold.previous,
    change: Number.isFinite(spotPrevious) && spotPrevious ? (spotPrice / spotPrevious - 1) * 100 : dashboard.market.gold.change,
    quoteTime: `${spot[12]} ${spot[6]}`,
    provider: selected.provider+'公开伦敦现货 XAU'
  };
  const point = { time: new Date(quality.stamp(checked.quoteTime)).toISOString(), value: spotPrice };
  const points = (dashboard.market.gold.intraday || []).filter(x => Date.now() - new Date(x.time).getTime() < 86400000 && x.time !== point.time);
  if (quality.fresh(checked.quoteTime, 24)) points.push(point);
  dashboard.market.gold.intraday = points.sort((a,b) => Date.parse(a.time)-Date.parse(b.time)).slice(-288);
  dashboard.market.gold.intradaySymbol = 'XAU';

  // Secondary reference: COMEX GC futures.
  if (gcMatch) {
    const gc = gcMatch[1].split(',');
    const gcPrice = Number(gc[0]), gcPrevious = Number(gc[7]);
    if (Number.isFinite(gcPrice)) dashboard.market.spotGold = {
      ...(dashboard.market.spotGold || {}), symbol: 'GC', name: 'COMEX 黄金主连',
      value: gcPrice, open: Number(gc[8]), high: Number(gc[4]), low: Number(gc[5]), previous: gcPrevious,
      change: gcPrevious ? (gcPrice / gcPrevious - 1) * 100 : dashboard.market.spotGold?.change,
      quoteTime: `${gc[12]} ${gc[6]}`, provider: '腾讯全球行情 · COMEX GC（实时）'
    };
  }

  dashboard.market.updatedAt = new Date().toISOString();
  const paired=candidates.length===2 && Math.abs(quality.stamp(candidates[0].quote.quoteTime)-quality.stamp(candidates[1].quote.quoteTime))<=120000;
  const deviation=paired?Math.abs(candidates[0].quote.value/candidates[1].quote.value-1)*100:null;
  dashboard.market.sourceQuality = { checkedAt: new Date().toISOString(), quoteTime: checked.quoteTime,
    status: paired?(deviation>.3?'disagreement':'matched'):'single-source',deviationPercent:deviation,
    quotes:candidates.map(x=>({provider:x.provider,value:x.quote.value,quoteTime:x.quote.quoteTime})),
    note: '腾讯/新浪 XAU 同品种报价，源时间相差不超过2分钟才比较；偏差超过0.3%提示冲突。两个公开接口可能共享上游，不代表独立交易所核验。COMEX 期货不参与现货价格核验。' };
  dashboard.deployment = { ...(dashboard.deployment || {}), mode: 'static-scheduled-snapshot', generatedAt: new Date().toISOString(), notice: '伦敦现货 XAU 由 GitHub Actions 定时更新；浏览器打开时再尝试直连分钟行情。' };
  fs.writeFileSync(target, `${JSON.stringify(dashboard)}\n`, 'utf8');
  console.log(`London spot XAU refreshed: ${spotPrice} @ ${dashboard.market.gold.quoteTime}`);
})().catch(error => { console.error(error); process.exit(1); });
