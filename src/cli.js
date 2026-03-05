#!/usr/bin/env node

const store = require('./store');
const scraper = require('./scraper');

const [,, command, ...args] = process.argv;

const HELP = `
小红书帖子归档工具 (xhs-save)

用法:
  node src/cli.js archive <url>        完整归档帖子（内容+图片+评论+快照）
  node src/cli.js add                  手动添加帖子
  node src/cli.js list                 列出所有已保存帖子
  node src/cli.js search <关键词>       搜索帖子
  node src/cli.js view <noteId>        查看帖子详情（含评论）
  node src/cli.js delete <noteId>      删除帖子
  node src/cli.js export <noteId>      重新生成离线HTML快照
  node src/cli.js stats                统计信息
  node src/cli.js help                 显示帮助

示例:
  node src/cli.js archive https://www.xiaohongshu.com/explore/6578a12b000000001c00ef23
  node src/cli.js list
  node src/cli.js search 美食
  node src/cli.js view 6578a12b000000001c00ef23

归档后的帖子包含:
  - 完整文字内容
  - 所有图片（下载到本地 data/images/）
  - 评论（含楼中楼回复）
  - 独立HTML快照（data/snapshots/ 可离线打开）
`;

async function main() {
  switch (command) {
    case 'archive':
    case 'save':
      await cmdArchive(args[0]);
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
    case 'export':
      cmdExport(args[0]);
      break;
    case 'stats':
      cmdStats();
      break;
    case 'help':
    default:
      console.log(HELP);
  }
}

async function cmdArchive(url) {
  if (!url) {
    console.error('请提供小红书帖子链接');
    process.exit(1);
  }

  try {
    const post = await scraper.archivePost(url, (msg) => {
      console.log(`  ${msg}`);
    });
    store.add(post);

    const imgSaved = (post.images || []).filter(i => i.localPath).length;
    const commentsSaved = (post.commentList || []).length;

    console.log(`\n归档完成!`);
    console.log(`  ID:    ${post.noteId}`);
    console.log(`  标题:  ${post.title}`);
    console.log(`  作者:  ${post.author || '未知'}`);
    console.log(`  图片:  ${imgSaved} 张已下载到本地`);
    console.log(`  评论:  ${commentsSaved} 条`);
    console.log(`  快照:  data/${post.snapshotPath}`);
    console.log(`\n即使原帖被删，你也可以通过以下方式查看:`);
    console.log(`  命令行: node src/cli.js view ${post.noteId}`);
    console.log(`  浏览器: 直接打开 data/${post.snapshotPath}`);
    console.log(`  Web界面: npm start 后访问 http://localhost:3000`);
  } catch (err) {
    console.error(`归档失败: ${err.message}`);
    console.log('\n提示: 如果自动抓取失败，可以使用 "add" 命令手动保存');
  }
}

async function cmdAdd() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log('手动添加帖子\n');

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

  console.log(`\n保存成功! ID: ${post.noteId}`);
}

