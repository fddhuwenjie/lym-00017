export interface FileInfo {
  path: string;
  name: string;
  size: number;
  extension: string;
  mtime: Date;
  atime: Date;
  ctime: Date;
  depth: number;
}

export interface ScanStats {
  totalFiles: number;
  totalSize: number;
  extensionStats: Record<string, { count: number; size: number }>;
  scanTime: number;
  rootDir: string;
}

export interface ScanResult {
  files: FileInfo[];
  stats: ScanStats;
  ignoredCount: number;
}

export interface HashResult {
  path: string;
  hash: string;
  size: number;
}

export interface ExactDuplicateGroup {
  hash: string;
  size: number;
  files: FileInfo[];
  wastedSpace: number;
}

export interface ExactDuplicateResult {
  groups: ExactDuplicateGroup[];
  totalDuplicateFiles: number;
  totalWastedSpace: number;
  hashTime: number;
}

export interface TextSimilarityResult {
  file1: string;
  file2: string;
  similarity: number;
  algorithm: 'leven' | 'jaccard' | 'combined';
}

export interface ImageSimilarityResult {
  file1: string;
  file2: string;
  similarity: number;
  algorithm: 'phash' | 'dhash';
}

export interface NearDuplicateGroup {
  id: string;
  type: 'text' | 'image';
  files: { path: string; similarity: number }[];
  avgSimilarity: number;
}

export interface NearDuplicateResult {
  textGroups: NearDuplicateGroup[];
  imageGroups: NearDuplicateGroup[];
  totalTextPairs: number;
  totalImagePairs: number;
  similarityTime: number;
}

export interface KeepRule {
  type: 'mtime' | 'depth' | 'name' | 'path';
  value: string | number;
  description: string;
}

export interface CleanupPlan {
  keepFile: FileInfo;
  deleteFiles: FileInfo[];
  keepRule: KeepRule;
  recoverableSpace: number;
}

export interface CleanupResult {
  deletedCount: number;
  recoveredSpace: number;
  errors: { path: string; error: string }[];
}

export interface ReportData {
  scan: ScanResult;
  exactDuplicates?: ExactDuplicateResult;
  nearDuplicates?: NearDuplicateResult;
  cleanup?: CleanupResult;
  generatedAt: string;
  options: Record<string, unknown>;
}

export type ReportFormat = 'json' | 'markdown' | 'html';

export interface CLIOptions {
  dir: string;
  ignoreFile?: string;
  exact?: boolean;
  near?: boolean;
  cleanup?: boolean;
  report?: ReportFormat;
  output?: string;
  minSize?: number;
  maxSize?: number;
  extensions?: string;
  threshold?: string | number;
  similarityThreshold?: number;
  autoKeepRule?: 'mtime_newest' | 'mtime_oldest' | 'depth_shallowest' | 'path_shortest' | 'name_pattern';
  dryRun?: boolean;
  gitignore?: boolean;
  nonInteractive?: boolean;
  concurrency?: number;
}
