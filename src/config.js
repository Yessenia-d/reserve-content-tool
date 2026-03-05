const path = require('path');

module.exports = {
  // 数据存储路径
  dataDir: path.join(__dirname, '..', 'data'),
  imagesDir: path.join(__dirname, '..', 'data', 'images'),
  dbFile: path.join(__dirname, '..', 'data', 'posts.json'),

  // 服务器端口
  port: process.env.PORT || 3000,

  // 请求头配置（模拟浏览器访问）
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://www.xiaohongshu.com/',
  },

  // 小红书分享链接正则
  urlPatterns: [
    /https?:\/\/www\.xiaohongshu\.com\/explore\/([a-f0-9]+)/,
    /https?:\/\/www\.xiaohongshu\.com\/discovery\/item\/([a-f0-9]+)/,
    /https?:\/\/xhslink\.com\/\w+/,
  ],
};
