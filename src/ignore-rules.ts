import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';

export class IgnoreRules {
  private ig: ReturnType<typeof ignore>;
  private rootDir: string;

  constructor(rootDir: string, ignorePatterns: string[] = []) {
    this.rootDir = path.resolve(rootDir);
    this.ig = ignore();
    this.ig.add(ignorePatterns);
  }

  static fromFile(rootDir: string, ignoreFilePath: string): IgnoreRules {
    const fullPath = path.isAbsolute(ignoreFilePath)
      ? ignoreFilePath
      : path.join(rootDir, ignoreFilePath);

    let patterns: string[] = [];

    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      patterns = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
    }

    return new IgnoreRules(rootDir, patterns);
  }

  static fromGitignore(rootDir: string): IgnoreRules {
    const gitignorePath = path.join(rootDir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      return IgnoreRules.fromFile(rootDir, gitignorePath);
    }
    return new IgnoreRules(rootDir, []);
  }

  add(patterns: string | string[]): void {
    this.ig.add(patterns);
  }

  ignores(filePath: string): boolean {
    const relativePath = path.relative(this.rootDir, filePath);
    if (!relativePath || relativePath.startsWith('..')) {
      return false;
    }
    return this.ig.ignores(relativePath.replace(/\\/g, '/'));
  }

  filter(paths: string[]): string[] {
    return paths.filter(p => !this.ignores(p));
  }

  getPatterns(): string[] {
    try {
      const rules = (this.ig as unknown as { rules?: { origin?: string }[] }).rules;
      if (!rules) return [];
      return rules
        .map(r => r.origin)
        .filter(Boolean) as string[];
    } catch {
      return [];
    }
  }
}

export function defaultIgnorePatterns(): string[] {
  return [
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    'target/**',
    '*.log',
    '.DS_Store',
    'Thumbs.db',
    '__pycache__/**',
    '*.pyc',
    '*.pyo',
    '*.class',
    '*.jar',
    '.file-dedupe-index.jsonl',
    '.file-dedupe-index.json',
  ];
}
