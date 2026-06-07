export interface FileInfo {
  path: string;
  name: string;
  size: number;
  extension: string;
  mtime: Date;
  atime: Date;
  ctime: Date;
  depth: number;
  sourceRoot?: string;
  contentHash?: string;
  approximateFingerprint?: string;
  mediaType?: 'video' | 'audio' | 'image' | 'text' | 'other';
  mediaFingerprint?: string;
}

export interface IndexEntry {
  path: string;
  size: number;
  mtime: number;
  contentHash: string;
  approximateFingerprint?: string;
  mediaFingerprint?: string;
  indexedAt: number;
}

export interface IndexStats {
  totalEntries: number;
  lastUpdatedAt: number;
  createdAt: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  rootDirs: string[];
}

export interface FileIndex {
  version: number;
  createdAt: number;
  lastUpdatedAt: number;
  rootDirs: string[];
  entries: Record<string, IndexEntry>;
  stats: {
    hitCount: number;
    missCount: number;
  };
}

export type MediaType = 'video' | 'audio' | 'image' | 'text' | 'other';

export interface MediaSimilarityResult {
  file1: string;
  file2: string;
  similarity: number;
  algorithm: 'video-dhash' | 'audio-energy' | 'combined';
  mediaType: 'video' | 'audio';
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
  indexStats?: IndexStats;
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
  isCrossDirectory: boolean;
}

export interface ExactDuplicateResult {
  groups: ExactDuplicateGroup[];
  totalDuplicateFiles: number;
  totalWastedSpace: number;
  crossDirectoryWastedSpace: number;
  intraDirectoryWastedSpace: number;
  hashTime: number;
  indexStats?: IndexStats;
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
  algorithm: 'phash' | 'dhash' | 'combined';
}

export interface NearDuplicateGroup {
  id: string;
  type: 'text' | 'image' | 'video' | 'audio';
  files: { path: string; similarity: number; sourceRoot?: string }[];
  avgSimilarity: number;
}

export interface NearDuplicateResult {
  textGroups: NearDuplicateGroup[];
  imageGroups: NearDuplicateGroup[];
  videoGroups: NearDuplicateGroup[];
  audioGroups: NearDuplicateGroup[];
  totalTextPairs: number;
  totalImagePairs: number;
  totalVideoPairs: number;
  totalAudioPairs: number;
  similarityTime: number;
}

export interface KeepRule {
  type: 'mtime' | 'depth' | 'name' | 'path' | 'prefer_dir';
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
  autoKeepRule?: 'mtime_newest' | 'mtime_oldest' | 'depth_shallowest' | 'path_shortest' | 'name_pattern' | 'prefer_dir';
  dryRun?: boolean;
  gitignore?: boolean;
  nonInteractive?: boolean;
  concurrency?: number;
  rebuildIndex?: boolean;
  showIndexStats?: boolean;
  preferDir?: string;
  dirs?: string[];
}
