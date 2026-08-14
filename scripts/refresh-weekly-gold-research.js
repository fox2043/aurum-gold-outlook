const https = require('https');
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'data', 'dashboard.json');
const decode = text => String(text || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, '');
const strip = s => decode(s).replace(/\s+/g, ' ').trim();
function getText(url) { return new Promise((resolve, reject) => {
  const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 AURUM-SIGNAL/1.0', Referer: 'https://www.jin10.com/' } }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => res.statusCode === 200 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(Error(`HTTP ${res.statusCode}`))); });
  req.setTimeout(20_000, () => req.destroy(Error('timeout'))); req.on('error', reject);
}); }

// Primary: Google News search for gold forecasts within 7 days (works from GitHub runners)
async function fromGoogleNews() {
  const feed = 'https://news.google.com/rss/search?q=%E9%BB%84%E9%87%91+%E9%A2%84%E6%B5%8B+%E6%9C%BA%E6%9E%84+when%3A7d&hl=zh-CN&gl=CN&ceid=CN%3Azh-Hans';
  const xml = await getText(feed);
  const updates = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6).map(([, item]) => {
    const get = name => strip((item.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`)) || [, ''])[1]);
    const title = get('title'), link = get('link'), date = get('pubDate');
    return { institution: '本周公开研究动态', expert: '黄金市场研究', date: date ? new Date(date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10), view: title.length > 110 ? `${title.slice(0, 110)}…` : title, url: link, source: 'Google News 聚合 · 请打开原文核验' };
  }).filter(x => x.view && x.url);
  if (!updates.length) throw Error('no google research items');
  return updates;
}

// Fallback: jin10 institutional / analytical gold flashes (reachable from CN)
async function fromJin10() {
  const raw = await getText('https://www.jin10.com/flash_newest.js');
  const m = raw.match(/var\s+newest\s*=\s*(\[[\s\S]*\]);?/);
  if (!m) throw Error('jin10 payload missing');
  const events = JSON.parse(m[1]);
  const kw = /黄金|金价|伦敦金|COMEX/;
  const inst = /高盛|瑞银|摩根|花旗|美银|汇丰|法兴|渣打|世界黄金协会|WGC|分析师|策略师|经济学家|预计|预测|目标价|看涨|看跌|上调|下调/;
  const skip = /石油|原油|天然气|成品油/;
  const seen = new Set();
  const picked = [];
  for (const ev of events) {
    const d = ev.data || {};
    const body = strip(d.content || d.title || '');
    if (!body || body.length < 20 || !kw.test(body) || !inst.test(body) || skip.test(body.slice(0, 12))) continue;
    // skip multi-topic numbered digests where gold is not the leading theme
    if (/[：:]\s*1[.、]/.test(body.slice(0, 40)) && !kw.test(body.slice(0, 60))) continue;
    if (seen.has(body.slice(0, 50))) continue;
    seen.add(body.slice(0, 50));
    const time = (ev.time || '').trim();
    picked.push({
      institution: strip(d.source) || '市场机构快讯',
      expert: '机构黄金观点',
      date: time ? time.slice(0, 10) : new Date().toISOString().slice(0, 10),
      view: body.length > 110 ? `${body.slice(0, 110)}…` : body,
      url: `https://flash.jin10.com/detail/${ev.id}`,
      source: '金十数据 · 请打开原文核验'
    });
    if (picked.length >= 6) break;
  }
  if (!picked.length) throw Error('no institutional gold flashes');
  return picked;
}

(async () => {
  let updates, providerNote;
  try { updates = await fromGoogleNews(); providerNote = 'Google News 预测聚合'; }
  catch (e1) {
    console.warn(`google research feed unavailable: ${e1.message}; fallback to jin10`);
    updates = await fromJin10(); providerNote = '金十数据机构快讯';
  }
  const dashboard = JSON.parse(fs.readFileSync(target, 'utf8'));
  dashboard.weeklyExpertUpdates = updates;
  dashboard.deployment = { ...(dashboard.deployment || {}), expertWeeklyUpdatedAt: new Date().toISOString(), expertProvider: providerNote };
  fs.writeFileSync(target, `${JSON.stringify(dashboard)}\n`, 'utf8');
  console.log(`Expert research refreshed via ${providerNote}: ${updates.length} items`);
})().catch(error => { console.error(error); process.exit(1); });
