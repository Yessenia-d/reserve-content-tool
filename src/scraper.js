const fs = require('fs');
const path = require('path');
const config = require('./config');

let fetch;
let cheerio;

async function loadDeps() {
  if (!fetch) {
    fetch = require('node-fetch');
  }
  if (!cheerio) {
    cheerio = require('cheerio');
  }
}

/**
 * 从URL中提取笔记ID
 */
function extractNoteId(url) {
  for (const pattern of config.urlPatterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  const fallback = url.match(/([a-f0-9]{24})/);
  return fallback ? fallback[1] : null;
}

/**
 * 解析短链接获取真实URL
 */
async function resolveShortUrl(url) {
  await loadDeps();
  if (url.includes('xhslink.com')) {
    const resp = await fetch(url, {
      headers: config.headers,
      redirect: 'manual',
    });
    const location = resp.headers.get('location');
    return location || url;
  }
  return url;
}

/**
 * 完整归档一个帖子：抓取内容 + 下载图片 + 保存评论 + 生成快照
 */
async function archivePost(url, progressCb) {
  const log = progressCb || (() => {});

  log('正在解析链接...');
  const resolvedUrl = await resolveShortUrl(url);
  const noteId = extractNoteId(resolvedUrl);
  if (!noteId) {
    throw new Error(`无法从URL中提取笔记ID: ${url}`);
  }

  log('正在抓取帖子内容...');
  const post = await fetchPost(resolvedUrl, noteId);

  log('正在抓取评论...');
  post.commentList = await fetchComments(noteId);

  log(`正在下载 ${(post.images || []).length} 张图片...`);
  const localImages = await downloadImages(post);
  post.images = localImages;

  if (post.avatar) {
    log('正在下载头像...');
    post.localAvatar = await downloadAvatar(post);
  }

  if (post.video && post.video.url) {
    log('正在下载视频...');
    post.video.localPath = await downloadVideo(post);
  }

  post.archived = true;
  post.archivedAt = new Date().toISOString();

  log('正在生成离线快照...');
  post.snapshotPath = generateSnapshot(post);

  log('归档完成!');
  return post;
}

/**
 * 抓取帖子内容（仅数据，不下载资源）
 */
async function fetchPost(url, noteId) {
  await loadDeps();

  const resolvedUrl = noteId ? url : await resolveShortUrl(url);
  const id = noteId || extractNoteId(resolvedUrl);

  if (!id) {
    throw new Error(`无法从URL中提取笔记ID: ${url}`);
  }

  const pageUrl = `https://www.xiaohongshu.com/explore/${id}`;
  const resp = await fetch(pageUrl, { headers: config.headers });

  if (!resp.ok) {
    throw new Error(`请求失败 (HTTP ${resp.status}): ${pageUrl}`);
  }

  const html = await resp.text();
  const post = parsePostHtml(html, id, pageUrl);
  post.rawHtml = html;
  return post;
}

/**
 * 抓取帖子评论
 */
async function fetchComments(noteId) {
  await loadDeps();
  const comments = [];

  try {
    const apiUrl = `https://www.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=${noteId}&cursor=&top_comment_id=&image_formats=jpg,webp,avif`;
    const resp = await fetch(apiUrl, {
      headers: {
        ...config.headers,
        'Accept': 'application/json',
      },
    });

    if (resp.ok) {
      const data = await resp.json();
      const rawComments = data?.data?.comments || [];
      for (const c of rawComments) {
        const comment = {
          id: c.id,
          author: c.user_info?.nickname || '匿名',
          authorId: c.user_info?.user_id || '',
          avatar: c.user_info?.image || '',
          content: c.content || '',
          likes: c.like_count || 0,
          createTime: c.create_time ? new Date(c.create_time).toISOString() : '',
          subComments: [],
        };

        if (c.sub_comments) {
          for (const sc of c.sub_comments) {
            comment.subComments.push({
              id: sc.id,
              author: sc.user_info?.nickname || '匿名',
              content: sc.content || '',
              likes: sc.like_count || 0,
              createTime: sc.create_time ? new Date(sc.create_time).toISOString() : '',
            });
          }
        }

        comments.push(comment);
      }
    }
  } catch (e) {
    // 评论抓取失败不阻塞整体流程
  }

  return comments;
}

/**
 * 解析帖子HTML提取结构化数据
 */
function parsePostHtml(html, noteId, url) {
  const $ = cheerio.load(html);

  let postData = null;
  $('script').each((_, el) => {
    const text = $(el).html() || '';
    if (text.includes('__INITIAL_STATE__')) {
      try {
        const jsonStr = text
          .replace(/.*__INITIAL_STATE__\s*=\s*/, '')
          .replace(/;?\s*$/, '')
          .replace(/undefined/g, 'null');
        const state = JSON.parse(jsonStr);
        const noteDetail = state?.note?.noteDetailMap?.[noteId]?.note;
        if (noteDetail) {
          postData = noteDetail;
        }
      } catch (e) {
        // 解析失败，使用DOM解析
      }
    }
  });

  if (postData) {
    return formatPostData(postData, noteId, url);
  }

  return {
    noteId,
    url,
    title: $('meta[name="og:title"]').attr('content') ||
           $('meta[property="og:title"]').attr('content') ||
           $('.title, .note-title, h1').first().text().trim() ||
           '未知标题',
    content: $('meta[name="description"]').attr('content') ||
             $('meta[name="og:description"]').attr('content') ||
             $('.content, .note-content, .desc').first().text().trim() ||
             '',
    author: $('meta[name="author"]').attr('content') ||
            $('.author-name, .user-name, .name').first().text().trim() ||
            '未知作者',
    images: extractImages($),
    tags: extractTags($),
    likes: 0,
    collects: 0,
    comments: 0,
    commentList: [],
    type: 'normal',
  };
}

function formatPostData(data, noteId, url) {
  const images = (data.imageList || []).map(img => ({
    url: img.urlDefault || img.url || '',
    width: img.width,
    height: img.height,
  }));

  const tags = (data.tagList || []).map(tag => tag.name).filter(Boolean);

  return {
    noteId,
    url,
    title: data.title || '未知标题',
    content: data.desc || '',
    author: data.user?.nickname || '未知作者',
    authorId: data.user?.userId || '',
    avatar: data.user?.avatar || '',
    images,
    video: data.video ? {
      url: data.video.media?.stream?.h264?.[0]?.masterUrl || '',
      duration: data.video.duration || 0,
    } : null,
    tags,
    likes: data.interactInfo?.likedCount || 0,
    collects: data.interactInfo?.collectedCount || 0,
    comments: data.interactInfo?.commentCount || 0,
    commentList: [],
    type: data.type || 'normal',
    publishTime: data.time || '',
  };
}

function extractImages($) {
  const images = [];
  $('meta[property="og:image"], meta[name="og:image"]').each((_, el) => {
    const url = $(el).attr('content');
    if (url) images.push({ url });
  });
  if (images.length === 0) {
    $('.note-image img, .carousel img, .swiper-slide img').each((_, el) => {
      const url = $(el).attr('src') || $(el).attr('data-src');
      if (url) images.push({ url });
    });
  }
  return images;
}

function extractTags($) {
  const tags = [];
  $('.tag, .hashtag, a[href*="hashtag"]').each((_, el) => {
    const text = $(el).text().trim().replace(/^#/, '');
    if (text) tags.push(text);
  });
  return tags;
}

/**
 * 下载帖子所有图片到本地，返回带 localPath 的图片数组
 */
async function downloadImages(post) {
  await loadDeps();
  const postDir = path.join(config.imagesDir, post.noteId);

  if (!fs.existsSync(postDir)) {
    fs.mkdirSync(postDir, { recursive: true });
  }

  const result = [];
  for (let i = 0; i < (post.images || []).length; i++) {
    const img = post.images[i];
    if (!img.url) {
      result.push(img);
      continue;
    }

    const ext = safeExt(img.url) || '.jpg';
    const filename = `${i + 1}${ext}`;
    const filepath = path.join(postDir, filename);

    try {
      const resp = await fetch(img.url, { headers: config.headers });
      if (resp.ok) {
        const buffer = await resp.buffer();
        fs.writeFileSync(filepath, buffer);
        result.push({
          ...img,
          localPath: `images/${post.noteId}/${filename}`,
          filename,
          size: buffer.length,
        });
        continue;
      }
    } catch (e) {
      // 下载失败，保留原始URL
    }
    result.push(img);
  }

  return result;
}

/**
 * 下载作者头像
 */
async function downloadAvatar(post) {
  await loadDeps();
  if (!post.avatar) return null;

  const postDir = path.join(config.imagesDir, post.noteId);
  if (!fs.existsSync(postDir)) {
    fs.mkdirSync(postDir, { recursive: true });
  }

  const ext = safeExt(post.avatar) || '.jpg';
  const filepath = path.join(postDir, `avatar${ext}`);

  try {
    const resp = await fetch(post.avatar, { headers: config.headers });
    if (resp.ok) {
      const buffer = await resp.buffer();
      fs.writeFileSync(filepath, buffer);
      return `images/${post.noteId}/avatar${ext}`;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

/**
 * 下载视频
 */
async function downloadVideo(post) {
  await loadDeps();
  if (!post.video || !post.video.url) return null;

  const postDir = path.join(config.imagesDir, post.noteId);
  if (!fs.existsSync(postDir)) {
    fs.mkdirSync(postDir, { recursive: true });
  }

  const filepath = path.join(postDir, 'video.mp4');

  try {
    const resp = await fetch(post.video.url, { headers: config.headers });
    if (resp.ok) {
      const buffer = await resp.buffer();
      fs.writeFileSync(filepath, buffer);
      return `images/${post.noteId}/video.mp4`;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

/**
 * 生成自包含的离线HTML快照
 */
function generateSnapshot(post) {
  if (!fs.existsSync(config.snapshotsDir)) {
    fs.mkdirSync(config.snapshotsDir, { recursive: true });
  }

  const snapshotFile = path.join(config.snapshotsDir, `${post.noteId}.html`);

  // 将本地图片转为 base64 内联
  const imagesHtml = (post.images || []).map((img, i) => {
    let src = '';
    if (img.localPath) {
      const absPath = path.join(config.dataDir, img.localPath);
      if (fs.existsSync(absPath)) {
        const buf = fs.readFileSync(absPath);
        const ext = path.extname(absPath).replace('.', '') || 'jpeg';
        const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        src = `data:${mime};base64,${buf.toString('base64')}`;
      }
    }
    if (!src) src = img.url || '';
    return `<img src="${escapeHtml(src)}" alt="图片 ${i + 1}" style="max-width:100%;border-radius:8px;margin-bottom:8px;">`;
  }).join('\n');

  let videoHtml = '';
  if (post.video) {
    let videoSrc = '';
    if (post.video.localPath) {
      const absPath = path.join(config.dataDir, post.video.localPath);
      if (fs.existsSync(absPath)) {
        const buf = fs.readFileSync(absPath);
        videoSrc = `data:video/mp4;base64,${buf.toString('base64')}`;
      }
    }
    if (!videoSrc) videoSrc = post.video.url || '';
    if (videoSrc) {
      videoHtml = `<video controls style="max-width:100%;border-radius:8px;margin-bottom:16px;" src="${escapeHtml(videoSrc)}"></video>`;
    }
  }

  const commentsHtml = (post.commentList || []).map(c => {
    const subHtml = (c.subComments || []).map(sc => `
      <div style="margin-left:24px;padding:8px 0;border-top:1px solid #f0f0f0;">
        <b>${escapeHtml(sc.author)}</b>
        <span style="color:#999;font-size:12px;margin-left:8px;">${sc.createTime ? new Date(sc.createTime).toLocaleString('zh-CN') : ''}</span>
        <div style="margin-top:4px;">${escapeHtml(sc.content)}</div>
      </div>
    `).join('');

    return `
      <div style="padding:12px 0;border-bottom:1px solid #eee;">
        <b>${escapeHtml(c.author)}</b>
        <span style="color:#999;font-size:12px;margin-left:8px;">${c.createTime ? new Date(c.createTime).toLocaleString('zh-CN') : ''}</span>
        <span style="color:#999;font-size:12px;margin-left:8px;">${c.likes ? c.likes + ' 赞' : ''}</span>
        <div style="margin-top:4px;line-height:1.6;">${escapeHtml(c.content)}</div>
        ${subHtml}
      </div>
    `;
  }).join('');

  const tagsHtml = (post.tags || []).map(t =>
    `<span style="display:inline-block;padding:2px 10px;background:#fff0f1;color:#ff2442;border-radius:10px;font-size:12px;margin-right:6px;">#${escapeHtml(t)}</span>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(post.title)} - 小红书归档</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; background:#f5f5f5; color:#333; }
  .container { max-width:680px; margin:0 auto; padding:24px; }
  .header { background:#fff; border-radius:16px; padding:24px; margin-bottom:16px; box-shadow:0 2px 12px rgba(0,0,0,0.06); }
  .title { font-size:22px; font-weight:700; margin-bottom:12px; line-height:1.4; }
  .meta { display:flex; align-items:center; gap:12px; color:#999; font-size:14px; margin-bottom:16px; }
  .content-text { font-size:15px; line-height:1.8; white-space:pre-wrap; margin-bottom:16px; }
  .images { background:#fff; border-radius:16px; padding:16px; margin-bottom:16px; box-shadow:0 2px 12px rgba(0,0,0,0.06); }
  .stats { display:flex; gap:16px; font-size:14px; color:#999; margin-bottom:12px; }
  .tags { margin-bottom:16px; }
  .comments-section { background:#fff; border-radius:16px; padding:24px; box-shadow:0 2px 12px rgba(0,0,0,0.06); }
  .comments-title { font-size:16px; font-weight:600; margin-bottom:12px; }
  .archive-info { text-align:center; color:#ccc; font-size:12px; margin-top:24px; padding:16px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="title">${escapeHtml(post.title)}</div>
    <div class="meta">
      <span>${escapeHtml(post.author || '未知')}</span>
      ${post.publishTime ? `<span>${escapeHtml(post.publishTime)}</span>` : ''}
    </div>
    <div class="content-text">${escapeHtml(post.content || '')}</div>
    <div class="stats">
      <span>&#10084; ${post.likes || 0} 点赞</span>
      <span>&#9733; ${post.collects || 0} 收藏</span>
      <span>&#128172; ${post.comments || 0} 评论</span>
    </div>
    ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
  </div>

  ${(imagesHtml || videoHtml) ? `<div class="images">${videoHtml}${imagesHtml}</div>` : ''}

  ${commentsHtml ? `
  <div class="comments-section">
    <div class="comments-title">评论 (${(post.commentList || []).length})</div>
    ${commentsHtml}
  </div>
  ` : ''}

  <div class="archive-info">
    归档于 ${post.archivedAt ? new Date(post.archivedAt).toLocaleString('zh-CN') : new Date().toLocaleString('zh-CN')}<br>
    原始链接: ${escapeHtml(post.url || '')}
  </div>
</div>
</body>
</html>`;

  fs.writeFileSync(snapshotFile, html, 'utf-8');
  return `snapshots/${post.noteId}.html`;
}

/**
 * 手动创建帖子
 */
function createManualPost({ noteId, url, title, content, author, tags, images }) {
  return {
    noteId: noteId || `manual_${Date.now()}`,
    url: url || '',
    title: title || '手动保存',
    content: content || '',
    author: author || '',
    images: images || [],
    tags: tags || [],
    likes: 0,
    collects: 0,
    comments: 0,
    commentList: [],
    type: 'manual',
    archived: false,
  };
}

function safeExt(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    return ext && ext.length <= 5 ? ext : '.jpg';
  } catch {
    return '.jpg';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
  extractNoteId,
  resolveShortUrl,
  archivePost,
  fetchPost,
  fetchComments,
  downloadImages,
  generateSnapshot,
  createManualPost,
};
