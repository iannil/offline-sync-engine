/**
 * Compression service - data serialization and compression
 * @module compression
 */

import { encode, decode } from '@msgpack/msgpack';
import { deflate, inflate } from 'pako';

/**
 * Compression options
 */
export interface CompressionOptions {
  /**
   * Enable MessagePack binary encoding
   * @default true
   */
  useMessagePack?: boolean;

  /**
   * Enable DEFLATE compression
   * @default true
   */
  useCompression?: boolean;

  /**
   * Compression level (0-9)
   * @default 6
   */
  compressionLevel?: number;
}

/**
 * Default compression options
 */
const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  useMessagePack: true,
  useCompression: true,
  compressionLevel: 6,
};

/**
 * Compression statistics
 */
export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  encodingTime: number;
  decodingTime: number;
}

/**
 * Compression service class
 */
export class CompressionService {
  private options: Required<CompressionOptions>;
  private stats: CompressionStats[] = [];

  constructor(options: CompressionOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Encode and compress data
   */
  encode<T = unknown>(data: T): Uint8Array {
    const startTime = performance.now();

    let result: Uint8Array;

    if (this.options.useMessagePack) {
      // Use MessagePack for binary encoding
      result = encode(data);
    } else {
      // Fallback to JSON string
      const json = JSON.stringify(data);
      result = new TextEncoder().encode(json);
    }

    // Apply DEFLATE compression if enabled
    if (this.options.useCompression) {
      result = deflate(result, { level: this.options.compressionLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 });
    }

    const encodingTime = performance.now() - startTime;

    // Track statistics
    this.stats.push({
      originalSize: this.estimateSize(data),
      compressedSize: result.length,
      compressionRatio: result.length / this.estimateSize(data),
      encodingTime,
      decodingTime: 0,
    });

    return result;
  }

  /**
   * Decompress and decode data
   */
  decode<T = unknown>(data: Uint8Array): T {
    const startTime = performance.now();

    let result: Uint8Array = data;

    // Decompress if compression was used
    if (this.options.useCompression) {
      try {
        result = inflate(data);
      } catch (error) {
        console.warn('Failed to decompress, assuming uncompressed data');
        result = data;
      }
    }

    // Decode based on encoding method
    let decoded: T;
    if (this.options.useMessagePack) {
      decoded = decode(result) as T;
    } else {
      const json = new TextDecoder().decode(result);
      decoded = JSON.parse(json) as T;
    }

    const decodingTime = performance.now() - startTime;

    // Update statistics for last entry
    if (this.stats.length > 0) {
      this.stats[this.stats.length - 1].decodingTime = decodingTime;
    }

    return decoded;
  }

  /**
   * Encode to base64 string for transmission
   */
  encodeToBase64<T = unknown>(data: T): string {
    const bytes = this.encode(data);
    return this.uint8ArrayToBase64(bytes);
  }

  /**
   * Decode from base64 string
   */
  decodeFromBase64<T = unknown>(data: string): T {
    const bytes = this.base64ToUint8Array(data);
    return this.decode<T>(bytes);
  }

  /**
   * Create a content-type header value
   */
  getContentType(): string {
    const parts: string[] = [];

    if (this.options.useMessagePack) {
      parts.push('application/msgpack');
    } else {
      parts.push('application/json');
    }

    if (this.options.useCompression) {
      parts.push('deflate');
    }

    return parts.join('; ');
  }

  /**
   * Get compression statistics
   */
  getStats(): {
    count: number;
    avgCompressionRatio: number;
    avgEncodingTime: number;
    avgDecodingTime: number;
    totalOriginalSize: number;
    totalCompressedSize: number;
    savedBytes: number;
  } {
    if (this.stats.length === 0) {
      return {
        count: 0,
        avgCompressionRatio: 1,
        avgEncodingTime: 0,
        avgDecodingTime: 0,
        totalOriginalSize: 0,
        totalCompressedSize: 0,
        savedBytes: 0,
      };
    }

    const totalOriginalSize = this.stats.reduce(
      (sum, s) => sum + s.originalSize,
      0
    );
    const totalCompressedSize = this.stats.reduce(
      (sum, s) => sum + s.compressedSize,
      0
    );
    const avgCompressionRatio =
      this.stats.reduce((sum, s) => sum + s.compressionRatio, 0) /
      this.stats.length;
    const avgEncodingTime =
      this.stats.reduce((sum, s) => sum + s.encodingTime, 0) /
      this.stats.length;
    const avgDecodingTime =
      this.stats.reduce((sum, s) => sum + s.decodingTime, 0) /
      this.stats.length;

    return {
      count: this.stats.length,
      avgCompressionRatio,
      avgEncodingTime,
      avgDecodingTime,
      totalOriginalSize,
      totalCompressedSize,
      savedBytes: totalOriginalSize - totalCompressedSize,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = [];
  }

  /**
   * Estimate size of data in bytes (JSON representation)
   */
  private estimateSize(data: unknown): number {
    try {
      return new TextEncoder().encode(JSON.stringify(data)).length;
    } catch {
      return 0;
    }
  }

  /**
   * Convert Uint8Array to base64 string
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 string to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

/**
 * Default compression service instance
 */
let defaultService: CompressionService | null = null;

/**
 * Get or create the default compression service
 */
export function getCompressionService(
  options?: CompressionOptions
): CompressionService {
  if (!defaultService) {
    defaultService = new CompressionService(options);
  }
  return defaultService;
}

/**
 * Quick encode function
 */
export function compress<T = unknown>(data: T): Uint8Array {
  return getCompressionService().encode(data);
}

/**
 * Quick decode function
 */
export function decompress<T = unknown>(data: Uint8Array): T {
  return getCompressionService().decode<T>(data);
}

/**
 * Quick encode to base64
 */
export function compressToBase64<T = unknown>(data: T): string {
  return getCompressionService().encodeToBase64(data);
}

/**
 * Quick decode from base64
 */
export function decompressFromBase64<T = unknown>(data: string): T {
  return getCompressionService().decodeFromBase64<T>(data);
}
