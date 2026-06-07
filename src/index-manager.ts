import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { FileInfo, FileIndex, IndexEntry, IndexStats } from './types';

export interface IndexManagerOptions {
  indexPath?: string;
  concurrency?: number;
}

export class IndexManager {
  private indexPath: string;
  private concurrency: number;
  private index: FileIndex | null = null;
  private defaultIndexName = '.file-dedupe-index.jsonl';

  constructor(rootDir: string | string[], options: IndexManagerOptions = {}) {
    this.concurrency = options.concurrency || 4;
    
    if (options.indexPath) {
      this.indexPath = path.resolve(options.indexPath);
    } else {
      const firstDir = Array.isArray(rootDir) ? rootDir[0] : rootDir;
      this.indexPath = path.join(path.resolve(firstDir), this.defaultIndexName);
    }
  }

  private getDefaultIndexPath(rootDir: string): string {
    return path.join(path.resolve(rootDir), this.defaultIndexName);
  }

  async load(): Promise<FileIndex | null> {
    try {
      if (!fs.existsSync(this.indexPath)) {
        return null;
      }

      const content = await fs.promises.readFile(this.indexPath, 'utf8');
      const lines = content.trim().split('\n').filter(l => l.trim());
      
      if (lines.length === 0) {
        return null;
      }

      const header = JSON.parse(lines[0]);
      if (header.type !== 'file-dedupe-index-header') {
        throw new Error('Invalid index file format');
      }

      const entries: Record<string, IndexEntry> = {};
      for (let i = 1; i < lines.length; i++) {
        const entry = JSON.parse(lines[i]) as IndexEntry;
        entries[entry.path] = entry;
      }

      this.index = {
        version: header.version,
        createdAt: header.createdAt,
        lastUpdatedAt: header.lastUpdatedAt,
        rootDirs: header.rootDirs || [],
        entries,
        stats: header.stats || { hitCount: 0, missCount: 0 },
      };

      return this.index;
    } catch (err) {
      console.warn(`Warning: Could not load index from ${this.indexPath}: ${(err as Error).message}`);
      return null;
    }
  }

  async save(files: FileInfo[], rootDirs: string[]): Promise<void> {
    const now = Date.now();
    
    if (!this.index) {
      this.index = {
        version: 1,
        createdAt: now,
        lastUpdatedAt: now,
        rootDirs,
        entries: {},
        stats: { hitCount: 0, missCount: 0 },
      };
    }

    this.index.lastUpdatedAt = now;
    this.index.rootDirs = Array.from(new Set([...this.index.rootDirs, ...rootDirs]));

    for (const file of files) {
      if (file.contentHash) {
        this.index.entries[file.path] = {
          path: file.path,
          size: file.size,
          mtime: file.mtime.getTime(),
          contentHash: file.contentHash,
          approximateFingerprint: file.approximateFingerprint,
          mediaFingerprint: file.mediaFingerprint,
          indexedAt: now,
        };
      }
    }

    const headerLine = JSON.stringify({
      type: 'file-dedupe-index-header',
      version: this.index.version,
      createdAt: this.index.createdAt,
      lastUpdatedAt: this.index.lastUpdatedAt,
      rootDirs: this.index.rootDirs,
      stats: this.index.stats,
    });

    const entryLines = Object.values(this.index.entries)
      .map(entry => JSON.stringify(entry));

    const allLines = [headerLine, ...entryLines].join('\n') + '\n';

    const indexDir = path.dirname(this.indexPath);
    if (!fs.existsSync(indexDir)) {
      await fs.promises.mkdir(indexDir, { recursive: true });
    }

    await fs.promises.writeFile(this.indexPath, allLines, 'utf8');
  }

