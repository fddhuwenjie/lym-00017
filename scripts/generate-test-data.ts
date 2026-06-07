import * as fs from 'fs';
import * as path from 'path';
import Jimp from 'jimp';
import * as crypto from 'crypto';

const testDataDir = path.join(__dirname, '..', 'test-data');

async function createTextFile(filePath: string, content: string) {
  await fs.promises.writeFile(filePath, content, 'utf8');
}

async function createImageFile(filePath: string, color: { r: number; g: number; b: number }, size: number = 200) {
  const image = new Jimp(size, size, 0xFFFFFFFF);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const variation = Math.sin(x * 0.1) * Math.cos(y * 0.1) * 20;
      const r = Math.min(255, Math.max(0, color.r + variation));
      const g = Math.min(255, Math.max(0, color.g + variation));
      const b = Math.min(255, Math.max(0, color.b + variation));
      image.setPixelColor(Jimp.rgbaToInt(r, g, b, 255), x, y);
    }
  }
  await image.writeAsync(filePath);
}

function createMockMediaFile(filePath: string, size: number, signature: string) {
  const buffer = Buffer.alloc(size);
  buffer.write(signature, 0, signature.length, 'utf8');
  for (let i = signature.length; i < size; i++) {
    buffer[i] = Math.floor(Math.random() * 256);
  }
  fs.writeFileSync(filePath, buffer);
}

async function generateTestData() {
  console.log('🧪 生成测试数据...\n');

  const dirA = path.join(testDataDir, 'dirA');
  const dirB = path.join(testDataDir, 'dirB');

  const loremIpsum = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. 
Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. 
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.
Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.
Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.`;

  const loremIpsumSimilar = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. 
Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. 
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi.
Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.
Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt.`;

  console.log('📝 创建文本文件...');
  
  await createTextFile(path.join(dirA, 'documents', 'report.txt'), loremIpsum);
  await createTextFile(path.join(dirA, 'documents', 'report_copy.txt'), loremIpsum);
  await createTextFile(path.join(dirA, 'documents', 'report_similar.txt'), loremIpsumSimilar);
  await createTextFile(path.join(dirA, 'documents', 'notes.txt'), '这是一个独特的笔记文件，内容与其他文件不同。\n包含一些个人想法和记录。');
  await createTextFile(path.join(dirA, 'documents', 'data.json'), JSON.stringify({ name: 'test', version: '1.0', data: [1, 2, 3, 4, 5] }, null, 2));

  await createTextFile(path.join(dirB, 'documents', 'report.txt'), loremIpsum);
  await createTextFile(path.join(dirB, 'documents', 'notes_b.txt'), '这是目录B中的独特笔记文件。');

  console.log('🖼️  创建图像文件...');
  
  await createImageFile(path.join(dirA, 'images', 'photo.png'), { r: 100, g: 150, b: 200 });
  await createImageFile(path.join(dirA, 'images', 'photo_copy.png'), { r: 100, g: 150, b: 200 });
  await createImageFile(path.join(dirA, 'images', 'photo_similar.png'), { r: 105, g: 155, b: 205 });
  await createImageFile(path.join(dirA, 'images', 'landscape.png'), { r: 50, g: 120, b: 80 });

  await createImageFile(path.join(dirB, 'images', 'photo.png'), { r: 100, g: 150, b: 200 });
  await createImageFile(path.join(dirB, 'images', 'portrait.png'), { r: 180, g: 100, b: 120 });

  console.log('🎬 创建模拟视频文件...');
  
  const videoSignature = 'MP4VIDEOHEADER';
  createMockMediaFile(path.join(dirA, 'media', 'sample_video.mp4'), 5 * 1024 * 1024, videoSignature);
  createMockMediaFile(path.join(dirA, 'media', 'sample_video_copy.mp4'), 5 * 1024 * 1024, videoSignature);
  createMockMediaFile(path.join(dirB, 'media', 'sample_video.mp4'), 5 * 1024 * 1024, videoSignature);

  console.log('🎵 创建模拟音频文件...');
  
  const audioSignature = 'MP3AUDIOHEADER';
  createMockMediaFile(path.join(dirA, 'media', 'sample_audio.mp3'), 3 * 1024 * 1024, audioSignature);
  createMockMediaFile(path.join(dirA, 'media', 'sample_audio_copy.mp3'), 3 * 1024 * 1024, audioSignature);
  createMockMediaFile(path.join(dirB, 'media', 'sample_audio.mp3'), 3 * 1024 * 1024, audioSignature);

  console.log('📦 创建其他文件...');
  
  const randomBinary = crypto.randomBytes(100 * 1024);
  fs.writeFileSync(path.join(dirA, 'bin', 'data.bin'), randomBinary);
  fs.mkdirSync(path.join(dirA, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dirA, 'bin', 'data.bin'), randomBinary);
  fs.writeFileSync(path.join(dirB, 'bin', 'data.bin'), randomBinary);

  console.log('\n✅ 测试数据生成完成!');
  console.log(`\n📁 目录 A: ${dirA}`);
  console.log(`📁 目录 B: ${dirB}`);
  console.log('\n📊 文件统计:');
  
  function countFiles(dir: string): number {
    let count = 0;
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      if (file.isDirectory()) {
        count += countFiles(path.join(dir, file.name));
      } else {
        count++;
      }
    }
    return count;
  }
  
  console.log(`   目录 A 文件数: ${countFiles(dirA)}`);
  console.log(`   目录 B 文件数: ${countFiles(dirB)}`);
}

generateTestData().catch(console.error);
