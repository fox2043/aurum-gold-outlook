const https = require('https');
const fs = require('fs');
const path = require('path');

const feed = 'https://news.google.com/rss/search?q=%E9%BB%84%E9%87%91+%E9%A2%84%E6%B5%8B+when%3A7d&hl=zh-CN&gl=CN&ceid=CN%3Azh-Hans';
const target = path.join(__dirname, '..', 'data', 'dashboard.json');
const decode = text => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function fetchText(url) { return new Promise((resolve, reject) => {
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 AURUM-SIGNAL/1.0' } }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => res.statusCode === 200 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(Error(`RSS HTTP ${res.statusCode}`))); }).on('error', reject);
}); }
(async () => {
  const xml = await fetchText(feed);
  const updates = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 3).map(([, item]) => {
    const get = name => decode((item.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`)) || [, ''])[1]).trim();
    const title = get('title'), link = get('link'), date = get('pubDate');
    return { institution: '本周公开研究动态', expert: '黄金市场研究', date: date ? new Date(date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10), view: title, url: link, source: 'Google News 聚合 · 请打开原文核验' };
  }).filter(x => x.view && x.url);
  if (!updates.length) throw Error('No weekly gold research items found');
  const dashboard = JSON.parse(fs.readFileSync(target, 'utf8'));
  dashboard.weeklyExpertUpdates = updates;
  dashboard.deployment = { ...(dashboard.deployment || {}), expertWeeklyUpdatedAt: new Date().toISOString() };
  fs.writeFileSync(target, `${JSON.stringify(dashboard)}\n`, 'utf8');
  console.log(`Weekly research refreshed: ${updates.length} items`);
})().catch(error => { console.error(error); process.exit(1); });
