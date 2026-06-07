import * as fs from 'fs';
import * as path from 'path';
import leven from 'leven';
import Jimp from 'jimp';
import { FileInfo, NearDuplicateResult, NearDuplicateGroup, TextSimilarityResult, ImageSimilarityResult } from './types';

export interface NearDuplicateOptions {
  similarityThreshold?: number;
  textExtensions?: string[];
  imageExtensions?: string[];
  maxTextSize?: number;
  maxImageDimension?: number;
  blockSize?: number;
  concurrency?: number;
}

const DEFAULT_TEXT_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.log', '.csv', '.json', '.xml', '.yaml', '.yml',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.html', '.css',
  '.scss', '.less', '.sql', '.sh', '.bash', '.zsh', '.fish', '.bat', '.cmd',
  '.ini', '.conf', '.config', '.toml', '.env',
];

const DEFAULT_IMAGE_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp',
];

export class NearDuplicateDetector {
  private options: Required<NearDuplicateOptions>;

  constructor(options: NearDuplicateOptions = {}) {
    this.options = {
      similarityThreshold: options.similarityThreshold ?? 0.85,
      textExtensions: options.textExtensions || DEFAULT_TEXT_EXTENSIONS,
      imageExtensions: options.imageExtensions || DEFAULT_IMAGE_EXTENSIONS,
      maxTextSize: options.maxTextSize || 10 * 1024 * 1024,
      maxImageDimension: options.maxImageDimension || 2048,
      blockSize: options.blockSize || 100,
      concurrency: options.concurrency || 2,
    };
  }

  isTextFile(file: FileInfo): boolean {
    return this.options.textExtensions.includes(file.extension.toLowerCase());
  }

  isImageFile(file: FileInfo): boolean {
    return this.options.imageExtensions.includes(file.extension.toLowerCase());
  }

  async readTextFile(filePath: string): Promise<string> {
    const content = await fs.promises.readFile(filePath, { encoding: 'utf8', flag: 'r' });
    return content.replace(/\s+/g, ' ').trim();
  }

  async computeTextSimilarity(file1: string, file2: string): Promise<TextSimilarityResult> {
    const [text1, text2] = await Promise.all([
      this.readTextFile(file1),
      this.readTextFile(file2),
    ]);

    const maxLen = Math.max(text1.length, text2.length);
    if (maxLen === 0) {
      return { file1, file2, similarity: 1.0, algorithm: 'combined' };
    }

    const editDistance = leven(text1, text2);
    const levenSimilarity = 1 - editDistance / maxLen;

    const jaccardSimilarity = this.computeJaccardSimilarity(text1, text2);

    const combined = (levenSimilarity * 0.6 + jaccardSimilarity * 0.4);

    return {
      file1,
      file2,
      similarity: Math.max(0, Math.min(1, combined)),
      algorithm: 'combined',
    };
  }

