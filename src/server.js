const express = require('express');
const path = require('path');
const store = require('./store');
const scraper = require('./scraper');
const config = require('./config');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(path.join(__dirname, '..', 'public')));
app.use('/images', express.static(config.imagesDir));

// 首页 - 返回Web界面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// API: 获取所有帖子
app.get('/api/posts', (req, res) => {
  const { q } = req.query;
  const posts = q ? store.search(q) : store.getAll();
  res.json({ success: true, data: posts, total: posts.length });
});

// API: 获取单个帖子
app.get('/api/posts/:noteId', (req, res) => {
  const post = store.getById(req.params.noteId);
  if (!post) {
    return res.status(404).json({ success: false, error: '帖子不存在' });
  }
  res.json({ success: true, data: post });
});

// API: 通过URL保存帖子
app.post('/api/posts/save', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: '请提供URL' });
  }

  try {
    const post = await scraper.fetchPost(url);
    store.add(post);
    res.json({ success: true, data: post });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: 手动添加帖子
app.post('/api/posts', (req, res) => {
  const { title, content, author, url, tags } = req.body;
  if (!title) {
    return res.status(400).json({ success: false, error: '请提供标题' });
  }

  const post = scraper.createManualPost({
    noteId: scraper.extractNoteId(url || '') || undefined,
    url,
    title,
    content,
    author,
    tags: typeof tags === 'string' ? tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : tags,
  });
  store.add(post);
  res.json({ success: true, data: post });
});

// API: 删除帖子
app.delete('/api/posts/:noteId', (req, res) => {
  if (store.remove(req.params.noteId)) {
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: '帖子不存在' });
  }
});

// API: 下载帖子图片
app.post('/api/posts/:noteId/download', async (req, res) => {
  const post = store.getById(req.params.noteId);
  if (!post) {
    return res.status(404).json({ success: false, error: '帖子不存在' });
  }

  try {
    const images = await scraper.downloadImages(post);
    res.json({ success: true, data: images });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: 统计信息
app.get('/api/stats', (req, res) => {
  const posts = store.getAll();
  const authors = new Set(posts.map(p => p.author).filter(Boolean));
  const allTags = posts.flatMap(p => p.tags || []);
  const tagCount = {};
  allTags.forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; });
  const topTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }));

  res.json({
    success: true,
    data: {
      totalPosts: posts.length,
      totalAuthors: authors.size,
      totalTags: Object.keys(tagCount).length,
      topTags,
    },
  });
});

app.listen(config.port, () => {
  console.log(`小红书帖子保存工具已启动!`);
  console.log(`打开浏览器访问: http://localhost:${config.port}`);
  console.log(`已保存 ${store.count()} 条帖子`);
});
