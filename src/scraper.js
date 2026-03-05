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
  // 尝试从URL末尾提取ID
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
 * 抓取小红书帖子内容
 */
async function fetchPost(url) {
  await loadDeps();

  // 解析短链接
  const resolvedUrl = await resolveShortUrl(url);
  const noteId = extractNoteId(resolvedUrl);

  if (!noteId) {
    throw new Error(`无法从URL中提取笔记ID: ${url}`);
  }

  const pageUrl = `https://www.xiaohongshu.com/explore/${noteId}`;
  const resp = await fetch(pageUrl, { headers: config.headers });

  if (!resp.ok) {
    throw new Error(`请求失败 (HTTP ${resp.status}): ${pageUrl}`);
  }

  const html = await resp.text();
  return parsePostHtml(html, noteId, pageUrl);
}

/**
 * 解析帖子HTML提取结构化数据
 */
function parsePostHtml(html, noteId, url) {
  const $ = cheerio.load(html);

  // 尝试从 SSR 数据中提取
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

  // 回退：从DOM提取
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
    type: 'normal',
  };
}

/**
 * 格式化从SSR数据中提取的帖子数据
 */
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
    type: data.type || 'normal',
    publishTime: data.time || '',
  };
}

/**
 * 从DOM中提取图片
 */
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

/**
 * 从DOM中提取标签
 */
function extractTags($) {
  const tags = [];
  $('.tag, .hashtag, a[href*="hashtag"]').each((_, el) => {
    const text = $(el).text().trim().replace(/^#/, '');
    if (text) tags.push(text);
  });
  return tags;
}

/**
 * 下载图片到本地
 */
async function downloadImages(post) {
  await loadDeps();
  const downloaded = [];
  const postDir = path.join(config.imagesDir, post.noteId);

  if (!fs.existsSync(postDir)) {
    fs.mkdirSync(postDir, { recursive: true });
  }

  for (let i = 0; i < (post.images || []).length; i++) {
    const img = post.images[i];
    if (!img.url) continue;

    const ext = path.extname(new URL(img.url).pathname) || '.jpg';
    const filename = `${i + 1}${ext}`;
    const filepath = path.join(postDir, filename);

    try {
      const resp = await fetch(img.url, { headers: config.headers });
      if (resp.ok) {
        const buffer = await resp.buffer();
        fs.writeFileSync(filepath, buffer);
        downloaded.push({ ...img, localPath: filepath, filename });
      }
    } catch (e) {
      console.error(`下载图片失败: ${img.url} - ${e.message}`);
    }
  }

  return downloaded;
}

/**
 * 手动创建帖子（当无法自动抓取时）
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
    type: 'manual',
  };
}

module.exports = {
  extractNoteId,
  resolveShortUrl,
  fetchPost,
  downloadImages,
  createManualPost,
};
