#!/usr/bin/env node

const store = require('./store');
const scraper = require('./scraper');

const [,, command, ...args] = process.argv;

const HELP = `
小红书帖子保存工具 (xhs-save)

用法:
  node src/cli.js save <url>           保存帖子（通过链接抓取）
  node src/cli.js add                  手动添加帖子
  node src/cli.js list                 列出所有已保存帖子
  node src/cli.js search <关键词>       搜索帖子
  node src/cli.js view <noteId>        查看帖子详情
  node src/cli.js delete <noteId>      删除帖子
  node src/cli.js download <noteId>    下载帖子图片到本地
  node src/cli.js stats                统计信息
  node src/cli.js help                 显示帮助

示例:
  node src/cli.js save https://www.xiaohongshu.com/explore/6578a12b000000001c00ef23
  node src/cli.js list
  node src/cli.js search 美食
`;

async function main() {
  switch (command) {
    case 'save':
      await cmdSave(args[0]);
      break;
    case 'add':
      await cmdAdd();
      break;
    case 'list':
      cmdList();
      break;
    case 'search':
      cmdSearch(args.join(' '));
      break;
    case 'view':
      cmdView(args[0]);
      break;
    case 'delete':
      cmdDelete(args[0]);
      break;
    case 'download':
      await cmdDownload(args[0]);
      break;
    case 'stats':
      cmdStats();
      break;
    case 'help':
    default:
      console.log(HELP);
  }
}

async function cmdSave(url) {
  if (!url) {
    console.error('请提供小红书帖子链接');
    process.exit(1);
  }

  console.log(`正在抓取: ${url}`);
  try {
    const post = await scraper.fetchPost(url);
    store.add(post);
    console.log(`\n保存成功!`);
    printPostSummary(post);
  } catch (err) {
    console.error(`抓取失败: ${err.message}`);
    console.log('\n提示: 如果自动抓取失败，可以使用 "add" 命令手动保存');
  }
}

async function cmdAdd() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log('手动添加帖子 (输入帖子信息)\n');

  const url = await ask('帖子链接 (可选): ');
  const title = await ask('标题: ');
  const author = await ask('作者: ');
  const content = await ask('内容/描述: ');
  const tagsInput = await ask('标签 (逗号分隔): ');

  rl.close();

  const tags = tagsInput ? tagsInput.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];
  const noteId = scraper.extractNoteId(url) || `manual_${Date.now()}`;

  const post = scraper.createManualPost({ noteId, url, title, content, author, tags });
  store.add(post);

  console.log(`\n保存成功!`);
  printPostSummary(post);
}

function cmdList() {
  const posts = store.getAll();
  if (posts.length === 0) {
    console.log('暂无保存的帖子');
    return;
  }

  console.log(`共 ${posts.length} 条帖子:\n`);
  posts.forEach((post, i) => {
    console.log(`${i + 1}. [${post.noteId}]`);
    console.log(`   标题: ${post.title}`);
    console.log(`   作者: ${post.author || '未知'}`);
    console.log(`   标签: ${(post.tags || []).map(t => '#' + t).join(' ') || '无'}`);
    console.log(`   保存时间: ${post.savedAt || '未知'}`);
    console.log('');
  });
}

function cmdSearch(keyword) {
  if (!keyword) {
    console.error('请提供搜索关键词');
    process.exit(1);
  }

  const results = store.search(keyword);
  if (results.length === 0) {
    console.log(`未找到与 "${keyword}" 相关的帖子`);
    return;
  }

  console.log(`找到 ${results.length} 条相关帖子:\n`);
  results.forEach((post, i) => {
    console.log(`${i + 1}. [${post.noteId}] ${post.title} - ${post.author || '未知'}`);
  });
}

function cmdView(noteId) {
  if (!noteId) {
    console.error('请提供帖子ID');
    process.exit(1);
  }

  const post = store.getById(noteId);
  if (!post) {
    console.error(`未找到帖子: ${noteId}`);
    process.exit(1);
  }

  console.log('========================================');
  console.log(`标题: ${post.title}`);
  console.log(`作者: ${post.author || '未知'}`);
  console.log(`链接: ${post.url}`);
  console.log(`类型: ${post.type || 'normal'}`);
  console.log('----------------------------------------');
  console.log(`内容:\n${post.content || '(无内容)'}`);
  console.log('----------------------------------------');
  console.log(`标签: ${(post.tags || []).map(t => '#' + t).join(' ') || '无'}`);
  console.log(`图片: ${(post.images || []).length} 张`);
  if (post.video) console.log(`视频: 有 (时长 ${post.video.duration}s)`);
  console.log(`点赞: ${post.likes} | 收藏: ${post.collects} | 评论: ${post.comments}`);
  console.log(`保存时间: ${post.savedAt || '未知'}`);
  console.log('========================================');
}

function cmdDelete(noteId) {
  if (!noteId) {
    console.error('请提供帖子ID');
    process.exit(1);
  }

  if (store.remove(noteId)) {
    console.log(`已删除帖子: ${noteId}`);
  } else {
    console.error(`未找到帖子: ${noteId}`);
  }
}

async function cmdDownload(noteId) {
  if (!noteId) {
    console.error('请提供帖子ID');
    process.exit(1);
  }

  const post = store.getById(noteId);
  if (!post) {
    console.error(`未找到帖子: ${noteId}`);
    process.exit(1);
  }

  if (!post.images || post.images.length === 0) {
    console.log('该帖子没有图片');
    return;
  }

  console.log(`正在下载 ${post.images.length} 张图片...`);
  const downloaded = await scraper.downloadImages(post);
  console.log(`成功下载 ${downloaded.length} 张图片到 data/images/${noteId}/`);
}

function cmdStats() {
  const posts = store.getAll();
  const authors = new Set(posts.map(p => p.author).filter(Boolean));
  const allTags = posts.flatMap(p => p.tags || []);
  const tagCount = {};
  allTags.forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; });
  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 10);

  console.log('========= 统计信息 =========');
  console.log(`总帖子数: ${posts.length}`);
  console.log(`作者数: ${authors.size}`);
  console.log(`标签数: ${Object.keys(tagCount).length}`);
  if (topTags.length > 0) {
    console.log(`\n热门标签:`);
    topTags.forEach(([tag, count]) => {
      console.log(`  #${tag} (${count})`);
    });
  }
  console.log('============================');
}

function printPostSummary(post) {
  console.log(`  ID: ${post.noteId}`);
  console.log(`  标题: ${post.title}`);
  console.log(`  作者: ${post.author || '未知'}`);
  console.log(`  图片: ${(post.images || []).length} 张`);
  console.log(`  标签: ${(post.tags || []).map(t => '#' + t).join(' ') || '无'}`);
}

main().catch(err => {
  console.error('错误:', err.message);
  process.exit(1);
});
