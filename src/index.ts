#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';

import { DirectoryScanner, formatBytes } from './scanner';
import { ExactDeduplicator } from './exact-dedupe';
import { NearDuplicateDetector } from './near-dedupe';
import { FileCleaner, AutoKeepRule } from './cleanup';
import { ReportExporter, generateDefaultReportName } from './report';
import { IndexManager } from './index-manager';
import { ReportData, ReportFormat, CLIOptions, FileInfo, ScanResult } from './types';

const program = new Command();

program
  .name('file-dedupe')
  .description('文件相似度检测与去重 CLI 工具')
  .version('2.0.0');

program
  .argument('<dirs...>', '要扫描的目录路径（多个目录用空格或逗号分隔）')
  .option('-i, --ignore-file <path>', '忽略规则文件路径 (.gitignore 格式)')
  .option('--no-gitignore', '不使用 .gitignore 规则')
  .option('-e, --exact', '执行精确去重检测', true)
  .option('-n, --near', '执行近似相似度检测')
  .option('-c, --cleanup', '交互式清理重复文件')
  .option('-r, --report <format>', '输出报告格式: json|markdown|html', 'json' as ReportFormat)
  .option('-o, --output <path>', '报告输出路径')
  .option('--min-size <bytes>', '最小文件大小 (字节)', parseInt)
  .option('--max-size <bytes>', '最大文件大小 (字节)', parseInt)
  .option('--extensions <list>', '只处理指定扩展名的文件 (逗号分隔)')
  .option('-t, --threshold <percent>', '近似相似度阈值 (0-100)', '85')
  .option('--keep-rule <rule>', '自动保留规则: mtime_newest|mtime_oldest|depth_shallowest|path_shortest|name_pattern|prefer_dir')
  .option('--prefer-dir <path>', '优先保留来自指定目录的副本（用于跨目录去重）')
  .option('--rebuild-index', '强制重建索引，忽略已有缓存')
  .option('--show-index-stats', '显示索引统计信息')
  .option('--dry-run', '预览删除操作但不实际删除')
  .option('--non-interactive', '非交互式模式，不提示确认')
  .option('--concurrency <num>', '并发处理数', parseInt, 4)
  .action(async (dirs: string[], options: CLIOptions & { gitignore?: boolean; nonInteractive?: boolean; concurrency?: number; rebuildIndex?: boolean; showIndexStats?: boolean; preferDir?: string }) => {
    try {
      await runDedupe(dirs, options);
    } catch (error) {
      console.error(chalk.red(`\n错误: ${(error as Error).message}`));
      process.exit(1);
    }
  });

function parseDirectories(dirs: string[]): string[] {
  const result: string[] = [];
  for (const dir of dirs) {
    const parts = dir.split(',').map(p => p.trim()).filter(p => p.length > 0);
    result.push(...parts);
  }
  return [...new Set(result)];
}

