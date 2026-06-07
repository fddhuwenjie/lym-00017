import * as fs from 'fs';
import * as path from 'path';
import { ReportData, ReportFormat, FileInfo } from './types';
import { formatBytes } from './scanner';

export class ReportExporter {
  private data: ReportData;

  constructor(data: ReportData) {
    this.data = data;
  }

  async export(format: ReportFormat, outputPath: string): Promise<void> {
    let content: string;

    switch (format) {
      case 'json':
        content = this.toJSON();
        break;
      case 'markdown':
        content = this.toMarkdown();
        break;
      case 'html':
        content = this.toHTML();
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      await fs.promises.mkdir(outputDir, { recursive: true });
    }

    await fs.promises.writeFile(outputPath, content, 'utf8');
  }

  toJSON(): string {
    const serializable = JSON.parse(
      JSON.stringify(this.data, (key, value) => {
        if (value instanceof Date) {
          return value.toISOString();
        }
        if (typeof value === 'bigint') {
          return value.toString();
        }
        return value;
      })
    );
    return JSON.stringify(serializable, null, 2);
  }

  toMarkdown(): string {
    const lines: string[] = [];

    lines.push('# 文件去重分析报告');
    lines.push('');
    lines.push(`- **生成时间**: ${this.data.generatedAt}`);
    lines.push(`- **扫描目录**: ${this.data.scan.stats.rootDir}`);
    lines.push(`- **扫描耗时**: ${this.data.scan.stats.scanTime} ms`);
    lines.push('');

    lines.push('## 1. 文件统计');
    lines.push('');
    lines.push(`- **总文件数**: ${this.data.scan.stats.totalFiles.toLocaleString()}`);
    lines.push(`- **总大小**: ${formatBytes(this.data.scan.stats.totalSize)}`);
    if (this.data.scan.ignoredCount > 0) {
      lines.push(`- **忽略文件数**: ${this.data.scan.ignoredCount.toLocaleString()}`);
    }
    lines.push('');

    lines.push('### 按扩展名分布');
    lines.push('');
    lines.push('| 扩展名 | 文件数 | 总大小 | 占比 |');
    lines.push('|--------|--------|--------|------|');

    const extStats = Object.entries(this.data.scan.stats.extensionStats)
      .sort((a, b) => b[1].size - a[1].size);

    for (const [ext, stats] of extStats) {
      const percentage = ((stats.size / this.data.scan.stats.totalSize) * 100).toFixed(2);
      lines.push(`| ${ext} | ${stats.count.toLocaleString()} | ${formatBytes(stats.size)} | ${percentage}% |`);
    }
    lines.push('');

    if (this.data.exactDuplicates) {
      lines.push('## 2. 精确重复文件');
      lines.push('');
      lines.push(`- **重复文件总数**: ${this.data.exactDuplicates.totalDuplicateFiles.toLocaleString()}`);
      lines.push(`- **重复组数**: ${this.data.exactDuplicates.groups.length.toLocaleString()}`);
      lines.push(`- **可释放空间**: ${formatBytes(this.data.exactDuplicates.totalWastedSpace)}`);
      lines.push(`- **哈希计算耗时**: ${this.data.exactDuplicates.hashTime} ms`);
      lines.push('');

      if (this.data.exactDuplicates.groups.length > 0) {
        lines.push('### 重复文件组（按可释放空间排序）');
        lines.push('');

        for (let i = 0; i < Math.min(this.data.exactDuplicates.groups.length, 50); i++) {
          const group = this.data.exactDuplicates.groups[i];
          lines.push(`#### 组 ${i + 1} - ${formatBytes(group.wastedSpace)} 可释放`);
          lines.push('');
          lines.push(`- **哈希值**: ${group.hash}`);
          lines.push(`- **文件大小**: ${formatBytes(group.size)}`);
          lines.push(`- **文件数**: ${group.files.length}`);
          lines.push('');
          lines.push('| # | 文件路径 | 修改时间 | 操作 |');
          lines.push('|---|----------|----------|------|');

          for (let j = 0; j < group.files.length; j++) {
            const file = group.files[j];
            const action = j === 0 ? '保留' : '删除';
            lines.push(`| ${j + 1} | ${this.escapeMarkdown(file.path)} | ${file.mtime.toLocaleString()} | ${action} |`);
          }
          lines.push('');
        }

        if (this.data.exactDuplicates.groups.length > 50) {
          lines.push(`> 还有 ${this.data.exactDuplicates.groups.length - 50} 组未显示`);
          lines.push('');
        }
      }
    }

    if (this.data.nearDuplicates) {
      lines.push('## 3. 近似重复文件');
      lines.push('');
      lines.push(`- **相似度计算耗时**: ${this.data.nearDuplicates.similarityTime} ms`);
      lines.push('');

      if (this.data.nearDuplicates.textGroups.length > 0) {
        lines.push('### 文本近似重复');
        lines.push('');
        lines.push(`- **文本组数**: ${this.data.nearDuplicates.textGroups.length}`);
        lines.push(`- **涉及文件数**: ${this.data.nearDuplicates.totalTextPairs}`);
        lines.push('');

        for (let i = 0; i < Math.min(this.data.nearDuplicates.textGroups.length, 20); i++) {
          const group = this.data.nearDuplicates.textGroups[i];
          lines.push(`#### 文本组 ${i + 1} - 平均相似度 ${(group.avgSimilarity * 100).toFixed(1)}%`);
          lines.push('');
          lines.push('| 文件路径 | 相似度 |');
          lines.push('|----------|--------|');

          for (const file of group.files) {
            lines.push(`| ${this.escapeMarkdown(file.path)} | ${(file.similarity * 100).toFixed(1)}% |`);
          }
          lines.push('');
        }
      }

      if (this.data.nearDuplicates.imageGroups.length > 0) {
        lines.push('### 图像近似重复');
        lines.push('');
        lines.push(`- **图像组数**: ${this.data.nearDuplicates.imageGroups.length}`);
        lines.push(`- **涉及文件数**: ${this.data.nearDuplicates.totalImagePairs}`);
        lines.push('');

        for (let i = 0; i < Math.min(this.data.nearDuplicates.imageGroups.length, 20); i++) {
          const group = this.data.nearDuplicates.imageGroups[i];
          lines.push(`#### 图像组 ${i + 1} - 平均相似度 ${(group.avgSimilarity * 100).toFixed(1)}%`);
          lines.push('');
          lines.push('| 文件路径 | 相似度 |');
          lines.push('|----------|--------|');

          for (const file of group.files) {
            lines.push(`| ${this.escapeMarkdown(file.path)} | ${(file.similarity * 100).toFixed(1)}% |`);
          }
          lines.push('');
        }
      }
    }

    if (this.data.cleanup) {
      lines.push('## 4. 清理结果');
      lines.push('');
      lines.push(`- **已删除文件数**: ${this.data.cleanup.deletedCount.toLocaleString()}`);
      lines.push(`- **已释放空间**: ${formatBytes(this.data.cleanup.recoveredSpace)}`);
      if (this.data.cleanup.errors.length > 0) {
        lines.push(`- **错误数**: ${this.data.cleanup.errors.length}`);
        lines.push('');
        lines.push('### 错误详情');
        lines.push('');
        for (const error of this.data.cleanup.errors) {
          lines.push(`- \`${error.path}\`: ${error.error}`);
        }
      }
      lines.push('');
    }

    lines.push('## 5. 扫描配置');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(this.data.options, null, 2));
    lines.push('```');
    lines.push('');

