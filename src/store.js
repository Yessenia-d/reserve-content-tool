const fs = require('fs');
const config = require('./config');

class PostStore {
  constructor() {
    this._ensureDataDir();
    this.posts = this._load();
  }

  _ensureDataDir() {
    for (const dir of [config.dataDir, config.imagesDir, config.snapshotsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  _load() {
    if (fs.existsSync(config.dbFile)) {
      const data = fs.readFileSync(config.dbFile, 'utf-8');
      return JSON.parse(data);
    }
    return [];
  }

  _save() {
    fs.writeFileSync(config.dbFile, JSON.stringify(this.posts, null, 2), 'utf-8');
  }

  add(post) {
    const existing = this.posts.find(p => p.noteId === post.noteId);
    if (existing) {
      Object.assign(existing, post, { updatedAt: new Date().toISOString() });
    } else {
      post.savedAt = new Date().toISOString();
      this.posts.push(post);
    }
    this._save();
    return post;
  }

  getAll() {
    return [...this.posts].reverse();
  }

  getById(noteId) {
    return this.posts.find(p => p.noteId === noteId);
  }

  remove(noteId) {
    const idx = this.posts.findIndex(p => p.noteId === noteId);
    if (idx === -1) return false;
    this.posts.splice(idx, 1);
    this._save();
    return true;
  }

  search(keyword) {
    const kw = keyword.toLowerCase();
    return this.posts.filter(p =>
      (p.title && p.title.toLowerCase().includes(kw)) ||
      (p.content && p.content.toLowerCase().includes(kw)) ||
      (p.author && p.author.toLowerCase().includes(kw)) ||
      (p.tags && p.tags.some(t => t.toLowerCase().includes(kw)))
    );
  }

  count() {
    return this.posts.length;
  }
}

module.exports = new PostStore();