async function scanMultipleDirectories(
  directories: string[],
  options: CLIOptions & { gitignore?: boolean; nonInteractive?: boolean; concurrency?: number; rebuildIndex?: boolean; showIndexStats?: boolean; preferDir?: string }
): Promise<{ files: FileInfo[]; combinedStats: any; indexManager: IndexManager; indexStats?: any }> {
  const rootDirs = directories.map(d => path.resolve(d));
  
  console.log(chalk.blue(`扫描目录: ${chalk.white(rootDirs.join(', '))}`));
  console.log(chalk.gray(`开始时间: ${new Date().toLocaleString()}\n`));

  const scannerOptions = {
    minSize: options.minSize,
    maxSize: options.maxSize,
    extensions: options.extensions ? options.extensions.split(',') : undefined,
    ignoreFile: options.ignoreFile,
    useGitignore: options.gitignore !== false,
  };

  const indexManager = new IndexManager(rootDirs, {
    concurrency: options.concurrency,
  });

  if (options.showIndexStats) {
    await indexManager.load();
    await indexManager.printStats();
  }

  const allFiles: FileInfo[] = [];
  let totalFiles = 0;
  let totalSize = 0;
  const extensionStats: Record<string, { count: number; size: number }> = {};
  let totalScanTime = 0;
  let totalIgnoredCount = 0;

  let indexStats: any = null;

  for (let i = 0; i < rootDirs.length; i++) {
    const rootDir = rootDirs[i];
    console.log(chalk.yellow(`\n📋 [${i + 1}/${rootDirs.length}] 扫描目录: ${chalk.white(rootDir)}`));

    if (!fs.existsSync(rootDir)) {
      console.log(chalk.red(`   ⚠️  目录不存在，跳过: ${rootDir}`));
      continue;
    }

    const scanner = new DirectoryScanner(rootDir, scannerOptions);
    const scanResult = await scanner.collectAll();
    
    for (const file of scanResult.files) {
      file.sourceRoot = rootDir;
      allFiles.push(file);
      totalFiles++;
      totalSize += file.size;

      if (!extensionStats[file.extension]) {
        extensionStats[file.extension] = { count: 0, size: 0 };
      }
      extensionStats[file.extension].count++;
      extensionStats[file.extension].size += file.size;
    }

    totalScanTime += scanResult.stats.scanTime;
    totalIgnoredCount += scanResult.ignoredCount;

    console.log(chalk.green(`   ✅ 扫描完成: ${scanResult.stats.totalFiles.toLocaleString()} 个文件, ${formatBytes(scanResult.stats.totalSize)}`));
  }

  console.log(chalk.yellow('\n🔄 增量哈希计算...'));
  
  const hashResult = await indexManager.processFilesIncremental(
    allFiles,
    options.rebuildIndex || false,
    (processed, total, hit) => {
      const progress = Math.round((processed / total) * 100);
      const status = hit ? chalk.green('✓ 缓存命中') : chalk.yellow('⟳ 重新计算');
      process.stdout.write(`   进度: ${processed}/${total} (${progress}%) ${status}\r`);
    }
  );
  process.stdout.write('\n');

  indexStats = hashResult.stats;

  await indexManager.save(hashResult.files, rootDirs);

  const combinedStats = {
    totalFiles,
    totalSize,
    extensionStats,
    scanTime: totalScanTime,
    rootDir: rootDirs.join('; '),
  };

  return {
    files: hashResult.files,
    combinedStats,
    indexManager,
    indexStats,
  };
}

