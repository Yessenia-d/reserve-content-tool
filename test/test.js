const assert = require('assert');
const path = require('path');
const fs = require('fs');

// 使用临时数据目录进行测试
const config = require('../src/config');
const tmpDir = path.join(__dirname, 'tmp_test_data');
config.dataDir = tmpDir;
config.imagesDir = path.join(tmpDir, 'images');
config.snapshotsDir = path.join(tmpDir, 'snapshots');
config.dbFile = path.join(tmpDir, 'posts.json');

function cleanup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

cleanup();

delete require.cache[require.resolve('../src/store')];
const store = require('../src/store');
const scraper = require('../src/scraper');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

console.log('\n小红书帖子归档工具 - 测试\n');

// Store 测试
console.log('Store:');

test('初始化为空', () => {
  assert.strictEqual(store.count(), 0);
  assert.deepStrictEqual(store.getAll(), []);
});

test('添加帖子（含评论）', () => {
  store.add({
    noteId: 'test001',
    title: '测试美食帖子',
    content: '今天做了一道红烧肉，超好吃！',
    author: '小红薯',
    tags: ['美食', '红烧肉', '家常菜'],
    images: [
      { url: 'https://example.com/img1.jpg', localPath: 'images/test001/1.jpg', filename: '1.jpg' },
      { url: 'https://example.com/img2.jpg', localPath: 'images/test001/2.jpg', filename: '2.jpg' },
    ],
    likes: 100,
    collects: 50,
    comments: 20,
    commentList: [
      {
        id: 'c1', author: '吃货', content: '看起来好好吃！', likes: 5,
        createTime: '2024-01-01T12:00:00Z',
        subComments: [
          { id: 'sc1', author: '小红薯', content: '谢谢！做法很简单', likes: 2 },
        ],
      },
      { id: 'c2', author: '美食家', content: '求教程', likes: 3, subComments: [] },
    ],
    archived: true,
    archivedAt: '2024-01-15T10:00:00Z',
  });
  assert.strictEqual(store.count(), 1);
});

test('获取帖子（含评论和本地图片路径）', () => {
  const post = store.getById('test001');
  assert.strictEqual(post.title, '测试美食帖子');
  assert.strictEqual(post.commentList.length, 2);
  assert.strictEqual(post.commentList[0].subComments.length, 1);
  assert.strictEqual(post.images[0].localPath, 'images/test001/1.jpg');
  assert.strictEqual(post.archived, true);
});

test('更新帖子', () => {
  store.add({ noteId: 'test001', title: '测试美食帖子（更新版）', likes: 200 });
  assert.strictEqual(store.count(), 1);
  const post = store.getById('test001');
  assert.strictEqual(post.title, '测试美食帖子（更新版）');
  assert.strictEqual(post.likes, 200);
  assert.ok(post.updatedAt);
});

test('添加多个帖子', () => {
  store.add({ noteId: 'test002', title: '旅行日记', author: '旅行家', tags: ['旅行'], commentList: [], archived: false });
  store.add({ noteId: 'test003', title: '穿搭分享', author: '时尚达人', tags: ['穿搭', 'OOTD'], commentList: [], archived: true });
  assert.strictEqual(store.count(), 3);
});

test('搜索帖子 - 按标题', () => {
  const results = store.search('旅行');
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].noteId, 'test002');
});

test('搜索帖子 - 按标签', () => {
  const results = store.search('OOTD');
  assert.strictEqual(results.length, 1);
});

test('搜索帖子 - 按作者', () => {
  const results = store.search('小红薯');
  assert.strictEqual(results.length, 1);
});

test('搜索帖子 - 无结果', () => {
  assert.strictEqual(store.search('不存在').length, 0);
});

test('获取所有帖子（倒序）', () => {
  const posts = store.getAll();
  assert.strictEqual(posts[0].noteId, 'test003');
});

test('删除帖子', () => {
  assert.strictEqual(store.remove('test002'), true);
  assert.strictEqual(store.count(), 2);
});

test('删除不存在的帖子', () => {
  assert.strictEqual(store.remove('nonexistent'), false);
});

// Scraper 测试
console.log('\nScraper:');

test('提取笔记ID - explore链接', () => {
  const id = scraper.extractNoteId('https://www.xiaohongshu.com/explore/6578a12b000000001c00ef23');
  assert.strictEqual(id, '6578a12b000000001c00ef23');
});

test('提取笔记ID - discovery链接', () => {
  const id = scraper.extractNoteId('https://www.xiaohongshu.com/discovery/item/6578a12b000000001c00ef23');
  assert.strictEqual(id, '6578a12b000000001c00ef23');
});

test('提取笔记ID - 无效链接', () => {
  assert.strictEqual(scraper.extractNoteId('https://example.com/random'), null);
});

test('创建手动帖子（含空评论列表）', () => {
  const post = scraper.createManualPost({
    title: '手动帖子',
    content: '内容',
    author: '测试',
    tags: ['标签1'],
  });
  assert.strictEqual(post.title, '手动帖子');
  assert.strictEqual(post.type, 'manual');
  assert.strictEqual(post.archived, false);
  assert.ok(Array.isArray(post.commentList));
  assert.strictEqual(post.commentList.length, 0);
  assert.ok(post.noteId.startsWith('manual_'));
});

// 快照生成测试
console.log('\nSnapshot:');

test('生成离线HTML快照', () => {
  const post = {
    noteId: 'snap_test',
    url: 'https://www.xiaohongshu.com/explore/snap_test',
    title: '快照测试帖子',
    content: '这是一个测试帖子的内容\n包含换行',
    author: '测试作者',
    tags: ['测试', '快照'],
    images: [],
    likes: 42,
    collects: 10,
    comments: 3,
    commentList: [
      {
        id: 'c1', author: '评论者A', content: '好文章！', likes: 5,
        createTime: '2024-06-01T10:00:00Z',
        subComments: [{ id: 'sc1', author: '作者', content: '感谢！', likes: 0 }],
      },
    ],
    archived: true,
    archivedAt: '2024-06-15T08:00:00Z',
  };

  const snapshotPath = scraper.generateSnapshot(post);
  assert.strictEqual(snapshotPath, 'snapshots/snap_test.html');

  const fullPath = path.join(config.snapshotsDir, 'snap_test.html');
  assert.ok(fs.existsSync(fullPath), '快照文件应该存在');

  const html = fs.readFileSync(fullPath, 'utf-8');
  assert.ok(html.includes('快照测试帖子'), '快照应包含标题');
  assert.ok(html.includes('测试作者'), '快照应包含作者');
  assert.ok(html.includes('这是一个测试帖子的内容'), '快照应包含内容');
  assert.ok(html.includes('评论者A'), '快照应包含评论');
  assert.ok(html.includes('好文章'), '快照应包含评论内容');
  assert.ok(html.includes('感谢'), '快照应包含子评论');
  assert.ok(html.includes('#测试'), '快照应包含标签');
  assert.ok(html.includes('42'), '快照应包含点赞数');
});

test('快照为自包含HTML（可离线打开）', () => {
  const fullPath = path.join(config.snapshotsDir, 'snap_test.html');
  const html = fs.readFileSync(fullPath, 'utf-8');
  assert.ok(html.startsWith('<!DOCTYPE html>'), '应为完整HTML文档');
  assert.ok(html.includes('<style>'), '应包含内联样式');
  assert.ok(!html.includes('<link rel="stylesheet"'), '不应引用外部样式表');
  assert.ok(!html.includes('<script src='), '不应引用外部脚本');
});

// 清理
cleanup();

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
