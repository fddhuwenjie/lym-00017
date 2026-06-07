import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import {
  FileInfo,
  ExactDuplicateGroup,
  KeepRule,
  CleanupPlan,
  CleanupResult,
} from './types';

export type AutoKeepRule =
  | 'mtime_newest'
  | 'mtime_oldest'
  | 'depth_shallowest'
  | 'path_shortest'
  | 'name_pattern'
  | 'prefer_dir';

export interface CleanupOptions {
  autoKeepRule?: AutoKeepRule;
  dryRun?: boolean;
  interactive?: boolean;
  namePatterns?: string[];
  recursive?: boolean;
  preferDir?: string;
}

export class FileCleaner {
  private options: Required<CleanupOptions>;

  constructor(options: CleanupOptions = {}) {
    this.options = {
      autoKeepRule: options.autoKeepRule || 'mtime_newest',
      dryRun: options.dryRun ?? false,
      interactive: options.interactive ?? true,
      namePatterns: options.namePatterns || ['original', 'copy', 'backup', '副本'],
      recursive: options.recursive ?? false,
      preferDir: options.preferDir || '',
    };
  }

  suggestKeepRule(files: FileInfo[]): KeepRule {
    switch (this.options.autoKeepRule) {
      case 'mtime_newest':
        return {
          type: 'mtime',
          value: 'newest',
          description: '保留最新修改的文件',
        };
      case 'mtime_oldest':
        return {
          type: 'mtime',
          value: 'oldest',
          description: '保留最早修改的文件',
        };
      case 'depth_shallowest':
        return {
          type: 'depth',
          value: 'shallowest',
          description: '保留路径最浅的文件',
        };
      case 'path_shortest':
        return {
          type: 'path',
          value: 'shortest',
          description: '保留路径最短的文件',
        };
      case 'name_pattern':
        return {
          type: 'name',
          value: this.options.namePatterns.join('|'),
          description: '按文件名模式保留（避免删除包含 original/copy/backup 等字样的文件）',
        };
      case 'prefer_dir':
        return {
          type: 'prefer_dir',
          value: this.options.preferDir,
          description: `优先保留来自 ${this.options.preferDir} 的文件`,
        };
      default:
        return {
          type: 'mtime',
          value: 'newest',
          description: '保留最新修改的文件',
        };
    }
  }