async function runDedupe(dirs: string[], options: CLIOptions & { gitignore?: boolean; nonInteractive?: boolean; concurrency?: number; rebuildIndex?: boolean; showIndexStats?: boolean; preferDir?: string }) {
  const directories = parseDirectories(dirs);

  if (directories.length === 0) {
    throw new Error('请至少指定一个有效的目录路径');
  }

  console.log(chalk.cyan('\n══════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan('              📁 文件相似度检测与去重工具 v2.0'));
  console.log(chalk.cyan('══════════════════════════════════════════════════════════════\n'));

  console.log(chalk.yellow(`📋 [1/4] 扫描目录${directories.length > 1 ? '（联邦模式）' : ''}...`));
  
  const scanResult = await scanMultipleDirectories(directories, options);
  
  const finalScanResult: ScanResult = {
    files: scanResult.files,
    stats: scanResult.combinedStats,
    ignoredCount: 0,
    indexStats: scanResult.indexStats,
  };

  printScanStats(finalScanResult);

  if (finalScanResult.stats.totalFiles === 0) {
    console.log(chalk.yellow('\n⚠️  没有找到符合条件的文件，任务结束。'));
    return;
  }

  const reportData: ReportData = {
    scan: finalScanResult,
    generatedAt: new Date().toISOString(),
    options: options as unknown as Record<string, unknown>,
  };

  let exactResult: Awaited<ReturnType<ExactDeduplicator['findDuplicates']>> | undefined = undefined;
  if (options.exact) {
    console.log(chalk.yellow('\n🔍 [2/4] 检测精确重复文件...'));
    const deduplicator = new ExactDeduplicator({
      concurrency: options.concurrency,
    });

    exactResult = await deduplicator.findDuplicates(scanResult.files, scanResult.indexStats);
    reportData.exactDuplicates = exactResult;

    printExactDuplicateStats(exactResult);
  }

  let nearResult = undefined;
  if (options.near) {
    console.log(chalk.yellow('\n🔬 [3/4] 检测近似重复文件...'));
    const threshold = parseInt(String(options.threshold || '85')) / 100;
    const nearDetector = new NearDuplicateDetector({
      similarityThreshold: threshold,
      concurrency: options.concurrency,
    });

    const exactDuplicatePaths = new Set<string>();
    if (exactResult && exactResult.groups.length > 0) {
      for (const group of exactResult.groups) {
        for (const file of group.files) {
          exactDuplicatePaths.add(file.path);
        }
      }
      console.log(chalk.gray(`   已排除 ${exactDuplicatePaths.size} 个精确重复文件，避免重复检测`));
    }

    const filesForNearDetect = scanResult.files.filter(f => !exactDuplicatePaths.has(f.path));
    nearResult = await nearDetector.findNearDuplicates(filesForNearDetect);
    reportData.nearDuplicates = nearResult;

    printNearDuplicateStats(nearResult);
  }

  if (options.cleanup && exactResult && exactResult.groups.length > 0) {
    console.log(chalk.yellow('\n🗑️  [4/4] 清理重复文件...'));

    const cleaner = new FileCleaner({
      autoKeepRule: options.autoKeepRule as AutoKeepRule,
      dryRun: options.dryRun,
      interactive: !options.nonInteractive,
      preferDir: options.preferDir ? path.resolve(options.preferDir) : undefined,
    });

    if (!options.autoKeepRule && !options.nonInteractive) {
      await cleaner.promptForKeepRule();
    }

    const plans = cleaner.generateAllCleanupPlans(exactResult.groups);
    const cleanupResult = await cleaner.executeCleanup(plans);
    reportData.cleanup = cleanupResult;

    printCleanupStats(cleanupResult, options.dryRun);
  }

  if (options.report) {
    console.log(chalk.yellow('\n📄 生成报告...'));

    const format = options.report as ReportFormat;
    const outputPath = options.output || generateDefaultReportName(format, directories[0]);
    const exporter = new ReportExporter(reportData);

    await exporter.export(format, outputPath);

    const absOutputPath = path.resolve(outputPath);
    console.log(chalk.green(`✅ 报告已生成: ${chalk.white(absOutputPath)}`));
  }

  console.log(chalk.cyan('\n══════════════════════════════════════════════════════════════'));
  console.log(chalk.green('                      ✅ 任务完成!'));
  console.log(chalk.cyan('══════════════════════════════════════════════════════════════\n'));
}

function printScanStats(scanResult: ScanResult): void {
  const { stats, indexStats } = scanResult;

  console.log(chalk.green(`\n✅ 扫描完成!`));
  console.log(`   总文件数: ${chalk.white(stats.totalFiles.toLocaleString())}`);
  console.log(`   总大小: ${chalk.white(formatBytes(stats.totalSize))}`);
  console.log(`   扫描耗时: ${chalk.white(stats.scanTime + ' ms')}`);

  if (indexStats) {
    console.log(`   索引命中率: ${chalk.green((indexStats.hitRate * 100).toFixed(2) + '%')} (${indexStats.hitCount} 命中 / ${indexStats.missCount} 未命中)`);
  }

  if (stats.totalFiles > 0) {
    console.log(chalk.gray('\n   按扩展名分布 (前10):'));
    const extStats = Object.entries(stats.extensionStats)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 10);

    for (const [ext, extStat] of extStats) {
      const percentage = ((extStat.size / stats.totalSize) * 100).toFixed(1);
      const bar = '█'.repeat(Math.min(Math.round(extStat.size / stats.totalSize * 50), 50));
      console.log(chalk.gray(`     ${ext.padEnd(15)} ${chalk.cyan(bar)} ${percentage.padStart(5)}% (${extStat.count} files)`));
    }
  }
}

function printExactDuplicateStats(result: Awaited<ReturnType<ExactDeduplicator['findDuplicates']>>): void {
  console.log(chalk.green(`\n✅ 精确去重检测完成!`));

  if (result.groups.length === 0) {
    console.log(chalk.green('   🎉 没有发现精确重复的文件!'));
    return;
  }

  console.log(`   重复组数: ${chalk.white(result.groups.length.toLocaleString())}`);
  console.log(`   重复文件数: ${chalk.white(result.totalDuplicateFiles.toLocaleString())}`);
  console.log(`   总可释放空间: ${chalk.yellow(formatBytes(result.totalWastedSpace))}`);
  
  if (result.crossDirectoryWastedSpace !== undefined) {
    console.log(`   ├─ 跨目录重复可释放: ${chalk.magenta(formatBytes(result.crossDirectoryWastedSpace))}`);
    console.log(`   └─ 目录内重复可释放: ${chalk.blue(formatBytes(result.intraDirectoryWastedSpace))}`);
  }
  
  console.log(`   哈希计算耗时: ${chalk.white(result.hashTime + ' ms')}`);

  if (result.indexStats) {
    console.log(`   索引命中率: ${chalk.green((result.indexStats.hitRate * 100).toFixed(2) + '%')}`);
  }

  console.log(chalk.gray('\n   重复组 (前5, 按可释放空间排序):'));
  for (let i = 0; i < Math.min(result.groups.length, 5); i++) {
    const group = result.groups[i];
    const crossTag = group.isCrossDirectory ? chalk.magenta(' [跨目录]') : '';
    console.log(chalk.gray(`\n     组 ${i + 1}: ${chalk.white(group.files.length)} 个文件, 可释放 ${chalk.yellow(formatBytes(group.wastedSpace))}${crossTag}`));
    for (let j = 0; j < Math.min(group.files.length, 3); j++) {
      const file = group.files[j];
      const relPath = path.relative(process.cwd(), file.path);
      const sourceTag = file.sourceRoot ? chalk.blue(` [${path.basename(file.sourceRoot)}]`) : '';
      const marker = j === 0 ? chalk.green('  [保留]') : chalk.red('  [删除]');
      console.log(chalk.gray(`       ${marker} ${relPath}${sourceTag}`));
    }
    if (group.files.length > 3) {
      console.log(chalk.gray(`       ... 还有 ${group.files.length - 3} 个文件`));
    }
  }
}

function printNearDuplicateStats(result: Awaited<ReturnType<NearDuplicateDetector['findNearDuplicates']>>): void {
  console.log(chalk.green(`\n✅ 近似去重检测完成!`));
  console.log(`   相似度计算耗时: ${chalk.white(result.similarityTime + ' ms')}`);

  const totalGroups = result.textGroups.length + result.imageGroups.length + 
                     (result.videoGroups?.length || 0) + (result.audioGroups?.length || 0);
  
  if (totalGroups === 0) {
    console.log(chalk.green('   🎉 没有发现近似重复的文件!'));
    return;
  }

  if (result.textGroups.length > 0) {
    console.log(`\n   📝 文本近似重复: ${chalk.white(result.textGroups.length)} 组, ${chalk.white(result.totalTextPairs)} 个文件`);
    for (let i = 0; i < Math.min(result.textGroups.length, 2); i++) {
      const group = result.textGroups[i];
      console.log(chalk.gray(`     组 ${i + 1}: 平均相似度 ${chalk.cyan((group.avgSimilarity * 100).toFixed(1) + '%')}`));
      for (let j = 0; j < Math.min(group.files.length, 3); j++) {
        const file = group.files[j];
        const relPath = path.relative(process.cwd(), file.path);
        const sourceTag = file.sourceRoot ? chalk.blue(` [${path.basename(file.sourceRoot)}]`) : '';
        console.log(chalk.gray(`       ${(file.similarity * 100).toFixed(1).padStart(6)}%  ${relPath}${sourceTag}`));
      }
    }
  }

  if (result.imageGroups.length > 0) {
    console.log(`\n   🖼️  图像近似重复: ${chalk.white(result.imageGroups.length)} 组, ${chalk.white(result.totalImagePairs)} 个文件`);
    for (let i = 0; i < Math.min(result.imageGroups.length, 2); i++) {
      const group = result.imageGroups[i];
      console.log(chalk.gray(`     组 ${i + 1}: 平均相似度 ${chalk.cyan((group.avgSimilarity * 100).toFixed(1) + '%')}`));
      for (let j = 0; j < Math.min(group.files.length, 3); j++) {
        const file = group.files[j];
        const relPath = path.relative(process.cwd(), file.path);
        const sourceTag = file.sourceRoot ? chalk.blue(` [${path.basename(file.sourceRoot)}]`) : '';
        console.log(chalk.gray(`       ${(file.similarity * 100).toFixed(1).padStart(6)}%  ${relPath}${sourceTag}`));
      }
    }
  }

  if (result.videoGroups && result.videoGroups.length > 0) {
    console.log(`\n   🎬 视频近似重复: ${chalk.white(result.videoGroups.length)} 组, ${chalk.white(result.totalVideoPairs)} 个文件`);
    for (let i = 0; i < Math.min(result.videoGroups.length, 2); i++) {
      const group = result.videoGroups[i];
      console.log(chalk.gray(`     组 ${i + 1}: 平均相似度 ${chalk.cyan((group.avgSimilarity * 100).toFixed(1) + '%')}`));
      for (let j = 0; j < Math.min(group.files.length, 3); j++) {
        const file = group.files[j];
        const relPath = path.relative(process.cwd(), file.path);
        const sourceTag = file.sourceRoot ? chalk.blue(` [${path.basename(file.sourceRoot)}]`) : '';
        console.log(chalk.gray(`       ${(file.similarity * 100).toFixed(1).padStart(6)}%  ${relPath}${sourceTag}`));
      }
    }
  }

  if (result.audioGroups && result.audioGroups.length > 0) {
    console.log(`\n   🎵 音频近似重复: ${chalk.white(result.audioGroups.length)} 组, ${chalk.white(result.totalAudioPairs)} 个文件`);
    for (let i = 0; i < Math.min(result.audioGroups.length, 2); i++) {
      const group = result.audioGroups[i];
      console.log(chalk.gray(`     组 ${i + 1}: 平均相似度 ${chalk.cyan((group.avgSimilarity * 100).toFixed(1) + '%')}`));
      for (let j = 0; j < Math.min(group.files.length, 3); j++) {
        const file = group.files[j];
        const relPath = path.relative(process.cwd(), file.path);
        const sourceTag = file.sourceRoot ? chalk.blue(` [${path.basename(file.sourceRoot)}]`) : '';
        console.log(chalk.gray(`       ${(file.similarity * 100).toFixed(1).padStart(6)}%  ${relPath}${sourceTag}`));
      }
    }
  }
}

function printCleanupStats(result: Awaited<ReturnType<FileCleaner['executeCleanup']>>, dryRun?: boolean): void {
  const prefix = dryRun ? '[预览] ' : '';
  console.log(chalk.green(`\n✅ ${prefix}清理完成!`));
  console.log(`   ${prefix}已删除文件: ${chalk.white(result.deletedCount.toLocaleString())}`);
  console.log(`   ${prefix}已释放空间: ${chalk.yellow(formatBytes(result.recoveredSpace))}`);

  if (result.errors.length > 0) {
    console.log(chalk.red(`   错误数: ${result.errors.length}`));
    for (const error of result.errors.slice(0, 5)) {
      console.log(chalk.red(`     - ${error.path}: ${error.error}`));
    }
  }
}

if (require.main === module) {
  program.parseAsync(process.argv);
}

export {
  DirectoryScanner,
  ExactDeduplicator,
  NearDuplicateDetector,
  FileCleaner,
  ReportExporter,
  IndexManager,
};
