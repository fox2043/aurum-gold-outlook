'use strict';
const fs = require('fs');
const path = require('path');
const q = require('../data-quality');
const target = path.join(__dirname, '..', 'data', 'dashboard.json');
const round = x => Math.round(x * 10) / 10;
const clamp = x => Math.max(0, Math.min(100, x));

function buildForecast(dashboard, now = Date.now()) {
  const gold = dashboard.market.gold;
  const rows = [...new Map((gold.candles || []).filter(c =>
    [c.open,c.close,c.high,c.low].every(x => Number.isFinite(x) && x > 0) &&
    c.high >= Math.max(c.open,c.close) && c.low <= Math.min(c.open,c.close) && q.stamp(c.date) <= now
  ).map(c => [c.date,c])).values()].sort((a,b) => a.date.localeCompare(b.date));
  if (rows.length < 20) throw Error('至少需要20根有效同品种日K');
  const close = gold.value, last = rows.at(-1);
  if (!Number.isFinite(close) || close <= 0) throw Error('缺少有效报价');
  const mean = n => rows.slice(-n).reduce((s,c) => s+c.close,0)/n;
  const ma5 = mean(5), ma20 = mean(20);
  // True range includes overnight gaps against the previous close.
  const ranges = rows.slice(1).map((c,i) => Math.max(c.high-c.low, Math.abs(c.high-rows[i].close), Math.abs(c.low-rows[i].close)));
  const atr = ranges.slice(-14).reduce((s,x)=>s+x,0)/14;
  const mom5 = close/rows.at(-6).close-1;
  const dailyChange = Number(gold.change) || 0;
  const marketScore = clamp(50 + (close > ma5 ? 8 : -8) + (ma5 > ma20 ? 8 : -8) + (close > ma20 ? 8 : -8) + Math.max(-12, Math.min(12,mom5*600)) + Math.max(-18,Math.min(18,dailyChange*6)));
  const experts = q.experts(dashboard.weeklyExpertUpdates,now);
  const combinedScore = (marketScore + experts.score)/2;
  const issues = [];
  if (!q.fresh(gold.quoteTime, .25, now)) issues.push('报价超过15分钟，休市或延迟需核对');
  if (!q.fresh(last.date, 96, now)) issues.push('日K超过4日未更新');
  if (dashboard.market.sourceQuality?.status === 'disagreement') issues.push('同品种报价出现冲突，暂停价格预测');
  if (experts.status === 'insufficient') issues.push('缺少至少两家独立机构的近7日短期观点，专家部分证据不足');
  const blocked = !q.fresh(gold.quoteTime, 72, now) || !q.fresh(last.date, 96, now) || dashboard.market.sourceQuality?.status === 'disagreement';
  const shift = (combinedScore-50)/50*atr, width = atr*Math.sqrt(5);
  const support = Math.min(...rows.slice(-10).map(c=>c.low),close-atr);
  const resistance = Math.max(...rows.slice(-10).map(c=>c.high),close+atr);
  return {
    modelVersion:'source-audit-v2', computedAt:new Date(now).toISOString(), asOf:new Date(now).toISOString(),
    marketDate:last.date, quoteTime:gold.quoteTime, anchorPrice:close, horizon:'未来5个交易日',
    status:blocked?'suspended':issues.length?'limited':'available', issues,
    bias:blocked?'数据过期 · 暂停预测':combinedScore>=59?'综合偏多':combinedScore<=41?'综合偏空':'综合震荡待确认',
    confidence:null, scenarios:{}, weights:{expertViews:50,marketAndMacroData:50},
    signals:{marketScore:round(marketScore),expertScore:round(experts.score),combinedScore:round(combinedScore),expertVotes:experts.votes,dailyChange:round(dailyChange)},
    expertEvidence:experts.accepted, ma5:round(ma5),ma20:round(ma20),atr:round(atr),support:round(support),resistance:round(resistance),
    expectedRange:blocked?null:[round(Math.max(.01,close+shift-width)),round(close+shift+width)], target:blocked?null:round(close+shift),
    action:blocked?'行情或日K过期，等待有效源恢复后重新计算。':'5日波动情景，起算价 '+round(close)+' USD/OZ；'+(issues.length?issues.join('；'):'来源时效检查通过')+'。',
    triggerUp:'日收盘突破 '+round(resistance)+' 后复核', triggerDown:'日收盘跌破 '+round(support)+' 后复核',
    invalidation:'发生重大事件或价格脱离情景区间时，原预测失效并重新评估。',
    methodology:'专家50%：仅近7日、具名机构、明确短期方向的公开转述，按时效衰减、每机构一票；资料缺失为中性。量价50%：MA5/20、5日动量和当日涨跌；真实波幅ATR包含跳空。尚未接入实时美元/实际利率因子，新闻只供阅读，不以标题关键词生成宏观分数。区间是5日波动情景，并非经校准的命中概率。',
    disclaimer:'预测仅做参考，不作为实际投资建议。'
  };
}

function track(d,f) {
  const rows=d.market.gold.candles||[], today=f.computedAt.slice(0,10);
  const archive=d.forecastArchive||[];
  for (const a of archive) {
    if(a.result) continue;
    const future=rows.filter(c=>c.date>a.issuedDate && c.date<today).sort((x,y)=>x.date.localeCompare(y.date));
    if(future.length>=5) {
      const actual=future[4].close;
      a.result={date:future[4].date,actual,absoluteError:Math.abs(actual-a.target),naiveError:Math.abs(actual-a.anchorPrice),inside:actual>=a.range[0]&&actual<=a.range[1]};
    }
  }
  if(f.status!=='suspended' && !archive.some(a=>a.issuedDate===today)) archive.push({issuedDate:today,issuedAt:f.computedAt,target:f.target,anchorPrice:f.anchorPrice,range:f.expectedRange,version:f.modelVersion,status:f.status});
  d.forecastArchive=archive.slice(-365);
  const scored=archive.filter(a=>a.result), count=scored.length;
  d.forecastEvaluation={count,mae:count?round(scored.reduce((s,a)=>s+a.result.absoluteError,0)/count):null,naiveMae:count?round(scored.reduce((s,a)=>s+a.result.naiveError,0)/count):null,note:count?'前瞻留档的5日结果；同时比较价格不变基线。':'尚无成熟的前瞻验证样本，暂不能声称预测准确率提升。'};
}
if(require.main===module) {
  try {
    const d=JSON.parse(fs.readFileSync(target,'utf8')), f=buildForecast(d);
    d.goldForecast=f; track(d,f);
    d.analysis={...(d.analysis||{}),goldBias:f.bias,invalidation:f.invalidation,conclusions:[
      {label:'预测方法',verdict:f.bias,trigger:f.methodology},
      {label:'输入质量',verdict:f.issues.length?f.issues.join('；'):'来源时间有效',trigger:'报价 '+f.quoteTime+'；日K '+f.marketDate},
      {label:'预测效果核验',verdict:d.forecastEvaluation.note,trigger:'已完成 '+d.forecastEvaluation.count+' 个样本；模型绝对误差 '+(d.forecastEvaluation.mae??'待积累')+'；价格不变基线 '+(d.forecastEvaluation.naiveMae??'待积累')}
    ]};
    fs.writeFileSync(target,JSON.stringify(d)+'\n');
    console.log(JSON.stringify({bias:f.bias,status:f.status,issues:f.issues,evaluation:d.forecastEvaluation}));
  } catch(e) {console.error(e);process.exitCode=1;}
}
module.exports={buildForecast,track};
