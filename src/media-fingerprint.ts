import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import * as crypto from 'crypto';
import Jimp from 'jimp';

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.m4a'];

export interface MediaFingerprintOptions {
  videoFrameCount?: number;
  videoHashSize?: number;
  audioSampleSeconds?: number;
  audioWindowSize?: number;
  audioBins?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
}

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  codec: string;
}

export interface AudioInfo {
  duration: number;
  sampleRate: number;
  channels: number;
  codec: string;
}

export class MediaFingerprinter {
  private options: Required<MediaFingerprintOptions>;
  private ffmpegAvailable: boolean | null = null;

  constructor(options: MediaFingerprintOptions = {}) {
    this.options = {
      videoFrameCount: options.videoFrameCount || 5,
      videoHashSize: options.videoHashSize || 8,
      audioSampleSeconds: options.audioSampleSeconds || 30,
      audioWindowSize: options.audioWindowSize || 1024,
      audioBins: options.audioBins || 64,
      ffmpegPath: options.ffmpegPath || 'ffmpeg',
      ffprobePath: options.ffprobePath || 'ffprobe',
    };
  }

  isVideoFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return VIDEO_EXTENSIONS.includes(ext);
  }

  isAudioFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return AUDIO_EXTENSIONS.includes(ext);
  }

  isMediaFile(filePath: string): boolean {
    return this.isVideoFile(filePath) || this.isAudioFile(filePath);
  }

  getMediaType(filePath: string): 'video' | 'audio' | 'other' {
    if (this.isVideoFile(filePath)) return 'video';
    if (this.isAudioFile(filePath)) return 'audio';
    return 'other';
  }

  async checkFFmpeg(): Promise<boolean> {
    if (this.ffmpegAvailable !== null) {
      return this.ffmpegAvailable;
    }

    try {
      child_process.execSync(`${this.options.ffmpegPath} -version`, { stdio: 'ignore' });
      this.ffmpegAvailable = true;
    } catch {
      this.ffmpegAvailable = false;
    }

    return this.ffmpegAvailable;
  }

  private async execCommand(command: string, timeout: number = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      child_process.exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        clearTimeout(timer);
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  async getVideoInfo(filePath: string): Promise<VideoInfo | null> {
    try {
      const command = `${this.options.ffprobePath} -v quiet -print_format json -show_format -show_streams "${filePath}"`;
      const output = await this.execCommand(command);
      const data = JSON.parse(output);

      const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
      if (!videoStream) return null;

      return {
        duration: parseFloat(data.format?.duration || videoStream.duration || '0'),
        width: parseInt(videoStream.width || '0'),
        height: parseInt(videoStream.height || '0'),
        codec: videoStream.codec_name || 'unknown',
      };
    } catch (err) {
      console.warn(`Warning: Could not get video info for ${filePath}: ${(err as Error).message}`);
      return null;
    }
  }

  async getAudioInfo(filePath: string): Promise<AudioInfo | null> {
    try {
      const command = `${this.options.ffprobePath} -v quiet -print_format json -show_format -show_streams "${filePath}"`;
      const output = await this.execCommand(command);
      const data = JSON.parse(output);

      const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');
      if (!audioStream) return null;

      return {
        duration: parseFloat(data.format?.duration || audioStream.duration || '0'),
        sampleRate: parseInt(audioStream.sample_rate || '0'),
        channels: parseInt(audioStream.channels || '0'),
        codec: audioStream.codec_name || 'unknown',
      };
    } catch (err) {
      console.warn(`Warning: Could not get audio info for ${filePath}: ${(err as Error).message}`);
      return null;
    }
  }

  private async extractVideoFrame(filePath: string, timestamp: number, outputPath: string): Promise<boolean> {
    try {
      const command = `${this.options.ffmpegPath} -y -ss ${timestamp.toFixed(3)} -i "${filePath}" -vframes 1 -vf "scale=320:240" "${outputPath}"`;
      await this.execCommand(command, 15000);
      return fs.existsSync(outputPath);
    } catch (err) {
      console.warn(`Warning: Could not extract frame at ${timestamp}s from ${filePath}: ${(err as Error).message}`);
      return false;
    }
  }

  private async computeImageDHash(imagePath: string, hashSize: number = 8): Promise<string | null> {
    try {
      const image = await Jimp.read(imagePath);
      image.resize(hashSize + 1, hashSize).grayscale();

      const bits: string[] = [];
      for (let y = 0; y < hashSize; y++) {
        for (let x = 0; x < hashSize; x++) {
          const left = Jimp.intToRGBA(image.getPixelColor(x, y)).r;
          const right = Jimp.intToRGBA(image.getPixelColor(x + 1, y)).r;
          bits.push(left < right ? '1' : '0');
        }
      }

      return bits.join('');
    } catch (err) {
      console.warn(`Warning: Could not compute dHash for ${imagePath}: ${(err as Error).message}`);
      return null;
    }
  }

  async generateVideoFingerprint(filePath: string): Promise<string | null> {
    const ffmpegOk = await this.checkFFmpeg();
    if (!ffmpegOk) {
      console.warn('Warning: ffmpeg not available, skipping video fingerprinting');
      return null;
    }

    const videoInfo = await this.getVideoInfo(filePath);
    if (!videoInfo || videoInfo.duration <= 0) {
      return null;
    }

    const tempDir = fs.mkdtempSync(path.join(path.dirname(filePath), '.fprint-'));
    const frameCount = Math.min(this.options.videoFrameCount, Math.max(1, Math.floor(videoInfo.duration / 2)));
    const interval = videoInfo.duration / (frameCount + 1);

    const hashes: string[] = [];

    try {
      for (let i = 0; i < frameCount; i++) {
        const timestamp = interval * (i + 1);
        const framePath = path.join(tempDir, `frame-${i}.jpg`);

        if (await this.extractVideoFrame(filePath, timestamp, framePath)) {
          const hash = await this.computeImageDHash(framePath, this.options.videoHashSize);
          if (hash) {
            hashes.push(hash);
          }
        }

        if (fs.existsSync(framePath)) {
          fs.unlinkSync(framePath);
        }
      }
    } finally {
      try {
        fs.rmdirSync(tempDir);
      } catch {
      }
    }

    if (hashes.length === 0) {
      return null;
    }

    const fullHash = hashes.join('');
    const hashSum = crypto.createHash('sha256').update(fullHash).digest('hex');
    
    return `v1:${frameCount}:${fullHash}:${hashSum.slice(0, 16)}`;
  }

  private async extractAudioSamples(filePath: string, duration: number): Promise<Buffer | null> {
    try {
      const tempFile = path.join(path.dirname(filePath), `.audio-${Date.now()}.raw`);
      
      const command = `${this.options.ffmpegPath} -y -i "${filePath}" -t ${duration} -f s16le -ac 1 -ar 44100 "${tempFile}"`;
      await this.execCommand(command, 30000);

      if (!fs.existsSync(tempFile)) {
        return null;
      }

      const data = fs.readFileSync(tempFile);
      fs.unlinkSync(tempFile);

      return data;
    } catch (err) {
      console.warn(`Warning: Could not extract audio samples from ${filePath}: ${(err as Error).message}`);
      return null;
    }
  }

  private computeEnergySpectrum(samples: Int16Array, windowSize: number, bins: number): string {
    const numWindows = Math.floor(samples.length / windowSize);
    const binSize = Math.floor(windowSize / 2 / bins);
    const signatures: number[] = [];

    for (let w = 0; w < numWindows; w++) {
      const start = w * windowSize;
      const windowSamples = samples.slice(start, start + windowSize);

      const energies: number[] = [];
      for (let b = 0; b < bins; b++) {
        let energy = 0;
        const binStart = b * binSize * 2;
        const binEnd = Math.min(binStart + binSize * 2, windowSize);
        
        for (let i = binStart; i < binEnd; i += 2) {
          const sample = windowSamples[i] || 0;
          energy += Math.abs(sample);
        }
        energies.push(energy / Math.max(1, binEnd - binStart));
      }

      const avgEnergy = energies.reduce((a, b) => a + b, 0) / energies.length;
      const signatureBits = energies.map(e => e >= avgEnergy ? '1' : '0').join('');
      signatures.push(parseInt(signatureBits, 2));
    }

    const binsPerWindow = 4;
    const compressedSignatures: number[] = [];
    for (let i = 0; i < signatures.length; i += binsPerWindow) {
      const group = signatures.slice(i, i + binsPerWindow);
      const avg = group.reduce((a, b) => a + b, 0) / group.length;
      compressedSignatures.push(Math.round(avg));
    }

    const finalBits = compressedSignatures
      .map(s => s.toString(2).padStart(bins, '0'))
      .join('');

    return finalBits;
  }

  async generateAudioFingerprint(filePath: string): Promise<string | null> {
    const ffmpegOk = await this.checkFFmpeg();
    if (!ffmpegOk) {
      console.warn('Warning: ffmpeg not available, skipping audio fingerprinting');
      return null;
    }

    const audioInfo = await this.getAudioInfo(filePath);
    if (!audioInfo || audioInfo.duration <= 0) {
      return null;
    }

    const sampleDuration = Math.min(this.options.audioSampleSeconds, audioInfo.duration);
    const rawData = await this.extractAudioSamples(filePath, sampleDuration);
    
    if (!rawData || rawData.length < this.options.audioWindowSize) {
      return null;
    }

    const samples = new Int16Array(rawData.buffer, rawData.byteOffset, rawData.length / 2);
    const fingerprint = this.computeEnergySpectrum(samples, this.options.audioWindowSize, this.options.audioBins);

    const hashSum = crypto.createHash('sha256').update(fingerprint).digest('hex');
    return `a1:${this.options.audioBins}:${fingerprint}:${hashSum.slice(0, 16)}`;
  }

  async generateMediaFingerprint(filePath: string): Promise<{ type: 'video' | 'audio' | 'other'; fingerprint: string | null }> {
    const mediaType = this.getMediaType(filePath);
    
    if (mediaType === 'video') {
      return { type: 'video', fingerprint: await this.generateVideoFingerprint(filePath) };
    } else if (mediaType === 'audio') {
      return { type: 'audio', fingerprint: await this.generateAudioFingerprint(filePath) };
    }
    
    return { type: 'other', fingerprint: null };
  }

  hammingDistance(hash1: string, hash2: string): number {
    const parseHash = (h: string) => {
      const parts = h.split(':');
      return parts.length >= 3 ? parts[2] : h;
    };

    const h1 = parseHash(hash1);
    const h2 = parseHash(hash2);

    let distance = 0;
    const minLen = Math.min(h1.length, h2.length);
    
    for (let i = 0; i < minLen; i++) {
      if (h1[i] !== h2[i]) {
        distance++;
      }
    }

    distance += Math.abs(h1.length - h2.length);
    return distance;
  }

  normalizedHammingDistance(hash1: string, hash2: string): number {
    const parseHash = (h: string) => {
      const parts = h.split(':');
      return parts.length >= 3 ? parts[2] : h;
    };

    const h1 = parseHash(hash1);
    const h2 = parseHash(hash2);

    if (h1.length === 0 || h2.length === 0) {
      return 1.0;
    }

    const maxLen = Math.max(h1.length, h2.length);
    const distance = this.hammingDistance(h1, h2);
    return distance / maxLen;
  }

  computeMediaSimilarity(fingerprint1: string, fingerprint2: string): number {
    const normalizedDistance = this.normalizedHammingDistance(fingerprint1, fingerprint2);
    return Math.max(0, 1 - normalizedDistance);
  }

  async computeMediaSimilarityFromFiles(file1: string, file2: string): Promise<{ similarity: number; mediaType: 'video' | 'audio' } | null> {
    const type1 = this.getMediaType(file1);
    const type2 = this.getMediaType(file2);

    if (type1 !== type2 || type1 === 'other') {
      return null;
    }

    const [fp1, fp2] = await Promise.all([
      this.generateMediaFingerprint(file1),
      this.generateMediaFingerprint(file2),
    ]);

    if (!fp1.fingerprint || !fp2.fingerprint) {
      return null;
    }

    const similarity = this.computeMediaSimilarity(fp1.fingerprint, fp2.fingerprint);
    return { similarity, mediaType: type1 };
  }
}

export const DEFAULT_VIDEO_EXTENSIONS = VIDEO_EXTENSIONS;
export const DEFAULT_AUDIO_EXTENSIONS = AUDIO_EXTENSIONS;
