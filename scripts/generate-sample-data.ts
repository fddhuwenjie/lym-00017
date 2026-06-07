#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const SAMPLE_DIR = path.resolve(__dirname, '..', 'sample-data');

const LOREM_IPSUM = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. 
Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. 
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. 
Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. 
Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. 
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, 
totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. 
Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, 
sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.

Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, 
sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.

Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, 
nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur, 
vel illum qui dolorem eum fugiat quo voluptas nulla pariatur?`;

const PROJECT_README = `# 示例项目

这是一个示例项目，用于演示文件去重工具的功能。

## 功能特性

- 文件扫描
- 精确去重
- 近似去重
- 安全清理

## 使用方法

运行 file-dedupe 工具扫描此目录。

## 许可证

MIT License`;

const CODE_SNIPPET = `function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.split(/\\W+/));
  const words2 = new Set(text2.split(/\\W+/));
  
  if (words1.size === 0 && words2.size === 0) return 1.0;
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

// 示例用法
const sim = calculateSimilarity("hello world", "hello there");
console.log(\`Similarity: \${sim}\`);`;

const DATA_JSON = JSON.stringify({
  name: "sample-dataset",
  version: "1.0.0",
  description: "A sample dataset for testing file deduplication",
  items: [
    { id: 1, value: "Lorem ipsum", category: "text" },
    { id: 2, value: "dolor sit amet", category: "text" },
    { id: 3, value: "consectetur adipiscing", category: "text" },
    { id: 4, value: 42, category: "number" },
    { id: 5, value: true, category: "boolean" },
  ],
  metadata: {
    createdAt: new Date().toISOString(),
    author: "file-dedupe-cli",
    tags: ["sample", "test", "deduplication"],
  },
}, null, 2);

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeFile(filePath: string, content: string | Buffer): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  console.log(`  Created: ${path.relative(SAMPLE_DIR, filePath)}`);
}

function generateRandomBytes(size: number): Buffer {
  return crypto.randomBytes(size);
}

function createPNG(width: number, height: number, r: number, g: number, b: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  function crc32(data: Buffer): Buffer {
    let crc = 0xFFFFFFFF;
    const table: number[] = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    const result = (crc ^ 0xFFFFFFFF) >>> 0;
    return Buffer.from([
      (result >> 24) & 0xFF,
      (result >> 16) & 0xFF,
      (result >> 8) & 0xFF,
      result & 0xFF,
    ]);
  }

  function createChunk(type: string, data: Buffer): Buffer {
    const length = Buffer.from([
      (data.length >> 24) & 0xFF,
      (data.length >> 16) & 0xFF,
      (data.length >> 8) & 0xFF,
      data.length & 0xFF,
    ]);
    const typeBuffer = Buffer.from(type, 'ascii');
    const crcData = Buffer.concat([typeBuffer, data]);
    return Buffer.concat([length, typeBuffer, data, crc32(crcData)]);
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = createChunk('IHDR', ihdrData);

  const rawData = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 3)] = 0;
    for (let x = 0; x < width; x++) {
      const offset = y * (1 + width * 3) + 1 + x * 3;
      const variation = Math.sin(x * 0.1 + y * 0.05) * 20;
      rawData[offset] = Math.min(255, Math.max(0, r + variation));
      rawData[offset + 1] = Math.min(255, Math.max(0, g + variation * 0.5));
      rawData[offset + 2] = Math.min(255, Math.max(0, b + variation * 0.3));
    }
  }

  const { deflateSync } = require('zlib');
  const compressed = deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

