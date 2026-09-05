const fs = require('fs');
const https = require('https');
const path = require('path');

const sourceUrl = 'https://m.cmbchina.com/api/rate/gold';
const target = path.join(__dirname, '..', 'data', 'dashboard.json');

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: {
      'User-Agent': 'Mozilla/5.0 AURUM-SIGNAL/1.0',
      Accept: 'application/json',
      Referer: 'https://m.cmbchina.com/goldrate.html',
      'X-B3-BusinessId': 'LB5010CmbMobileBff'
    } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`CMB HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); }
      });
    });
    request.setTimeout(20_000, () => request.destroy(new Error('CMB request timeout')));
    request.on('error', reject);
  });
}

(async () => {
  const payload = await getJson(sourceUrl);
  const row = payload?.body?.data?.find(item => item.goldNo === 'AU9999');
  if (!row || !Number.isFinite(Number(row.curPrice))) throw new Error('CMB Au99.99 quote missing');
  const dashboard = JSON.parse(fs.readFileSync(target, 'utf8'));
  const previous = Number(row.preClose);
  const sourceDate = String(payload.body.time || '').slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) || !/^\d{2}:\d{2}:\d{2}$/.test(row.time || '')) throw Error('CMB源日期或品种行情时间缺失');
  const quoteTime = `${sourceDate} ${row.time}`;
  dashboard.market.cmbGold = {
    ...dashboard.market.cmbGold,
    symbol: 'Au99.99', name: '招商银行黄金市场行情 · Au99.99', value: Number(row.curPrice),
    change: previous ? (Number(row.curPrice) / previous - 1) * 100 : null, changeValue: Number(row.upDown),
    open: Number(row.open), high: Number(row.high), low: Number(row.low), average: Number(row.avePrice), volume: Number(row.tradeCount),
    unit: 'CNY/G', provider: '招商银行官网转发 Au99.99', quoteTime, fetchedAt: new Date().toISOString(), sourcePageTime: payload.body.time, sourceUrl: 'https://m.cmbchina.com/goldrate.html', status: 'public-delayed',
    scope: '招商银行官网黄金市场行情（上海金交所 Au99.99 品种），非账户金客户成交价'
  };
  dashboard.market.quality = dashboard.market.quality || {};
  dashboard.market.quality.chinaGold = { state: 'live', provider: '招商银行官网', cadence: 'GitHub Actions 每5分钟抓取' };
  dashboard.deployment = { ...(dashboard.deployment || {}), mode: 'static-scheduled-snapshot', generatedAt: new Date().toISOString(), notice: '招行 Au99.99 由 GitHub Actions 每5分钟刷新；其他指标按各自快照时间展示。' };
  fs.writeFileSync(target, `${JSON.stringify(dashboard)}\n`, 'utf8');
  console.log(`CMB Au99.99 refreshed: ${row.curPrice} CNY/G @ ${quoteTime}`);
})().catch(error => { console.error(error); process.exit(1); });