    return lines.join('\n');
  }

  toHTML(): string {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>文件去重分析报告</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #333;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px 40px;
    }
    .header h1 { font-size: 28px; margin-bottom: 10px; }
    .header .meta { opacity: 0.9; font-size: 14px; }
    .content { padding: 30px 40px; }
    .section { margin-bottom: 30px; }
    .section h2 {
      font-size: 20px;
      color: #667eea;
      margin-bottom: 15px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e8e8e8;
    }
    .section h3 {
      font-size: 16px;
      color: #764ba2;
      margin: 20px 0 10px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%);
      padding: 20px;
      border-radius: 12px;
      border-left: 4px solid #667eea;
    }
    .stat-card .label { font-size: 12px; color: #666; margin-bottom: 5px; }
    .stat-card .value { font-size: 24px; font-weight: bold; color: #333; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
      font-size: 13px;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e8e8e8;
    }
    th {
      background: #f5f7fa;
      font-weight: 600;
      color: #555;
    }
    tr:hover { background: #fafafa; }
    .duplicate-group {
      background: #fff5f5;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
      border: 1px solid #fed7d7;
    }
    .group-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px dashed #fed7d7;
    }
    .group-title { font-weight: 600; color: #c53030; }
    .group-size { color: #742a2a; font-weight: 500; }
    .keep { color: #2f855a; font-weight: 600; }
    .delete { color: #c53030; font-weight: 600; }
    .hash {
      font-family: 'Courier New', monospace;
      font-size: 11px;
      color: #666;
      background: #f5f7fa;
      padding: 4px 8px;
      border-radius: 4px;
      display: inline-block;
    }
    .similarity {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .sim-high { background: #fed7d7; color: #c53030; }
    .sim-medium { background: #feebc8; color: #c05621; }
    .sim-low { background: #c6f6d5; color: #276749; }
    .warning {
      background: #fffaf0;
      border: 1px solid #feebc8;
      padding: 12px;
      border-radius: 8px;
      color: #c05621;
      font-size: 13px;
    }
    .success {
      background: #f0fff4;
      border: 1px solid #c6f6d5;
      padding: 12px;
      border-radius: 8px;
      color: #276749;
      font-size: 13px;
    }
    pre {
      background: #1a202c;
      color: #e2e8f0;
      padding: 15px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 12px;
    }
    code { font-family: 'Courier New', monospace; }
    .ext-bar {
      height: 8px;
      background: #e8e8e8;
      border-radius: 4px;
      overflow: hidden;
    }
    .ext-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📁 文件去重分析报告</h1>
      <div class="meta">
        生成时间: ${this.data.generatedAt} | 扫描目录: ${this.escapeHTML(this.data.scan.stats.rootDir)}
      </div>
    </div>
    <div class="content">

      <div class="section">
        <h2>📊 文件统计</h2>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="label">总文件数</div>
            <div class="value">${this.data.scan.stats.totalFiles.toLocaleString()}</div>
          </div>
          <div class="stat-card">
            <div class="label">总大小</div>
            <div class="value">${formatBytes(this.data.scan.stats.totalSize)}</div>
          </div>
          ${this.data.scan.ignoredCount > 0 ? `
          <div class="stat-card">
            <div class="label">忽略文件数</div>
            <div class="value">${this.data.scan.ignoredCount.toLocaleString()}</div>
          </div>` : ''}
          <div class="stat-card">
            <div class="label">扫描耗时</div>
            <div class="value">${this.data.scan.stats.scanTime} ms</div>
          </div>
        </div>

        <h3>按扩展名分布</h3>
        <table>
          <thead>
            <tr>
              <th>扩展名</th>
              <th>文件数</th>
              <th>总大小</th>
              <th>占比</th>
              <th style="width: 200px;">分布</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(this.data.scan.stats.extensionStats)
              .sort((a, b) => b[1].size - a[1].size)
              .map(([ext, stats]) => {
                const percentage = (stats.size / this.data.scan.stats.totalSize) * 100;
                return `
                <tr>
                  <td><code>${this.escapeHTML(ext)}</code></td>
                  <td>${stats.count.toLocaleString()}</td>
                  <td>${formatBytes(stats.size)}</td>
                  <td>${percentage.toFixed(2)}%</td>
                  <td><div class="ext-bar"><div class="ext-bar-fill" style="width: ${percentage}%"></div></div></td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>
      </div>

      ${this.data.exactDuplicates ? `
      <div class="section">
        <h2>🎯 精确重复文件</h2>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="label">重复文件数</div>
            <div class="value">${this.data.exactDuplicates.totalDuplicateFiles.toLocaleString()}</div>
          </div>
          <div class="stat-card">
            <div class="label">重复组数</div>
            <div class="value">${this.data.exactDuplicates.groups.length.toLocaleString()}</div>
          </div>
          <div class="stat-card" style="border-left-color: #c53030;">
            <div class="label">可释放空间</div>
            <div class="value" style="color: #c53030;">${formatBytes(this.data.exactDuplicates.totalWastedSpace)}</div>
          </div>
        </div>

        ${this.data.exactDuplicates.groups.length > 0 ? `
          ${this.data.exactDuplicates.groups.slice(0, 50).map((group, idx) => `
          <div class="duplicate-group">
            <div class="group-header">
              <span class="group-title">组 ${idx + 1}</span>
              <span class="group-size">${formatBytes(group.wastedSpace)} 可释放</span>
            </div>
            <div><span class="hash">${group.hash}</span></div>
            <div style="margin: 10px 0; color: #666; font-size: 13px;">
              文件大小: ${formatBytes(group.size)} | 共 ${group.files.length} 个文件
            </div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>文件路径</th>
                  <th>修改时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${group.files.map((file, j) => `
                <tr>
                  <td>${j + 1}</td>
                  <td><code>${this.escapeHTML(file.path)}</code></td>
                  <td>${file.mtime.toLocaleString()}</td>
                  <td><span class="${j === 0 ? 'keep' : 'delete'}">${j === 0 ? '✓ 保留' : '✗ 删除'}</span></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`).join('')}

          ${this.data.exactDuplicates.groups.length > 50 ? `
          <div class="warning">
            ⚠️ 还有 ${this.data.exactDuplicates.groups.length - 50} 组重复文件未在此报告中显示
          </div>` : ''}
        ` : `
        <div class="success">
          ✅ 太棒了！没有发现精确重复的文件
        </div>`}
      </div>` : ''}

      ${this.data.nearDuplicates ? `
      <div class="section">
        <h2>🔍 近似重复文件</h2>

        ${this.data.nearDuplicates.textGroups.length > 0 ? `
        <h3>📝 文本近似重复 (${this.data.nearDuplicates.textGroups.length} 组)</h3>
        ${this.data.nearDuplicates.textGroups.slice(0, 20).map((group, idx) => `
        <div class="duplicate-group" style="background: #f7fafc; border-color: #bee3f8;">
          <div class="group-header">
            <span class="group-title" style="color: #2b6cb0;">文本组 ${idx + 1}</span>
            <span class="group-size" style="color: #2c5282;">平均相似度 ${(group.avgSimilarity * 100).toFixed(1)}%</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>文件路径</th>
                <th>相似度</th>
              </tr>
            </thead>
            <tbody>
              ${group.files.map(file => {
                const simClass = file.similarity >= 0.95 ? 'sim-high' : file.similarity >= 0.85 ? 'sim-medium' : 'sim-low';
                return `
                <tr>
                  <td><code>${this.escapeHTML(file.path)}</code></td>
                  <td><span class="similarity ${simClass}">${(file.similarity * 100).toFixed(1)}%</span></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`).join('')}
        ` : ''}

        ${this.data.nearDuplicates.imageGroups.length > 0 ? `
        <h3>🖼️ 图像近似重复 (${this.data.nearDuplicates.imageGroups.length} 组)</h3>
        ${this.data.nearDuplicates.imageGroups.slice(0, 20).map((group, idx) => `
        <div class="duplicate-group" style="background: #faf5ff; border-color: #d6bcfa;">
          <div class="group-header">
            <span class="group-title" style="color: #805ad5;">图像组 ${idx + 1}</span>
            <span class="group-size" style="color: #553c9a;">平均相似度 ${(group.avgSimilarity * 100).toFixed(1)}%</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>文件路径</th>
                <th>相似度</th>
              </tr>
            </thead>
            <tbody>
              ${group.files.map(file => {
                const simClass = file.similarity >= 0.95 ? 'sim-high' : file.similarity >= 0.85 ? 'sim-medium' : 'sim-low';
                return `
                <tr>
                  <td><code>${this.escapeHTML(file.path)}</code></td>
                  <td><span class="similarity ${simClass}">${(file.similarity * 100).toFixed(1)}%</span></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`).join('')}
        ` : ''}

        ${this.data.nearDuplicates.textGroups.length === 0 && this.data.nearDuplicates.imageGroups.length === 0 ? `
        <div class="success">
          ✅ 没有发现近似重复的文件
        </div>` : ''}
      </div>` : ''}

      ${this.data.cleanup ? `
      <div class="section">
        <h2>🗑️ 清理结果</h2>
        <div class="stats-grid">
          <div class="stat-card" style="border-left-color: #2f855a;">
            <div class="label">已删除文件</div>
            <div class="value" style="color: #2f855a;">${this.data.cleanup.deletedCount.toLocaleString()}</div>
          </div>
          <div class="stat-card" style="border-left-color: #2f855a;">
            <div class="label">已释放空间</div>
            <div class="value" style="color: #2f855a;">${formatBytes(this.data.cleanup.recoveredSpace)}</div>
          </div>
          ${this.data.cleanup.errors.length > 0 ? `
          <div class="stat-card" style="border-left-color: #c53030;">
            <div class="label">错误数</div>
            <div class="value" style="color: #c53030;">${this.data.cleanup.errors.length}</div>
          </div>` : ''}
        </div>

        ${this.data.cleanup.errors.length > 0 ? `
        <h3>错误详情</h3>
        ${this.data.cleanup.errors.map(err => `
        <div class="warning">
          ⚠️ <code>${this.escapeHTML(err.path)}</code>: ${this.escapeHTML(err.error)}
        </div>`).join('')}
        ` : ''}
      </div>` : ''}

      <div class="section">
        <h2>⚙️ 扫描配置</h2>
        <pre>${this.escapeHTML(JSON.stringify(this.data.options, null, 2))}</pre>
      </div>

    </div>
  </div>
</body>
</html>`;

    return html;
  }

  private escapeHTML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private escapeMarkdown(str: string): string {
    return str.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&');
  }
}

export function generateDefaultReportName(format: ReportFormat, dir?: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const suffix = dir ? `-${path.basename(dir)}` : '';
  const ext = format === 'json' ? 'json' : format === 'markdown' ? 'md' : 'html';
  return `dedupe-report${suffix}-${timestamp}.${ext}`;
}