function cmdList() {
  const posts = store.getAll();
  if (posts.length === 0) {
    console.log('暂无保存的帖子');
    return;
  }

  console.log(`共 ${posts.length} 条帖子:\n`);
  posts.forEach((post, i) => {
    const status = post.archived ? '[已归档]' : '[未归档]';
    const imgCount = (post.images || []).filter(i => i.localPath).length;
    const commentCount = (post.commentList || []).length;
    console.log(`${i + 1}. ${status} [${post.noteId}]`);
    console.log(`   ${post.title} - ${post.author || '未知'}`);
    console.log(`   图片: ${imgCount}张 | 评论: ${commentCount}条 | ${(post.tags || []).map(t => '#' + t).join(' ') || '无标签'}`);
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
    const status = post.archived ? '[已归档]' : '';
    console.log(`${i + 1}. ${status} [${post.noteId}] ${post.title} - ${post.author || '未知'}`);
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

  console.log('╔══════════════════════════════════════════╗');
  console.log(`  ${post.title}`);
  console.log('╠══════════════════════════════════════════╣');
  console.log(`  作者: ${post.author || '未知'}`);
  console.log(`  链接: ${post.url || '无'}`);
  console.log(`  状态: ${post.archived ? '已完整归档' : '未归档'}`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('');
  console.log(post.content || '(无内容)');
  console.log('');
  console.log('──────────────────────────────────────────');
  console.log(`  标签: ${(post.tags || []).map(t => '#' + t).join(' ') || '无'}`);

  const localImgs = (post.images || []).filter(i => i.localPath);
  console.log(`  图片: ${(post.images || []).length} 张 (${localImgs.length} 张已下载)`);
  localImgs.forEach((img, i) => {
    console.log(`    ${i + 1}. data/${img.localPath}${img.size ? ` (${(img.size / 1024).toFixed(0)}KB)` : ''}`);
  });

  if (post.video) {
    console.log(`  视频: ${post.video.localPath ? `data/${post.video.localPath}` : post.video.url || '有'} (${post.video.duration}s)`);
  }

  console.log(`  点赞: ${post.likes} | 收藏: ${post.collects} | 评论: ${post.comments}`);
  console.log(`  保存时间: ${post.savedAt || '未知'}`);
  if (post.snapshotPath) {
    console.log(`  离线快照: data/${post.snapshotPath}`);
  }

  // 显示评论
  const comments = post.commentList || [];
  if (comments.length > 0) {
    console.log('');
    console.log(`══ 评论 (${comments.length}) ══`);
    comments.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.author}${c.likes ? ` (${c.likes}赞)` : ''}`);
      console.log(`     ${c.content}`);
      if (c.createTime) console.log(`     ${new Date(c.createTime).toLocaleString('zh-CN')}`);

      (c.subComments || []).forEach(sc => {
        console.log(`       ↳ ${sc.author}: ${sc.content}`);
      });
    });
  }

  console.log('╚══════════════════════════════════════════╝');
}

function cmdDelete(noteId) {
  if (!noteId) {
    console.error('请提供帖子ID');
    process.exit(1);
  }

  if (store.remove(noteId)) {
    console.log(`已删除帖子: ${noteId}`);
    console.log('注意: 本地图片和快照文件需手动清理 data/images/ 和 data/snapshots/');
  } else {
    console.error(`未找到帖子: ${noteId}`);
  }
}

function cmdExport(noteId) {
  if (!noteId) {
    console.error('请提供帖子ID');
    process.exit(1);
  }

  const post = store.getById(noteId);
  if (!post) {
    console.error(`未找到帖子: ${noteId}`);
    process.exit(1);
  }

  const snapshotPath = scraper.generateSnapshot(post);
  post.snapshotPath = snapshotPath;
  store.add(post);
  console.log(`已生成离线快照: data/${snapshotPath}`);
  console.log('可以直接用浏览器打开此文件查看完整帖子');
}

function cmdStats() {
  const posts = store.getAll();
  const archived = posts.filter(p => p.archived);
  const authors = new Set(posts.map(p => p.author).filter(Boolean));
  const allTags = posts.flatMap(p => p.tags || []);
  const tagCount = {};
  allTags.forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; });
  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const totalImages = posts.reduce((sum, p) => sum + (p.images || []).filter(i => i.localPath).length, 0);
  const totalComments = posts.reduce((sum, p) => sum + (p.commentList || []).length, 0);

  console.log('╔══════════ 归档统计 ══════════╗');
  console.log(`  总帖子数:     ${posts.length}`);
  console.log(`  已归档:       ${archived.length}`);
  console.log(`  作者数:       ${authors.size}`);
  console.log(`  已下载图片:   ${totalImages} 张`);
  console.log(`  已保存评论:   ${totalComments} 条`);
  console.log(`  标签数:       ${Object.keys(tagCount).length}`);
  if (topTags.length > 0) {
    console.log(`\n  热门标签:`);
    topTags.forEach(([tag, count]) => {
      console.log(`    #${tag} (${count})`);
    });
  }
  console.log('╚══════════════════════════════╝');
}

main().catch(err => {
  console.error('错误:', err.message);
  process.exit(1);
});
