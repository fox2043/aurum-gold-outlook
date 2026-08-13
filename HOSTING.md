# AURUM SIGNAL 静态托管说明

本目录为纯静态站点，可上传到任意静态托管服务（GitHub Pages、对象存储、Nginx、Vercel Static 等）。

## 入口文件

- `index.html`：站点入口
- `app.js`：页面逻辑
- `styles.css`：视觉样式
- `data/dashboard.json`：行情、模型预测和资讯快照

## 更新数据

替换 `data/dashboard.json` 后重新上传即可更新页面。页面会显示快照生成时间。

专家观点为公开网页的可访问快照，展示前应核对原文中的机构、作者、发布日期和完整上下文。请勿将媒体转述视为投资建议或实际交易信号。

本项目为非商业研究展示；不包含交易、账户或报价执行功能。