  async hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 * 1024 });

      stream.on('data', (chunk) => {
        hash.update(chunk);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }

  isFileChanged(file: FileInfo, entry: IndexEntry): boolean {
    return file.size !== entry.size || file.mtime.getTime() !== entry.mtime;
  }

  async processFilesIncremental(
    files: FileInfo[],
    rebuildIndex: boolean = false,
    onProgress?: (processed: number, total: number, hit: boolean) => void
  ): Promise<{ files: FileInfo[]; stats: IndexStats }> {
    if (!this.index) {
      await this.load();
    }

    if (rebuildIndex || !this.index) {
      this.index = null;
      return this.processFilesFull(files, onProgress);
    }

    const result: FileInfo[] = [];
    let hitCount = 0;
    let missCount = 0;

    const queue = [...files];
    const concurrency = Math.min(this.concurrency, files.length);

    const worker = async () => {
      while (queue.length > 0) {
        const file = queue.shift()!;
        const entry = this.index!.entries[file.path];

        if (entry && !this.isFileChanged(file, entry)) {
          file.contentHash = entry.contentHash;
          file.approximateFingerprint = entry.approximateFingerprint;
          file.mediaFingerprint = entry.mediaFingerprint;
          hitCount++;
          result.push(file);
          onProgress?.(result.length, files.length, true);
        } else {
          try {
            file.contentHash = await this.hashFile(file.path);
            missCount++;
            result.push(file);
            onProgress?.(result.length, files.length, false);
          } catch (err) {
            console.warn(`Warning: Could not hash ${file.path}: ${(err as Error).message}`);
          }
        }
      }
    };

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    this.index.stats.hitCount += hitCount;
    this.index.stats.missCount += missCount;

    const totalLookups = this.index.stats.hitCount + this.index.stats.missCount;
    const stats: IndexStats = {
      totalEntries: Object.keys(this.index.entries).length,
      lastUpdatedAt: this.index.lastUpdatedAt,
      createdAt: this.index.createdAt,
      hitCount: this.index.stats.hitCount,
      missCount: this.index.stats.missCount,
      hitRate: totalLookups > 0 ? this.index.stats.hitCount / totalLookups : 0,
      rootDirs: this.index.rootDirs,
    };

    return { files: result, stats };
  }

  async processFilesFull(
    files: FileInfo[],
    onProgress?: (processed: number, total: number, hit: boolean) => void
  ): Promise<{ files: FileInfo[]; stats: IndexStats }> {
    const result: FileInfo[] = [];
    const queue = [...files];
    const concurrency = Math.min(this.concurrency, files.length);
    let missCount = 0;

    const worker = async () => {
      while (queue.length > 0) {
        const file = queue.shift()!;
        try {
          file.contentHash = await this.hashFile(file.path);
          missCount++;
          result.push(file);
          onProgress?.(result.length, files.length, false);
        } catch (err) {
          console.warn(`Warning: Could not hash ${file.path}: ${(err as Error).message}`);
        }
      }
    };

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    const now = Date.now();
    const stats: IndexStats = {
      totalEntries: result.length,
      lastUpdatedAt: now,
      createdAt: now,
      hitCount: 0,
      missCount,
      hitRate: 0,
      rootDirs: [],
    };

    return { files: result, stats };
  }

  getStats(): IndexStats | null {
    if (!this.index) {
      return null;
    }

    const totalLookups = this.index.stats.hitCount + this.index.stats.missCount;
    return {
      totalEntries: Object.keys(this.index.entries).length,
      lastUpdatedAt: this.index.lastUpdatedAt,
      createdAt: this.index.createdAt,
      hitCount: this.index.stats.hitCount,
      missCount: this.index.stats.missCount,
      hitRate: totalLookups > 0 ? this.index.stats.hitCount / totalLookups : 0,
      rootDirs: this.index.rootDirs,
    };
  }

  async printStats(): Promise<void> {
    const stats = this.getStats();
    if (!stats) {
      console.log('📊 索引文件不存在或为空。');
      return;
    }

    console.log('\n📊 索引统计信息');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`📁 索引路径: ${this.indexPath}`);
    console.log(`📋 记录文件数: ${stats.totalEntries.toLocaleString()}`);
    console.log(`📅 创建时间: ${new Date(stats.createdAt).toLocaleString()}`);
    console.log(`🕐 最后更新: ${new Date(stats.lastUpdatedAt).toLocaleString()}`);
    console.log(`🎯 缓存命中: ${stats.hitCount.toLocaleString()}`);
    console.log(`❌ 缓存未命中: ${stats.missCount.toLocaleString()}`);
    console.log(`📈 命中率: ${(stats.hitRate * 100).toFixed(2)}%`);
    console.log(`📂 关联根目录: ${stats.rootDirs.length > 0 ? stats.rootDirs.join(', ') : '无'}`);
    console.log('══════════════════════════════════════════════════════════════\n');
  }

  getIndexPath(): string {
    return this.indexPath;
  }

  async deleteIndex(): Promise<void> {
    if (fs.existsSync(this.indexPath)) {
      await fs.promises.unlink(this.indexPath);
      this.index = null;
    }
  }
}

export function formatIndexStats(stats: IndexStats): string {
  const lines: string[] = [];
  lines.push(`📋 索引记录: ${stats.totalEntries.toLocaleString()} 个文件`);
  lines.push(`🕐 最后更新: ${new Date(stats.lastUpdatedAt).toLocaleString()}`);
  lines.push(`🎯 命中率: ${(stats.hitRate * 100).toFixed(2)}% (${stats.hitCount}/${stats.hitCount + stats.missCount})`);
  return lines.join(' | ');
}
