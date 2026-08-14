const https = require('https');
const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'data', 'dashboard.json');

function getText(url, timeout = 20_000) { return new Promise((resolve, reject) => {
  const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 AURUM-SIGNAL/1.0', Referer: 'https://www.jin10.com/' } }, r => { const chunks=[]; r.on('data', x => chunks.push(x)); r.on('end', () => r.statusCode === 200 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(Error(`HTTP ${r.statusCode} from ${url}`))); });
  req.setTimeout(timeout, () => req.destroy(Error('timeout'))); req.on('error', reject);
}); }
const decode = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]+>/g,'');
const strip = s => decode(s).replace(/\s+/g, ' ').trim();

// Primary: jin10 live flash (reachable from both CN and GitHub runners)
async function fromJin10() {
  const raw = await getText('https://www.jin10.com/flash_newest.js');
  const m = raw.match(/var\s+newest\s*=\s*(\[[\s\S]*\]);?/);
  if (!m) throw Error('jin10 payload missing');
  const events = JSON.parse(m[1]);
  const kw = /黄金|金价|伦敦金|COMEX|现货金/;
  const seen = new Set();
  const picked = [];
  for (const ev of events) {
    const d = ev.data || {};
    const body = strip(d.content || d.title || '');
    if (!body || body.length < 20 || !kw.test(body)) continue;
    // skip multi-topic numbered digests where gold is not the leading theme
    if (/[：:]\s*1[.、]/.test(body.slice(0, 40)) && !kw.test(body.slice(0, 60))) continue;
    const url = `https://flash.jin10.com/detail/${ev.id}`;
    if (seen.has(body.slice(0, 50))) continue;
    seen.add(body.slice(0, 50));
    const time = (ev.time || '').trim(); // "2026-08-14 15:27:22"
    picked.push({
      category: '黄金', sentiment: 'neutral',
      time: time ? `${time.slice(5, 7)}-${time.slice(8, 10)} ${time.slice(11, 16)}` : '最新',
      title: body.length > 76 ? `${body.slice(0, 76)}…` : body,
      summary: '金十数据实时快讯 · 每 6 小时自动聚合，点击可核对原文。',
      source: `金十数据 · ${strip(d.source) || '快讯'}`,
      url
    });
    if (picked.length >= 9) break;
  }
  if (!picked.length) throw Error('no gold flashes');
  return picked;
}

// Fallback: Google News RSS (works from GitHub runners)
async function fromGoogleNews() {
  const feed = 'https://news.google.com/rss/search?q=%E9%BB%84%E9%87%91+when%3A1d&hl=zh-CN&gl=CN&ceid=CN%3Azh-Hans';
  const xml = await getText(feed);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 9).map(([, part]) => {
    const field = n => strip((part.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`)) || [, ''])[1]);
    const date = field('pubDate');
    return { category: '黄金', sentiment: 'neutral', time: date ? new Date(date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-') : '最新', title: field('title'), summary: '每 6 小时更新的公开黄金资讯，点击原文核验。', source: 'Google News 公开聚合', url: field('link') };
  }).filter(x => x.title && x.url);
  if (!items.length) throw Error('no google items');
  return items;
}

(async () => {
  let items, provider;
  try { items = await fromJin10(); provider = '金十数据实时快讯 · 黄金相关'; }
  catch (e1) {
    console.warn(`jin10 unavailable: ${e1.message}; fallback to Google News RSS`);
    items = await fromGoogleNews(); provider = 'Google News RSS · 公开聚合';
  }
  const dashboard = JSON.parse(fs.readFileSync(target, 'utf8'));
  dashboard.news = { ...(dashboard.news || {}), source: provider, updatedAt: new Date().toISOString(), items };
  fs.writeFileSync(target, JSON.stringify(dashboard) + '\n');
  console.log(`Gold intelligence refreshed via ${provider}: ${items.length} items`);
})().catch(error => { console.error(error); process.exit(1); });
