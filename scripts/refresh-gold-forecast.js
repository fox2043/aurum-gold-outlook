// Recompute the rule-based 1-5 day gold outlook from the latest 30-day daily candles.
// Runs on GitHub Actions whenever goldForecast is older than 2 hours (see refresh-cmb-gold.yml).
'use strict';
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'data', 'dashboard.json');
const r1 = v => Math.round(v * 10) / 10;

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

  let confidence = 58;
  if (close > ma5) confidence += 6;
  if (ma5 > ma20) confidence += 6;
  if (Math.abs(mom5) > 0.01) confidence += 5;
  if (close > ma20) confidence += 5;
  confidence = Math.max(55, Math.min(86, confidence));

  const support = Math.min(low10, close - atr);
  const resistance = Math.max(high10, close + atr * 0.2);
  const expectedRange = [close - atr * 0.45, close + atr * 1.1];

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
    methodology: '日线MA5/MA20、5日动量、20日高低区间、平均日内波幅(ATR14)的规则化合成，每2小时基于最新日K重算',
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
