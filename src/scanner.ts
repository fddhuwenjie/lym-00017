import * as fs from 'fs';
import * as path from 'path';
import { FileInfo, ScanResult, ScanStats } from './types';
import { IgnoreRules, defaultIgnorePatterns } from './ignore-rules';

export interface ScannerOptions {
  minSize?: number;
  maxSize?: number;
  extensions?: string[];
  followSymlinks?: boolean;
  ignoreFile?: string;
  useGitignore?: boolean;
  additionalIgnorePatterns?: string[];
}

export class DirectoryScanner {
  private rootDir: string;
  private options: ScannerOptions;
  private ignoreRules: IgnoreRules;

  constructor(rootDir: string, options: ScannerOptions = {}) {
    this.rootDir = path.resolve(rootDir);
    this.options = options;

    if (!fs.existsSync(this.rootDir)) {
      throw new Error(`Directory does not exist: ${this.rootDir}`);
    }

    if (!fs.statSync(this.rootDir).isDirectory()) {
      throw new Error(`Path is not a directory: ${this.rootDir}`);
    }

    this.ignoreRules = this.buildIgnoreRules();
  }

  private buildIgnoreRules(): IgnoreRules {
    let rules: IgnoreRules;

    if (this.options.ignoreFile) {
      rules = IgnoreRules.fromFile(this.rootDir, this.options.ignoreFile);
    } else if (this.options.useGitignore) {
      rules = IgnoreRules.fromGitignore(this.rootDir);
    } else {
      rules = new IgnoreRules(this.rootDir, defaultIgnorePatterns());
    }

    if (this.options.additionalIgnorePatterns?.length) {
      rules.add(this.options.additionalIgnorePatterns);
    }

    return rules;
  }

  async *scan(async?: boolean): AsyncGenerator<FileInfo> {
    const startTime = Date.now();

    for await (const fileInfo of this.walk(this.rootDir, 0)) {
      yield fileInfo;
    }
  }

  private async *walk(dir: string, depth: number): AsyncGenerator<FileInfo> {
    if (this.ignoreRules.ignores(dir)) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`Warning: Cannot read directory ${dir}: ${(err as Error).message}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (this.ignoreRules.ignores(fullPath)) {
        continue;
      }

      try {
        if (entry.isDirectory()) {
          yield* this.walk(fullPath, depth + 1);
        } else if (entry.isFile() || (this.options.followSymlinks && entry.isSymbolicLink())) {
          const fileInfo = await this.getFileInfo(fullPath, depth);
          if (fileInfo && this.passesFilter(fileInfo)) {
            yield fileInfo;
          }
        }
      } catch (err) {
        console.warn(`Warning: Cannot access ${fullPath}: ${(err as Error).message}`);
      }
    }
  }

  private async getFileInfo(filePath: string, depth: number): Promise<FileInfo | null> {
    try {
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) {
        return null;
      }

      const ext = path.extname(filePath).toLowerCase() || '(no extension)';
      const name = path.basename(filePath);

      return {
        path: filePath,
        name,
        size: stats.size,
        extension: ext,
        mtime: stats.mtime,
        atime: stats.atime,
        ctime: stats.ctime,
        depth,
      };
    } catch {
      return null;
    }
  }

  private passesFilter(fileInfo: FileInfo): boolean {
    const { minSize, maxSize, extensions } = this.options;

    if (minSize !== undefined && fileInfo.size < minSize) {
      return false;
    }

    if (maxSize !== undefined && fileInfo.size > maxSize) {
      return false;
    }

    if (extensions?.length) {
      const normalizedExts = extensions.map(e => e.toLowerCase().startsWith('.') ? e.toLowerCase() : '.' + e.toLowerCase());
      if (!normalizedExts.includes(fileInfo.extension)) {
        return false;
      }
    }

    return true;
  }

  async collectAll(): Promise<ScanResult> {
    const startTime = Date.now();
    const files: FileInfo[] = [];
    let ignoredCount = 0;

    const extensionStats: Record<string, { count: number; size: number }> = {};
    let totalSize = 0;

    for await (const fileInfo of this.walk(this.rootDir, 0)) {
      files.push(fileInfo);
      totalSize += fileInfo.size;

      if (!extensionStats[fileInfo.extension]) {
        extensionStats[fileInfo.extension] = { count: 0, size: 0 };
      }
      extensionStats[fileInfo.extension].count++;
      extensionStats[fileInfo.extension].size += fileInfo.size;
    }

    const stats: ScanStats = {
      totalFiles: files.length,
      totalSize,
      extensionStats,
      scanTime: Date.now() - startTime,
      rootDir: this.rootDir,
    };

    return { files, stats, ignoredCount };
  }

  getRootDir(): string {
    return this.rootDir;
  }

  getIgnoreRules(): IgnoreRules {
    return this.ignoreRules;
  }
}

export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function groupFilesBySize(files: FileInfo[]): Map<number, FileInfo[]> {
  const sizeGroups = new Map<number, FileInfo[]>();
  for (const file of files) {
    if (!sizeGroups.has(file.size)) {
      sizeGroups.set(file.size, []);
    }
    sizeGroups.get(file.size)!.push(file);
  }
  return sizeGroups;
}