  private computeJaccardSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.split(/\W+/).filter(w => w.length > 0));
    const words2 = new Set(text2.split(/\W+/).filter(w => w.length > 0));

    if (words1.size === 0 && words2.size === 0) return 1.0;
    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  async computeImagePHash(imagePath: string): Promise<string> {
    const image = await Jimp.read(imagePath);
    image.resize(8, 8).grayscale();

    const pixels: number[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const color = Jimp.intToRGBA(image.getPixelColor(x, y));
        pixels.push(color.r);
      }
    }

    const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    const bits = pixels.map(p => (p >= avg ? '1' : '0'));
    return bits.join('');
  }

  async computeImageDHash(imagePath: string): Promise<string> {
    const image = await Jimp.read(imagePath);
    image.resize(9, 8).grayscale();

    const bits: string[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = Jimp.intToRGBA(image.getPixelColor(x, y)).r;
        const right = Jimp.intToRGBA(image.getPixelColor(x + 1, y)).r;
        bits.push(left < right ? '1' : '0');
      }
    }
    return bits.join('');
  }

  private hammingDistance(hash1: string, hash2: string): number {
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) distance++;
    }
    return distance;
  }

  async computeImageSimilarity(file1: string, file2: string): Promise<ImageSimilarityResult> {
    const [hash1, hash2] = await Promise.all([
      this.computeImageDHash(file1),
      this.computeImageDHash(file2),
    ]);

    const distance = this.hammingDistance(hash1, hash2);
    const similarity = 1 - distance / 64;

    return {
      file1,
      file2,
      similarity: Math.max(0, Math.min(1, similarity)),
      algorithm: 'dhash',
    };
  }

  async findNearDuplicates(files: FileInfo[]): Promise<NearDuplicateResult> {
    const startTime = Date.now();

    const textFiles = files.filter(f => this.isTextFile(f) && f.size <= this.options.maxTextSize);
    const imageFiles = files.filter(f => this.isImageFile(f));

    const [textGroups, imageGroups] = await Promise.all([
      this.findTextNearDuplicates(textFiles),
      this.findImageNearDuplicates(imageFiles),
    ]);

    const totalTextPairs = textGroups.reduce((sum, g) => sum + g.files.length, 0);
    const totalImagePairs = imageGroups.reduce((sum, g) => sum + g.files.length, 0);

    return {
      textGroups,
      imageGroups,
      totalTextPairs,
      totalImagePairs,
      similarityTime: Date.now() - startTime,
    };
  }

  private async findTextNearDuplicates(files: FileInfo[]): Promise<NearDuplicateGroup[]> {
    const sizeGroups = this.groupBySizeRange(files, 0.2);
    const similarityPairs: TextSimilarityResult[] = [];

    for (const group of sizeGroups) {
      if (group.length < 2) continue;

      const extGroups = this.groupByExtension(group);
      for (const extGroup of extGroups) {
        if (extGroup.length < 2) continue;

        for (let i = 0; i < extGroup.length - 1; i++) {
          for (let j = i + 1; j < extGroup.length; j++) {
            try {
              const result = await this.computeTextSimilarity(extGroup[i].path, extGroup[j].path);
              if (result.similarity >= this.options.similarityThreshold) {
                similarityPairs.push(result);
              }
            } catch {
              continue;
            }
          }
        }
      }
    }

    return this.clusterSimilarityPairs(similarityPairs, 'text');
  }

  private async findImageNearDuplicates(files: FileInfo[]): Promise<NearDuplicateGroup[]> {
    const similarityPairs: ImageSimilarityResult[] = [];

    const extGroups = this.groupByExtension(files);
    for (const extGroup of extGroups) {
      if (extGroup.length < 2) continue;

      for (let i = 0; i < extGroup.length - 1; i++) {
        for (let j = i + 1; j < extGroup.length; j++) {
          try {
            const result = await this.computeImageSimilarity(extGroup[i].path, extGroup[j].path);
            if (result.similarity >= this.options.similarityThreshold) {
              similarityPairs.push(result);
            }
          } catch {
            continue;
          }
        }
      }
    }

    return this.clusterSimilarityPairs(similarityPairs, 'image');
  }

  private groupBySizeRange(files: FileInfo[], tolerance: number): FileInfo[][] {
    const sorted = [...files].sort((a, b) => a.size - b.size);
    const groups: FileInfo[][] = [];
    let currentGroup: FileInfo[] = [];

    for (const file of sorted) {
      if (currentGroup.length === 0) {
        currentGroup.push(file);
      } else {
        const minSize = currentGroup[0].size;
        const maxAllowed = minSize * (1 + tolerance);
        if (file.size <= maxAllowed) {
          currentGroup.push(file);
        } else {
          groups.push(currentGroup);
          currentGroup = [file];
        }
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  private groupByExtension(files: FileInfo[]): FileInfo[][] {
    const map = new Map<string, FileInfo[]>();
    for (const file of files) {
      if (!map.has(file.extension)) {
        map.set(file.extension, []);
      }
      map.get(file.extension)!.push(file);
    }
    return Array.from(map.values());
  }

  private clusterSimilarityPairs(
    pairs: (TextSimilarityResult | ImageSimilarityResult)[],
    type: 'text' | 'image'
  ): NearDuplicateGroup[] {
    const adjacency = new Map<string, { path: string; similarity: number }[]>();

    for (const pair of pairs) {
      if (!adjacency.has(pair.file1)) {
        adjacency.set(pair.file1, []);
      }
      if (!adjacency.has(pair.file2)) {
        adjacency.set(pair.file2, []);
      }
      adjacency.get(pair.file1)!.push({ path: pair.file2, similarity: pair.similarity });
      adjacency.get(pair.file2)!.push({ path: pair.file1, similarity: pair.similarity });
    }

    const visited = new Set<string>();
    const groups: NearDuplicateGroup[] = [];
    let groupId = 0;

    for (const file of adjacency.keys()) {
      if (visited.has(file)) continue;

      const queue = [file];
      const cluster = new Map<string, number>();

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        const neighbors = adjacency.get(current) || [];
        for (const { path: neighbor, similarity } of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
          const existing = cluster.get(neighbor) || 0;
          if (similarity > existing) {
            cluster.set(neighbor, similarity);
          }
        }
        cluster.set(current, 1.0);
      }

      if (cluster.size >= 2) {
        const files = Array.from(cluster.entries())
          .map(([path, similarity]) => ({ path, similarity }))
          .sort((a, b) => b.similarity - a.similarity);

        const avgSimilarity = files.reduce((sum, f) => sum + f.similarity, 0) / files.length;

        groups.push({
          id: `${type}-${groupId++}`,
          type,
          files,
          avgSimilarity,
        });
      }
    }

    return groups.sort((a, b) => b.avgSimilarity - a.avgSimilarity);
  }
}
