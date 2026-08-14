const fs = require('fs');
const path = require('path');
const https = require('https');

const target = path.join(__dirname, '..', 'data', 'dashboard.json');
const endpoint = 'https://qt.gtimg.cn/q=hf_GC,hf_XAU';
function getText(url) { return new Promise((resolve, reject) => {
  const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 AURUM-SIGNAL/1.0', Referer: 'https://gu.qq.com/', 'Accept-Encoding': 'identity' } }, res => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => res.statusCode === 200 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(Error(`Tencent HTTP ${res.statusCode}`)));
  });
  req.setTimeout(20_000, () => req.destroy(Error('Tencent request timeout'))); req.on('error', reject);
}); }
(async () => {
  const text = await getText(endpoint);
  const gcMatch = text.match(/v_hf_GC="([^"]+)"/);
  const spotMatch = text.match(/v_hf_XAU="([^"]+)"/);
  if (!spotMatch) throw Error('Tencent London spot XAU quote missing');
  const dashboard = JSON.parse(fs.readFileSync(target, 'utf8'));

  // Primary asset: London spot gold XAU (drives hero quote, charts and forecast).
  const spot = spotMatch[1].split(',');
  const spotPrice = Number(spot[0]);
  const spotPrevious = Number(spot[7]);
  if (!Number.isFinite(spotPrice)) throw Error('Tencent XAU quote missing');
  dashboard.market.gold = {
    ...dashboard.market.gold,
    symbol: 'XAU', name: '伦敦现货黄金',
    value: spotPrice, open: Number(spot[2]), high: Number(spot[4]), low: Number(spot[5]),
    previous: Number.isFinite(spotPrevious) ? spotPrevious : dashboard.market.gold.previous,
    change: Number.isFinite(spotPrevious) && spotPrevious ? (spotPrice / spotPrevious - 1) * 100 : dashboard.market.gold.change,
    quoteTime: `${spot[12]} ${spot[6]}`,
    provider: '腾讯全球行情 · 伦敦现货 XAU（实时）'
  };
  const point = { time: new Date().toISOString(), value: spotPrice };
  dashboard.market.gold.intraday = [...(dashboard.market.gold.intraday || []).filter(x => Date.now() - new Date(x.time).getTime() < 86400000), point].slice(-288);
  dashboard.market.gold.intradaySymbol = 'XAU';

  // Secondary reference: COMEX GC futures.
  if (gcMatch) {
    const gc = gcMatch[1].split(',');
    const gcPrice = Number(gc[0]), gcPrevious = Number(gc[7]);
    if (Number.isFinite(gcPrice)) dashboard.market.spotGold = {
      ...(dashboard.market.spotGold || {}), symbol: 'GC', name: 'COMEX 黄金主连',
      value: gcPrice, open: Number(gc[2]), high: Number(gc[4]), low: Number(gc[5]), previous: gcPrevious,
      change: gcPrevious ? (gcPrice / gcPrevious - 1) * 100 : dashboard.market.spotGold?.change,
      quoteTime: `${gc[12]} ${gc[6]}`, provider: '腾讯全球行情 · COMEX GC（实时）'
    };
  }

  dashboard.market.updatedAt = new Date().toISOString();
  dashboard.deployment = { ...(dashboard.deployment || {}), mode: 'static-scheduled-snapshot', generatedAt: new Date().toISOString(), notice: '伦敦现货 XAU 由 GitHub Actions 定时更新；浏览器打开时再尝试直连分钟行情。' };
  fs.writeFileSync(target, `${JSON.stringify(dashboard)}\n`, 'utf8');
  console.log(`London spot XAU refreshed: ${spotPrice} @ ${dashboard.market.gold.quoteTime}`);
})().catch(error => { console.error(error); process.exit(1); });
