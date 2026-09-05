'use strict';
const https=require('https');
const q=require('../data-quality');
const clean=s=>String(s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').trim();
function get(url) {return new Promise((resolve,reject)=>{
  const req=https.get(url,{headers:{'User-Agent':'Mozilla/5.0'}},res=>{let text='';res.setEncoding('utf8');res.on('data',c=>text+=c);res.on('end',()=>res.statusCode===200?resolve(text):reject(Error('CNFIN HTTP '+res.statusCode)));});
  req.setTimeout(12000,()=>req.destroy(Error('CNFIN timeout')));req.on('error',reject);
});}
async function collect(expert=false) {
  const pages=await Promise.allSettled([1,2,3].map(n=>get('https://www.cnfin.com/in/commoditydata/index'+(n===1?'':'_'+n)+'.shtml')));
  const links=new Map();
  for(const p of pages) if(p.status==='fulfilled') for(const m of p.value.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g)) {
    const title=clean(m[2]),url=new URL(m[1],'https://www.cnfin.com').href;
    if(new URL(url).hostname!=='www.cnfin.com' || !/\/detail\//.test(url) || !(expert?/机构看金市/:/黄金|金价|伦敦金/).test(title)) continue;
    links.set(url,title);
  }
  const articles=await Promise.allSettled([...links].slice(0,expert?3:6).map(async([url,title])=>{
    const html=await get(url);
    const date=clean(html).match(/202\d年\d{2}月\d{2}日/);
    if(!date) return [];
    const day=date[0].replace('年','-').replace('月','-').replace('日',''),publishedAt=day+'T00:00:00+08:00';
    if(!q.fresh(publishedAt,expert?168:72)) return [];
    if(!expert) return [{category:'黄金',sentiment:'unclassified',title,publishedAt,time:day,summary:'新华财经原文 · 发布日精度，无时分数据',source:'新华财经 / 中国金融信息网',url}];
    // Use named short summary headings only; never import full copyrighted reports.
    return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(m=>clean(m[1])).filter(s=>s.length<100 && /^[^：]{2,18}：/.test(s)).slice(0,5).map(s=>({institution:s.split('：')[0],expert:'新华财经机构观点摘要',date:day,publishedAt,view:s,url,source:'新华财经转述 · 原文核验'}));
  }));
  const result=articles.flatMap(r=>r.status==='fulfilled'?r.value:[]);
  if(!result.length) throw Error('CNFIN无近期匹配内容');
  return result;
}
module.exports={news:()=>collect(false),experts:()=>collect(true)};
