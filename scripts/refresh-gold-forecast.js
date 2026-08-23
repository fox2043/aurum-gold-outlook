// Recompute the rule-based 1-5 day gold outlook from the latest 30-day daily candles.
// Runs on GitHub Actions whenever goldForecast is older than 2 hours (see refresh-cmb-gold.yml).
'use strict';
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'data', 'dashboard.json');
const r1 = v => Math.round(v * 10) / 10;

function expertSignal(updates) {
  const views = Array.isArray(updates) ? updates : [];
  const bull = /看涨|上行|上涨|走高|买入|加码|增持|上调|突破|反弹|利多|多头/;
  const bear = /看跌|下行|下跌|走低|减持|下调|承压|回落|抛售|利空|空头|跌破/;
  let positive = 0, negative = 0, neutral = 0;
  views.forEach(item => { const value = `${item.view || ''} ${item.title || ''}`; const up = bull.test(value), down = bear.test(value); if (up && !down) positive += 1; else if (down && !up) negative += 1; else neutral += 1; });
  const total = positive + negative + neutral;
  const score = total ? Math.max(25, Math.min(75, 50 + (positive - negative) / total * 25)) : 50;
  return { score: r1(score), votes: { positive, negative, neutral, total } };
}

function buildForecast(dashboard) {
  const gold = (dashboard.market && dashboard.market.gold) || {};
  const candles = (gold.candles || []).filter(c => Number.isFinite(c.close));
  if (candles.length < 20) throw Error('not enough daily candles for forecast');
  const rows = candles.slice(-30);
  const closes = rows.map(c => c.close);
  const last = rows[rows.length - 1];
  const close = Number.isFinite(gold.value) ? gold.value : last.close;

  const ma = (arr, w) => arr.slice(-w).reduce((s, v) => s + v, 0) / Math.min(w, arr.length);
  const ma5 = ma(closes, 5), ma20 = ma(closes, 20);
  const atr = rows.slice(-14).reduce((s, c) => s + (c.high - c.low), 0) / Math.min(14, rows.length);
  const high10 = Math.max(...rows.slice(-10).map(c => c.high));
  const low10 = Math.min(...rows.slice(-10).map(c => c.low));
  const mom5 = close / closes[closes.length - 6] - 1;

  // --- regime rules ---
  let bias, scenarios, action;
  if (close > ma5 && ma5 > ma20 && mom5 > 0.008) {
    bias = '趋势偏多'; scenarios = { bull: 48, base: 37, bear: 15 };
    action = '顺势持有为主；不追高，回踩 MA5 企稳可加观察';
  } else if (close > ma20 && mom5 > 0) {
    bias = '偏多但需确认'; scenarios = { bull: 38, base: 42, bear: 20 };
    action = '不追高；回踩MA5附近企稳后再观察';
  } else if (close > ma20) {
    bias = '高位震荡整理'; scenarios = { bull: 22, base: 56, bear: 22 };
    action = '区间思路对待；靠近区间上沿谨慎、下沿再评估';
  } else if (close < ma20 && mom5 < -0.008) {
    bias = '趋势承压'; scenarios = { bull: 16, base: 38, bear: 46 };
    action = '以防守为主；反弹到 MA20 附近先减风险再观察';
  } else {
    bias = '中性观望'; scenarios = { bull: 24, base: 50, bear: 26 };
    action = '等待方向确认；关注区间两端再决策';
  }

  let marketScore = 50;
  if (close > ma5) marketScore += 9;
  if (ma5 > ma20) marketScore += 9;
  if (Math.abs(mom5) > 0.01) marketScore += mom5 > 0 ? 7 : -7;
  if (close > ma20) marketScore += 8; else marketScore -= 8;
  marketScore = Math.max(25, Math.min(75, marketScore));
  const experts = expertSignal(dashboard.weeklyExpertUpdates);
  const combinedScore = r1(marketScore * 0.5 + experts.score * 0.5);
  const confidence = Math.max(55, Math.min(86, Math.round(58 + Math.abs(combinedScore - 50) * 0.7)));
  if (combinedScore >= 59) { bias = '综合偏多'; scenarios = { bull: 46, base: 39, bear: 15 }; action = '综合信号偏多；不追高，回踩关键均线企稳后再观察'; }
  else if (combinedScore <= 41) { bias = '综合偏空'; scenarios = { bull: 15, base: 39, bear: 46 }; action = '综合信号偏空；反弹至压力区先控制风险再观察'; }
  else { bias = '综合震荡待确认'; scenarios = { bull: 27, base: 46, bear: 27 }; action = '专家与量价综合信号未形成单边共识，等待区间突破确认'; }

  const expertShift = (experts.score - 50) / 25 * atr * 0.25;
  const support = Math.min(low10, close - atr) + Math.min(0, expertShift * 0.35);
  const resistance = Math.max(high10, close + atr * 0.2) + Math.max(0, expertShift * 0.35);
  const expectedRange = [close - atr * 0.45 + expertShift, close + atr * 1.1 + expertShift];

  const now = new Date();
  const beijing = new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60000);
  const pad = v => String(v).padStart(2, '0');
  const asOf = `${beijing.getFullYear()}-${pad(beijing.getMonth() + 1)}-${pad(beijing.getDate())} ${pad(beijing.getHours())}:${pad(beijing.getMinutes())}:${pad(beijing.getSeconds())}`;

  return {
    asOf,
    computedAt: now.toISOString(),
    marketDate: last.date,
    horizon: '未来1—5个交易日',
    bias, confidence, scenarios,
    weights: { expertViews: 50, marketAndMacroData: 50 },
    signals: { marketScore: r1(marketScore), expertScore: experts.score, combinedScore, expertVotes: experts.votes },
    support: r1(support),
    resistance: r1(resistance),
    ma5: r1(ma5),
    ma20: r1(ma20),
    atr: r1(atr),
    expectedRange: [r1(expectedRange[0]), r1(expectedRange[1])],
    action,
    triggerUp: `有效突破 ${r1(resistance)} 且日线收稳`,
    triggerDown: `跌破 ${r1(support)} 且波动扩大`,
    invalidation: `${r1(ma20)} 附近为当前判断失效观察位`,
    drivers: ['美元指数与美债实际利率', 'COMEX成交与主力合约切换', '避险事件与央行购金预期'],
    methodology: '专家公开观点综合信号占50%；日线MA5/MA20、5日动量、20日高低区间、ATR14与宏观/资讯信号占50%。专家观点不足时保持中性50分。',
    disclaimer: '概率情景不是价格保证，不构成个性化投资建议。'
  };
}

