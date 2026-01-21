/**
 * Compression service unit tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CompressionService,
  compress,
  decompress,
  compressToBase64,
  decompressFromBase64,
  getCompressionService,
} from '../compression.js';

describe('CompressionService', () => {
  let service: CompressionService;

  beforeEach(() => {
    service = new CompressionService();
  });

  describe('encode/decode', () => {
    it('should encode and decode simple objects', () => {
      const data = { name: 'test', value: 123 };
      const encoded = service.encode(data);
      const decoded = service.decode(encoded);

      expect(decoded).toEqual(data);
    });

    it('should encode and decode arrays', () => {
      const data = [1, 2, 3, 'a', 'b', 'c'];
      const encoded = service.encode(data);
      const decoded = service.decode(encoded);

      expect(decoded).toEqual(data);
    });

    it('should encode and decode nested objects', () => {
      const data = {
        user: {
          name: 'John',
          age: 30,
          addresses: [
            { city: 'NYC', zip: '10001' },
            { city: 'LA', zip: '90001' },
          ],
        },
      };
      const encoded = service.encode(data);
      const decoded = service.decode(encoded);

      expect(decoded).toEqual(data);
    });

    it('should handle null and undefined values', () => {
      const data = { a: null, b: undefined };
      const encoded = service.encode(data);
      const decoded = service.decode<{ a: null; b: undefined }>(encoded);

      expect(decoded.a).toBeNull();
      // undefined is not preserved in JSON/MessagePack
    });

    it('should handle empty objects and arrays', () => {
      expect(service.decode(service.encode({}))).toEqual({});
      expect(service.decode(service.encode([]))).toEqual([]);
    });

    it('should handle strings', () => {
      const data = 'Hello, World!';
      const encoded = service.encode(data);
      const decoded = service.decode(encoded);

      expect(decoded).toBe(data);
    });

    it('should handle numbers', () => {
      expect(service.decode(service.encode(42))).toBe(42);
      expect(service.decode(service.encode(3.14))).toBe(3.14);
      expect(service.decode(service.encode(-100))).toBe(-100);
    });

    it('should handle boolean values', () => {
      expect(service.decode(service.encode(true))).toBe(true);
      expect(service.decode(service.encode(false))).toBe(false);
    });

    it('should reduce data size with compression', () => {
      const largeData = {
        items: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          description: 'This is a repeated description to test compression efficiency.',
        })),
      };

      const jsonSize = JSON.stringify(largeData).length;
      const encoded = service.encode(largeData);

      // Compressed size should be significantly smaller
      expect(encoded.length).toBeLessThan(jsonSize);
    });
  });

  describe('encodeToBase64/decodeFromBase64', () => {
    it('should encode and decode to/from base64', () => {
      const data = { test: 'value', num: 123 };
      const base64 = service.encodeToBase64(data);
      const decoded = service.decodeFromBase64(base64);

      expect(typeof base64).toBe('string');
      expect(decoded).toEqual(data);
    });

    it('should produce valid base64 strings', () => {
      const data = { hello: 'world' };
      const base64 = service.encodeToBase64(data);

      // Valid base64 pattern
      expect(base64).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    });
  });

  describe('options', () => {
    it('should work without MessagePack (JSON only)', () => {
      const jsonService = new CompressionService({
        useMessagePack: false,
        useCompression: true,
      });

      const data = { test: 'value' };
      const encoded = jsonService.encode(data);
      const decoded = jsonService.decode(encoded);

      expect(decoded).toEqual(data);
    });

    it('should work without compression (MessagePack only)', () => {
      const noCompressService = new CompressionService({
        useMessagePack: true,
        useCompression: false,
      });

      const data = { test: 'value' };
      const encoded = noCompressService.encode(data);
      const decoded = noCompressService.decode(encoded);

      expect(decoded).toEqual(data);
    });

    it('should work with neither MessagePack nor compression', () => {
      const rawService = new CompressionService({
        useMessagePack: false,
        useCompression: false,
      });

      const data = { test: 'value' };
      const encoded = rawService.encode(data);
      const decoded = rawService.decode(encoded);

      expect(decoded).toEqual(data);
    });

    it('should respect compression level', () => {
      const lowCompress = new CompressionService({ compressionLevel: 1 });
      const highCompress = new CompressionService({ compressionLevel: 9 });

      const data = { items: Array(100).fill('repeated string for compression test') };

      const lowEncoded = lowCompress.encode(data);
      const highEncoded = highCompress.encode(data);

      // Higher compression level should produce smaller output
      expect(highEncoded.length).toBeLessThanOrEqual(lowEncoded.length);
    });
  });

  describe('getContentType', () => {
    it('should return correct content type for default options', () => {
      expect(service.getContentType()).toBe('application/msgpack; deflate');
    });

    it('should return correct content type for JSON', () => {
      const jsonService = new CompressionService({
        useMessagePack: false,
        useCompression: true,
      });
      expect(jsonService.getContentType()).toBe('application/json; deflate');
    });

    it('should return correct content type without compression', () => {
      const noCompressService = new CompressionService({
        useMessagePack: true,
        useCompression: false,
      });
      expect(noCompressService.getContentType()).toBe('application/msgpack');
    });
  });

  describe('statistics', () => {
    it('should track compression statistics', () => {
      const data = { test: 'value' };
      service.encode(data);

      const stats = service.getStats();

      expect(stats.count).toBe(1);
      expect(stats.totalOriginalSize).toBeGreaterThan(0);
      expect(stats.totalCompressedSize).toBeGreaterThan(0);
      expect(stats.avgEncodingTime).toBeGreaterThanOrEqual(0);
    });

    it('should accumulate statistics over multiple operations', () => {
      service.encode({ a: 1 });
      service.encode({ b: 2 });
      service.encode({ c: 3 });

      const stats = service.getStats();

      expect(stats.count).toBe(3);
    });

    it('should reset statistics', () => {
      service.encode({ test: 'data' });
      expect(service.getStats().count).toBe(1);

      service.resetStats();
      expect(service.getStats().count).toBe(0);
    });

    it('should calculate compression ratio', () => {
      const largeData = { items: Array(100).fill('repeated') };
      service.encode(largeData);

      const stats = service.getStats();

      // Compression ratio should be less than 1 (compressed is smaller)
      expect(stats.avgCompressionRatio).toBeLessThan(1);
    });

    it('should calculate saved bytes', () => {
      const largeData = { items: Array(100).fill('repeated string') };
      service.encode(largeData);

      const stats = service.getStats();

      expect(stats.savedBytes).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle unicode strings', () => {
      const data = { message: '你好，世界！🌍' };
      const encoded = service.encode(data);
      const decoded = service.decode<typeof data>(encoded);

      expect(decoded.message).toBe('你好，世界！🌍');
    });

    it('should handle large numbers', () => {
      const data = { big: Number.MAX_SAFE_INTEGER };
      const encoded = service.encode(data);
      const decoded = service.decode<typeof data>(encoded);

      expect(decoded.big).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should handle dates as strings or numbers', () => {
      const date = new Date().toISOString();
      const data = { date };
      const encoded = service.encode(data);
      const decoded = service.decode<typeof data>(encoded);

      expect(decoded.date).toBe(date);
    });
  });
});

describe('Quick functions', () => {
  it('compress/decompress should work', () => {
    const data = { test: 'value' };
    const compressed = compress(data);
    const decompressed = decompress<typeof data>(compressed);

    expect(decompressed).toEqual(data);
  });

  it('compressToBase64/decompressFromBase64 should work', () => {
    const data = { test: 'value' };
    const base64 = compressToBase64(data);
    const decompressed = decompressFromBase64<typeof data>(base64);

    expect(decompressed).toEqual(data);
  });

  it('getCompressionService should return singleton', () => {
    const service1 = getCompressionService();
    const service2 = getCompressionService();

    expect(service1).toBe(service2);
  });
});
