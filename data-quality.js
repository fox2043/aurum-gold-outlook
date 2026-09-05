(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GoldQuality = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const stamp = value => {
    if (!value) return NaN;
    let s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00+08:00';
    else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) s = s.replace(' ', 'T') + '+08:00';
    return Date.parse(s);
  };
  function fresh(value, hours, now = Date.now()) {
    const age = now - stamp(value);
    return Number.isFinite(age) && age >= -300000 && age <= hours * 3600000;
  }
  function quote(fields, old = {}) {
    const value = Number(fields[0]), previous = Number(fields[7]);
    const high = Number(fields[4]), low = Number(fields[5]);
    const quoteTime = `${fields[12]} ${fields[6]}`;
    if (![value, previous, high, low].every(x => Number.isFinite(x) && x > 0) || high < low || value > high * 1.001 || value < low * .999 || !Number.isFinite(stamp(quoteTime))) throw Error('报价字段或源时间校验失败');
    if (stamp(quoteTime) > Date.now() + 300000) throw Error('拒绝未来时间报价');
    if (Number.isFinite(stamp(old.quoteTime)) && stamp(quoteTime) < stamp(old.quoteTime)) throw Error('拒绝倒退报价');
    return { ...old, value, previous, high, low, open: Number(fields[8]), change: (value / previous - 1) * 100, quoteTime, fetchedAt: new Date().toISOString() };
  }
  function experts(items, now = Date.now()) {
    const seen = new Set(); const accepted = [];
    for (const item of items || []) {
      const body = `${item.view || ''} ${item.title || ''}`;
      const institution = body.match(/高盛|瑞银|摩根大通|摩根士丹利|花旗|美国银行|美银|汇丰|渣打|法兴|世界黄金协会|中金公司|中信证券|国泰君安|华泰证券/); 
      const date = item.publishedAt || item.date;
      // An annual target is not evidence for a 1–5 trading-day forecast.
      if (!institution || !/黄金|金价|伦敦金/.test(body) || !/短期|本周|下周|未来[一二三四五1-5]个?交易日/.test(body) || /并不|并非|否认|不认为/.test(body) || !fresh(date, 168, now)) continue;
      const up = /看涨|上调|偏多|上涨|走高|上行/.test(body), down = /看跌|下调|偏空|下跌|承压|下行/.test(body);
      if (up === down || !/^https:\/\//.test(item.url || '') || seen.has(institution[0])) continue;
      seen.add(institution[0]);
      const weight = Math.exp(-(now - stamp(date)) / (72 * 3600000));
      accepted.push({ institution: institution[0], direction: up ? 1 : -1, weight, url: item.url, date });
    }
    const weight = accepted.reduce((s, x) => s + x.weight, 0);
    return { score: weight ? 50 + 25 * accepted.reduce((s, x) => s + x.direction * x.weight, 0) / weight : 50, accepted,
      votes: { total: accepted.length, positive: accepted.filter(x => x.direction > 0).length, negative: accepted.filter(x => x.direction < 0).length, neutral: 0 },
      status: accepted.length >= 2 ? 'available' : 'insufficient' };
  }
  return { stamp, fresh, quote, experts };
});