function syncAnalysis(dashboard, f) {
  const a = dashboard.analysis || (dashboard.analysis = {});
  const close = f.expectedRange[0] + f.atr * 0.45;
  a.goldBias = f.bias;
  a.bias = f.bias.includes('偏多') || f.bias.includes('趋势偏多') ? '偏多' : f.bias.includes('承压') ? '偏空' : '中性';
  a.scenario = { ...f.scenarios };
  a.invalidation = f.invalidation;
  const list = Array.isArray(a.conclusions) ? a.conclusions : [];
  const goldRow = {
    rank: 1,
    label: '黄金趋势状态',
    verdict: `现价${close > f.ma20 ? '高于' : '低于'}20日均值 ${f.ma20}，${f.bias}（置信 ${f.confidence}%）`,
    confidence: f.confidence,
    tone: close > f.ma20 ? 'gold' : 'negative',
    trigger: `触发：${f.triggerUp}`,
    invalidation: `失效：${f.invalidation}`
  };
  const idx = list.findIndex(x => x.label && x.label.includes('黄金'));
  if (idx >= 0) list[idx] = goldRow; else list.unshift(goldRow);
  a.conclusions = list.slice(0, 4);
}

(async () => {
  const dashboard = JSON.parse(fs.readFileSync(target, 'utf8'));
  const forecast = buildForecast(dashboard);
  dashboard.goldForecast = forecast;
  syncAnalysis(dashboard, forecast);
  dashboard.deployment = { ...(dashboard.deployment || {}), forecastUpdatedAt: forecast.computedAt };
  fs.writeFileSync(target, JSON.stringify(dashboard) + '\n');
  console.log(`gold forecast refreshed @ ${forecast.asOf}: ${forecast.bias} conf=${forecast.confidence} range=[${forecast.expectedRange.join(', ')}] support=${forecast.support} resistance=${forecast.resistance}`);
})().catch(error => { console.error(error); process.exit(1); });
