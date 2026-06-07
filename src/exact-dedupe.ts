import * as fs from 'fs';
import * as crypto from 'crypto';
import { FileInfo, ExactDuplicateGroup, ExactDuplicateResult, HashResult } from './types';
import { groupFilesBySize } from './scanner';

export interface HashOptions {
  algorithm?: 'md5' | 'sha1' | 'sha256';
  chunkSize?: number;
  quickHash?: boolean;
  quickHashBytes?: number;
  concurrency?: number;
}

export class ExactDeduplicator {
  private options: Required<HashOptions>;

  constructor(options: HashOptions = {}) {
    this.options = {
      algorithm: options.algorithm || 'sha256',
      chunkSize: options.chunkSize || 64 * 1024 * 1024,
      quickHash: options.quickHash ?? true,
      quickHashBytes: options.quickHashBytes || 4096,
      concurrency: options.concurrency || 4,
    };
  }

  async hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath, { highWaterMark: this.options.chunkSize });

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

  async quickHashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      let bytesRead = 0;
      const stream = fs.createReadStream(filePath, { highWaterMark: 4096 });

      stream.on('data', (chunk: string | Buffer) => {
        if (typeof chunk === 'string') chunk = Buffer.from(chunk);
        const remaining = this.options.quickHashBytes - bytesRead;
        if (remaining > 0) {
          const toRead = Math.min(chunk.length, remaining);
          hash.update(chunk.slice(0, toRead));
          bytesRead += toRead;
        }
        if (bytesRead >= this.options.quickHashBytes) {
          stream.destroy();
        }
      });

      stream.on('close', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }

  async hashFiles(files: FileInfo[]): Promise<HashResult[]> {
    const results: HashResult[] = [];
    const queue = [...files];
    const concurrency = Math.min(this.options.concurrency, files.length);

    const worker = async () => {
      while (queue.length > 0) {
        const file = queue.shift()!;
        try {
          const hash = await this.hashFile(file.path);
          results.push({
            path: file.path,
            hash,
            size: file.size,
          });
        } catch (err) {
          console.warn(`Warning: Could not hash ${file.path}: ${(err as Error).message}`);
        }
      }
    };

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    return results;
  }

  async findDuplicates(files: FileInfo[]): Promise<ExactDuplicateResult> {
    const startTime = Date.now();

    const sizeGroups = groupFilesBySize(files);
    const candidates: FileInfo[] = [];

    for (const [, groupFiles] of sizeGroups) {
      if (groupFiles.length >= 2) {
        candidates.push(...groupFiles);
      }
    }

    if (candidates.length === 0) {
      return {
        groups: [],
        totalDuplicateFiles: 0,
        totalWastedSpace: 0,
        hashTime: Date.now() - startTime,
      };
    }

    const hashResults = await this.hashFiles(candidates);
    const hashGroups = new Map<string, FileInfo[]>();
    const pathToFileInfo = new Map(files.map(f => [f.path, f]));

    for (const result of hashResults) {
      if (!hashGroups.has(result.hash)) {
        hashGroups.set(result.hash, []);
      }
      const fileInfo = pathToFileInfo.get(result.path);
      if (fileInfo) {
        hashGroups.get(result.hash)!.push(fileInfo);
      }
    }

    const groups: ExactDuplicateGroup[] = [];
    let totalDuplicateFiles = 0;
    let totalWastedSpace = 0;

    for (const [hash, groupFiles] of hashGroups) {
      if (groupFiles.length >= 2) {
        const size = groupFiles[0].size;
        const wastedSpace = size * (groupFiles.length - 1);

        groups.push({
          hash,
          size,
          files: groupFiles.sort((a, b) => a.mtime.getTime() - b.mtime.getTime()),
          wastedSpace,
        });

        totalDuplicateFiles += groupFiles.length;
        totalWastedSpace += wastedSpace;
      }
    }

    groups.sort((a, b) => b.wastedSpace - a.wastedSpace);

    return {
      groups,
      totalDuplicateFiles,
      totalWastedSpace,
      hashTime: Date.now() - startTime,
    };
  }

  async findDuplicatesStreaming(
    fileIterator: AsyncGenerator<FileInfo>,
    onProgress?: (count: number, sizeGroups: number) => void
  ): Promise<ExactDuplicateResult> {
    const startTime = Date.now();

    const sizeGroups = new Map<number, FileInfo[]>();
    let processedCount = 0;

    for await (const file of fileIterator) {
      if (!sizeGroups.has(file.size)) {
        sizeGroups.set(file.size, []);
      }
      sizeGroups.get(file.size)!.push(file);
      processedCount++;

      if (onProgress && processedCount % 1000 === 0) {
        const candidateGroups = Array.from(sizeGroups.values()).filter(g => g.length >= 2).length;
        onProgress(processedCount, candidateGroups);
      }
    }

    const candidates: FileInfo[] = [];
    for (const [, groupFiles] of sizeGroups) {
      if (groupFiles.length >= 2) {
        candidates.push(...groupFiles);
      }
    }

    if (onProgress) {
      onProgress(processedCount, Array.from(sizeGroups.values()).filter(g => g.length >= 2).length);
    }

    if (candidates.length === 0) {
      return {
        groups: [],
        totalDuplicateFiles: 0,
        totalWastedSpace: 0,
        hashTime: Date.now() - startTime,
      };
    }

    return this.findDuplicates(candidates);
  }
}