  selectFileToKeep(files: FileInfo[], rule: KeepRule): FileInfo {
    const sorted = [...files];

    switch (rule.type) {
      case 'mtime':
        if (rule.value === 'newest') {
          return sorted.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0];
        } else {
          return sorted.sort((a, b) => a.mtime.getTime() - b.mtime.getTime())[0];
        }
      case 'depth':
        return sorted.sort((a, b) => a.depth - b.depth)[0];
      case 'path':
        return sorted.sort((a, b) => a.path.length - b.path.length)[0];
      case 'name': {
        const patterns = (rule.value as string).split('|').map(p => p.toLowerCase());
        const hasPattern = (name: string) =>
          patterns.some(p => name.toLowerCase().includes(p));

        const candidates = sorted.filter(f => hasPattern(f.name));
        if (candidates.length > 0) {
          return candidates.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0];
        }
        return sorted.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0];
      }
      case 'prefer_dir': {
        const preferDir = (rule.value as string).toLowerCase();
        const isInPreferDir = (file: FileInfo) => {
          if (file.sourceRoot) {
            return file.sourceRoot.toLowerCase() === preferDir ||
                   file.path.toLowerCase().startsWith(preferDir);
          }
          return file.path.toLowerCase().startsWith(preferDir);
        };

        const preferCandidates = sorted.filter(f => isInPreferDir(f));
        if (preferCandidates.length > 0) {
          return preferCandidates.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0];
        }
        return sorted.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0];
      }
      default:
        return sorted.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0];
    }
  }

  generateCleanupPlan(group: ExactDuplicateGroup): CleanupPlan {
    const keepRule = this.suggestKeepRule(group.files);
    const keepFile = this.selectFileToKeep(group.files, keepRule);
    const deleteFiles = group.files.filter(f => f.path !== keepFile.path);
    const recoverableSpace = group.wastedSpace;

    return {
      keepFile,
      deleteFiles,
      keepRule,
      recoverableSpace,
    };
  }

  generateAllCleanupPlans(groups: ExactDuplicateGroup[]): CleanupPlan[] {
    return groups.map(group => this.generateCleanupPlan(group));
  }

  async confirmCleanup(plans: CleanupPlan[]): Promise<CleanupPlan[]> {
    if (!this.options.interactive || plans.length === 0) {
      return plans;
    }

    const choices = plans.map((plan, index) => ({
      name: `[${index + 1}] 保留: ${this.formatFileForDisplay(plan.keepFile)}\n` +
            `    删除 ${plan.deleteFiles.length} 个文件, 可释放 ${this.formatBytes(plan.recoverableSpace)}\n` +
            `    规则: ${plan.keepRule.description}`,
      value: index,
      checked: true,
    }));

    const answer = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedIndices',
        message: '选择要执行清理的重复组（空格选择，回车确认）：',
        choices,
        pageSize: 10,
      },
    ]);

    const selectedIndices: number[] = answer.selectedIndices || [];
    return selectedIndices.map(i => plans[i]);
  }

  async confirmDeletions(plan: CleanupPlan): Promise<FileInfo[]> {
    if (!this.options.interactive) {
      return plan.deleteFiles;
    }

    const choices = plan.deleteFiles.map(file => ({
      name: this.formatFileForDisplay(file),
      value: file,
      checked: true,
    }));

    const answer = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'filesToDelete',
        message: `确认要删除以下文件（保留: ${this.formatFileForDisplay(plan.keepFile)}）：`,
        choices,
        pageSize: 10,
      },
    ]);

    return answer.filesToDelete || [];
  }

  async executeCleanup(plans: CleanupPlan[]): Promise<CleanupResult> {
    const selectedPlans = await this.confirmCleanup(plans);

    if (selectedPlans.length === 0) {
      return {
        deletedCount: 0,
        recoveredSpace: 0,
        errors: [],
      };
    }

    let deletedCount = 0;
    let recoveredSpace = 0;
    const errors: { path: string; error: string }[] = [];

    for (const plan of selectedPlans) {
      const filesToDelete = await this.confirmDeletions(plan);

      for (const file of filesToDelete) {
        try {
          if (this.options.dryRun) {
            console.log(`[DRY RUN] 将会删除: ${file.path}`);
            deletedCount++;
            recoveredSpace += file.size;
          } else {
            await fs.promises.unlink(file.path);
            console.log(`已删除: ${file.path}`);
            deletedCount++;
            recoveredSpace += file.size;
          }
        } catch (err) {
          const errorMessage = (err as Error).message;
          console.error(`删除失败 ${file.path}: ${errorMessage}`);
          errors.push({ path: file.path, error: errorMessage });
        }
      }
    }

    return {
      deletedCount,
      recoveredSpace,
      errors,
    };
  }

  async promptForKeepRule(): Promise<AutoKeepRule> {
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'keepRule',
        message: '请选择文件保留规则：',
        choices: [
          { value: 'mtime_newest', name: '保留最新修改的文件' },
          { value: 'mtime_oldest', name: '保留最早修改的文件' },
          { value: 'depth_shallowest', name: '保留路径最浅的文件' },
          { value: 'path_shortest', name: '保留路径最短的文件' },
          { value: 'name_pattern', name: '按文件名模式智能选择' },
          { value: 'prefer_dir', name: '按来源目录优先级保留' },
        ],
        default: 'mtime_newest',
      },
    ]);

    this.options.autoKeepRule = answer.keepRule;

    if (answer.keepRule === 'prefer_dir' && !this.options.preferDir) {
      const dirAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'preferDir',
          message: '请输入优先保留的目录路径：',
          validate: (input: string) => {
            if (!input.trim()) {
              return '请输入有效的目录路径';
            }
            return true;
          },
        },
      ]);
      this.options.preferDir = dirAnswer.preferDir;
    }

    return answer.keepRule;
  }

  private formatFileForDisplay(file: FileInfo): string {
    const relPath = this.tryGetRelativePath(file.path);
    const sizeStr = this.formatBytes(file.size);
    const mtimeStr = file.mtime.toLocaleString();
    return `${relPath} (${sizeStr}, 修改于: ${mtimeStr})`;
  }

  private tryGetRelativePath(filePath: string): string {
    try {
      return path.relative(process.cwd(), filePath);
    } catch {
      return filePath;
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  setDryRun(dryRun: boolean): void {
    this.options.dryRun = dryRun;
  }

  setInteractive(interactive: boolean): void {
    this.options.interactive = interactive;
  }

  setAutoKeepRule(rule: AutoKeepRule): void {
    this.options.autoKeepRule = rule;
  }

  setPreferDir(dir: string): void {
    this.options.preferDir = dir;
  }
}