async function generateSampleData(): Promise<void> {
  console.log('🚀 正在生成示例数据目录...\n');

  if (fs.existsSync(SAMPLE_DIR)) {
    console.log('⚠️  示例目录已存在，正在清理...');
    fs.rmSync(SAMPLE_DIR, { recursive: true, force: true });
  }

  ensureDir(SAMPLE_DIR);

  console.log('📁 创建目录结构...\n');

  console.log('📄 生成文本文件...');
  writeFile(path.join(SAMPLE_DIR, 'documents', 'report.txt'), LOREM_IPSUM);
  writeFile(path.join(SAMPLE_DIR, 'documents', 'report_copy.txt'), LOREM_IPSUM);
  writeFile(path.join(SAMPLE_DIR, 'documents', 'backup', 'report_backup_2024.txt'), LOREM_IPSUM);
  writeFile(path.join(SAMPLE_DIR, 'archive', 'old_report.txt'), LOREM_IPSUM);

  const loremV2 = LOREM_IPSUM.replace('Lorem ipsum dolor sit amet', 'Lorem ipsum AMET sit dolor')
    .replace('consectetur adipiscing elit', 'ADIPISCING consectetur ELIT')
    .replace('Ut enim ad minim veniam', 'ENIM minim veniam ut');
  writeFile(path.join(SAMPLE_DIR, 'documents', 'report_v2.txt'), loremV2);
  writeFile(path.join(SAMPLE_DIR, 'documents', 'report_v2_similar.txt'), loremV2 + '\n\nAdded some extra content at the end.');

  console.log('\n📝 生成代码文件...');
  writeFile(path.join(SAMPLE_DIR, 'src', 'utils.ts'), CODE_SNIPPET);
  writeFile(path.join(SAMPLE_DIR, 'src', 'utils_copy.ts'), CODE_SNIPPET);
  writeFile(path.join(SAMPLE_DIR, 'lib', 'utils.old.ts'), CODE_SNIPPET);

  const codeV2 = CODE_SNIPPET
    .replace('calculateSimilarity', 'computeSimilarity')
    .replace('function calculate', 'export function compute')
    .replace('const words1 = new Set', 'const tokens1 = new Set');
  writeFile(path.join(SAMPLE_DIR, 'src', 'similarity.ts'), codeV2);

  console.log('\n📋 生成配置文件...');
  writeFile(path.join(SAMPLE_DIR, 'README.md'), PROJECT_README);
  writeFile(path.join(SAMPLE_DIR, 'docs', 'README.md'), PROJECT_README);
  writeFile(path.join(SAMPLE_DIR, 'data', 'config.json'), DATA_JSON);
  writeFile(path.join(SAMPLE_DIR, 'data', 'config_backup.json'), DATA_JSON);
  writeFile(path.join(SAMPLE_DIR, 'config', 'settings.json'), DATA_JSON);

  const dataV2 = JSON.parse(DATA_JSON);
  dataV2.version = '1.1.0';
  dataV2.items.push({ id: 6, value: "new item", category: "text" });
  writeFile(path.join(SAMPLE_DIR, 'data', 'config_v2.json'), JSON.stringify(dataV2, null, 2));

  console.log('\n🖼️  生成图像文件...');
  const img1 = createPNG(64, 64, 100, 150, 200);
  writeFile(path.join(SAMPLE_DIR, 'images', 'photo.png'), img1);
  writeFile(path.join(SAMPLE_DIR, 'images', 'photo_copy.png'), img1);
  writeFile(path.join(SAMPLE_DIR, 'images', 'backup', 'photo_backup.png'), img1);

  const img2 = createPNG(64, 64, 120, 140, 210);
  writeFile(path.join(SAMPLE_DIR, 'images', 'photo_similar.png'), img2);

  const img3 = createPNG(64, 64, 200, 100, 100);
  writeFile(path.join(SAMPLE_DIR, 'images', 'red_image.png'), img3);
  writeFile(path.join(SAMPLE_DIR, 'images', 'red_image_copy.png'), img3);

  const img4 = createPNG(64, 64, 100, 200, 100);
  writeFile(path.join(SAMPLE_DIR, 'images', 'green_image.png'), img4);

  console.log('\n📦 生成二进制文件...');
  const bin1 = generateRandomBytes(1024 * 10);
  writeFile(path.join(SAMPLE_DIR, 'bin', 'data.bin'), bin1);
  writeFile(path.join(SAMPLE_DIR, 'bin', 'data_copy.bin'), bin1);
  writeFile(path.join(SAMPLE_DIR, 'bin', 'backup', 'data_backup.bin'), bin1);

  const bin2 = generateRandomBytes(1024 * 10);
  writeFile(path.join(SAMPLE_DIR, 'bin', 'other_data.bin'), bin2);

  console.log('\n📊 生成 CSV 文件...');
  const csvContent = `id,name,category,value,date
1,alpha,cat1,100,2024-01-15
2,beta,cat2,200,2024-02-20
3,gamma,cat1,150,2024-03-10
4,delta,cat3,300,2024-04-05
5,epsilon,cat2,250,2024-05-12
`;
  writeFile(path.join(SAMPLE_DIR, 'data', 'report.csv'), csvContent);
  writeFile(path.join(SAMPLE_DIR, 'data', 'report_copy.csv'), csvContent);

  console.log('\n📝 生成日志文件...');
  const logContent = `[2024-01-15 10:00:00] INFO: Application started
[2024-01-15 10:00:01] INFO: Loading configuration
[2024-01-15 10:00:02] DEBUG: Initializing modules
[2024-01-15 10:00:03] INFO: Processing request id=12345
[2024-01-15 10:00:04] DEBUG: Cache hit for key="user_123"
[2024-01-15 10:00:05] INFO: Request completed in 45ms
[2024-01-15 10:00:06] WARNING: Low memory detected (85% used)
[2024-01-15 10:00:07] INFO: Starting cleanup process
[2024-01-15 10:00:08] DEBUG: Removed 150 expired items
[2024-01-15 10:00:09] INFO: Cleanup completed
`;
  writeFile(path.join(SAMPLE_DIR, 'logs', 'app.log'), logContent);
  writeFile(path.join(SAMPLE_DIR, 'logs', 'app_copy.log'), logContent);

  console.log('\n🚫 创建忽略规则文件...');
  const gitignoreContent = `node_modules/
dist/
*.log
.DS_Store
temp/
*.tmp
`;
  writeFile(path.join(SAMPLE_DIR, '.gitignore'), gitignoreContent);
  writeFile(path.join(SAMPLE_DIR, 'temp', 'ignore_me.txt'), 'This file should be ignored');
  writeFile(path.join(SAMPLE_DIR, 'temp', 'ignore_me_too.txt'), 'This file should also be ignored');

  console.log('\n✅ 示例数据生成完成!');
  console.log('\n📊 统计信息:');
  console.log('   - 精确重复组: 8 组');
  console.log('   - 精确重复文件: 17 个');
  console.log('   - 近似重复文本: 3 组');
  console.log('   - 近似重复图像: 1 组');
  console.log(`   - 示例目录: ${SAMPLE_DIR}`);
  console.log('\n💡 使用方法:');
  console.log(`   npm run dev -- --exact --near --report html sample-data`);
}

if (require.main === module) {
  generateSampleData().catch(console.error);
}

export { generateSampleData };
