const fs = require('fs');
const path = require('path');
const https = require('https');

const target = path.join(__dirname, '..', 'data', 'dashboard.json');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 AURUM-SIGNAL/1.0' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(Error(`HTTP ${res.statusCode} from ${url}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(25_000, () => req.destroy(Error('timeout')));
    req.on('error', reject);
  });
}

// EastMoney COMEX gold main continuous (GC00Y) kline. fields2: f51 date, f52 open, f53 close, f54 high, f55 low. Timestamps are Beijing time.
const EM_BASE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=101.GC00Y&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55&fqt=1&beg=0&end=20500101';

async function fetchKlines(klt) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const payload = await fetchJson(`${EM_BASE}&klt=${klt}`);
      const data = payload && payload.data;
      if (!data || !Array.isArray(data.klines) || !data.klines.length) throw Error(`EastMoney kline empty for klt=${klt}`);
      return data.klines.map(line => {
        const [date, open, close, high, low] = line.split(',');
        return { date, open: Number(open), close: Number(close), high: Number(high), low: Number(low) };
      });
    } catch (e) { lastError = e; if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt)); }
  }
  throw lastError;
}

(async () => {
  const dashboard = JSON.parse(fs.readFileSync(target, 'utf8'));
  const gold = dashboard.market.gold;
  const log = [];

  // ---- 30-day daily candles ----
  try {
    const daily = await fetchKlines(101);
    const last30 = daily.slice(-30).map(c => ({ date: c.date, open: c.open, high: c.high, low: c.low, close: Number(c.close.toFixed(2)) }));
    if (last30.length >= 20) {
      gold.candles = last30;
      gold.series = last30.map(c => c.close);
      log.push(`daily=${last30.length} bars (last ${last30[last30.length - 1].date} close ${last30[last30.length - 1].close})`);
    } else log.push(`daily skipped: ${last30.length} bars`);
  } catch (e) {
    log.push(`daily via EM failed: ${e.message}`);
    // Fallback: Sina COMEX GC daily kline
    try {
      const raw = await new Promise((resolve, reject) => {
        const req = https.get('https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20gd=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=GC', { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.sina.com.cn/' } }, res => { const chunks=[]; res.on('data', c => chunks.push(c)); res.on('end', () => res.statusCode === 200 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(Error(`sina HTTP ${res.statusCode}`))); });
        req.setTimeout(25_000, () => req.destroy(Error('timeout'))); req.on('error', reject);
      });
      const m = raw.match(/=\((\[[\s\S]*\])\)/);
      if (!m) throw Error('sina payload missing');
      const bars = JSON.parse(m[1]).slice(-30).map(b => ({ date: b.date, open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(Number(b.close).toFixed(2)) }));
      if (bars.length >= 20) {
        gold.candles = bars; gold.series = bars.map(c => c.close);
        log.push(`daily fallback=sina ${bars.length} bars (last ${bars[bars.length - 1].date})`);
      } else log.push(`daily fallback skipped: ${bars.length} bars`);
    } catch (e2) { log.push(`daily fallback failed: ${e2.message}`); }
  }

  // ---- 24h intraday 5-minute series ----
  try {
    const m5 = await fetchKlines(5);
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const points = [];
    for (const bar of m5) {
      const t = new Date(`${bar.date.replace(' ', 'T')}+08:00`).getTime();
      if (!Number.isFinite(t) || t < cutoff || !Number.isFinite(bar.close)) continue;
      points.push({ time: new Date(t).toISOString(), value: Number(bar.close.toFixed(2)) });
    }
    if (points.length >= 12) {
      gold.intraday = points.slice(-290);
      log.push(`intraday=${points.length} pts`);
    } else log.push(`intraday skipped: ${points.length} pts (market closed window)`);
  } catch (e) { log.push(`intraday failed: ${e.message}`); }

  gold.historyUpdatedAt = new Date().toISOString();
  gold.historyProvider = '东方财富/新浪 · COMEX 黄金主连（日K + 24h 5分钟线）';
  dashboard.market.updatedAt = new Date().toISOString();
  fs.writeFileSync(target, `${JSON.stringify(dashboard)}\n`, 'utf8');
  console.log(`gold history refreshed: ${log.join(' | ')}`);
})().catch(error => { console.error(error); process.exit(1); });
