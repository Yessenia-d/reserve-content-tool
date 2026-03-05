const assert = require('assert');
const path = require('path');
const fs = require('fs');

// 使用临时数据目录进行测试
const config = require('../src/config');
const tmpDir = path.join(__dirname, 'tmp_test_data');
config.dataDir = tmpDir;
config.imagesDir = path.join(tmpDir, 'images');
config.dbFile = path.join(tmpDir, 'posts.json');

// 清理测试数据
function cleanup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

cleanup();

// 重新加载 store（使用修改后的 config）
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

console.log('\n小红书帖子保存工具 - 测试\n');

// Store 测试
console.log('Store:');

test('初始化为空', () => {
  assert.strictEqual(store.count(), 0);
  assert.deepStrictEqual(store.getAll(), []);
});

test('添加帖子', () => {
  store.add({
    noteId: 'test001',
    title: '测试美食帖子',
    content: '今天做了一道红烧肉',
    author: '小红薯',
    tags: ['美食', '红烧肉', '家常菜'],
    images: [],
    likes: 100,
    collects: 50,
    comments: 20,
  });
  assert.strictEqual(store.count(), 1);
});

test('获取帖子', () => {
  const post = store.getById('test001');
  assert.strictEqual(post.title, '测试美食帖子');
  assert.strictEqual(post.author, '小红薯');
  assert.ok(post.savedAt);
});

test('更新帖子', () => {
  store.add({
    noteId: 'test001',
    title: '测试美食帖子（更新）',
    likes: 200,
  });
  assert.strictEqual(store.count(), 1);
  const post = store.getById('test001');
  assert.strictEqual(post.title, '测试美食帖子（更新）');
  assert.strictEqual(post.likes, 200);
  assert.ok(post.updatedAt);
});

test('添加多个帖子', () => {
  store.add({ noteId: 'test002', title: '旅行日记', author: '旅行家', tags: ['旅行'] });
  store.add({ noteId: 'test003', title: '穿搭分享', author: '时尚达人', tags: ['穿搭', 'OOTD'] });
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
  assert.strictEqual(results[0].noteId, 'test003');
});

test('搜索帖子 - 按作者', () => {
  const results = store.search('小红薯');
  assert.strictEqual(results.length, 1);
});

test('搜索帖子 - 无结果', () => {
  const results = store.search('不存在的内容');
  assert.strictEqual(results.length, 0);
});

test('获取所有帖子（倒序）', () => {
  const posts = store.getAll();
  assert.strictEqual(posts.length, 3);
  assert.strictEqual(posts[0].noteId, 'test003');
});

test('删除帖子', () => {
  assert.strictEqual(store.remove('test002'), true);
  assert.strictEqual(store.count(), 2);
  assert.strictEqual(store.getById('test002'), undefined);
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
  const id = scraper.extractNoteId('https://example.com/random');
  assert.strictEqual(id, null);
});

test('创建手动帖子', () => {
  const post = scraper.createManualPost({
    title: '手动帖子',
    content: '内容',
    author: '测试',
    tags: ['标签1'],
  });
  assert.strictEqual(post.title, '手动帖子');
  assert.strictEqual(post.type, 'manual');
  assert.ok(post.noteId.startsWith('manual_'));
});

// 清理
cleanup();

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);
