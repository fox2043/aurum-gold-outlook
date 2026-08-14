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
  const goldMatch = text.match(/v_hf_GC="([^"]+)"/);
  if (!goldMatch) throw Error('Tencent COMEX gold quote missing');
  const fields = goldMatch[1].split(',');
  const price = Number(fields[0]);
  const previous = Number(fields[7]);
  if (!Number.isFinite(price)) throw Error('Yahoo GC=F quote missing');
  const dashboard = JSON.parse(fs.readFileSync(target, 'utf8'));
  dashboard.market.gold = {
    ...dashboard.market.gold,
    value: price, open: Number(fields[2]), high: Number(fields[4]), low: Number(fields[5]),
    previous: Number.isFinite(previous) ? previous : dashboard.market.gold.previous,
    change: Number.isFinite(previous) && previous ? (price / previous - 1) * 100 : dashboard.market.gold.change,
    quoteTime: `${fields[12]} ${fields[6]}`,
    provider: '腾讯全球期货行情 · COMEX GC'
  };
  dashboard.market.updatedAt = new Date().toISOString();
  dashboard.deployment = { ...(dashboard.deployment || {}), mode: 'static-scheduled-snapshot', generatedAt: new Date().toISOString(), notice: 'COMEX 由 GitHub Actions 定时更新；浏览器打开时再尝试直连分钟行情。' };
  fs.writeFileSync(target, `${JSON.stringify(dashboard)}\n`, 'utf8');
  console.log(`COMEX GC refreshed: ${price} @ ${dashboard.market.gold.quoteTime}`);
})().catch(error => { console.error(error); process.exit(1); });
