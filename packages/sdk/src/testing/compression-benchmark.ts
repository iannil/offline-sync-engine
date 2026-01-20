/**
 * Compression performance benchmarks
 * @module compression-benchmark
 */

import {
  CompressionService,
  compress,
  decompress,
  compressToBase64,
  decompressFromBase64,
} from '../storage/compression.js';

/**
 * Compression benchmark result
 */
export interface CompressionBenchmarkResult {
  name: string;
  iterations: number;
  totalBytes: number;
  compressedBytes: number;
  compressionRatio: number;
  avgEncodeTime: number;
  avgDecodeTime: number;
  throughputMBps: {
    encode: number;
    decode: number;
  };
}

/**
 * Test data generators
 */
export const TestDataGenerators = {
  /**
   * Generate simple JSON object
   */
  simpleObject(): Record<string, unknown> {
    return {
      id: '1234567890',
      name: 'Test Item',
      value: 42,
      active: true,
      tags: ['test', 'benchmark', 'compression'],
      createdAt: new Date().toISOString(),
    };
  },

  /**
   * Generate array of objects (typical sync data)
   */
  syncActions(count: number = 100): Array<Record<string, unknown>> {
    const actions = [];

    for (let i = 0; i < count; i++) {
      actions.push({
        id: `action-${i}`,
        type: ['CREATE', 'UPDATE', 'DELETE'][i % 3],
        collection: 'todos',
        documentId: `todo-${i}`,
        data: {
          id: `todo-${i}`,
          text: `Todo item number ${i} with some text`,
          completed: i % 2 === 0,
          priority: i % 5,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        timestamp: Date.now() + i,
      });
    }

    return actions;
  },

  /**
   * Generate document update payload
   */
  documentUpdate(): Record<string, unknown> {
    return {
      actions: this.syncActions(50),
      since: '1234567890-g1a2b3c4d5e6f7g8h9i0j1',
    };
  },

  /**
   * Generate large text data
   */
  largeText(size: number = 10000): string {
    const words = [
      'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur',
      'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor',
      'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna',
      'aliqua', 'ut', 'enim', 'ad', 'minim', 'veniam'
    ];

    let text = '';
    for (let i = 0; i < size; i++) {
      text += words[i % words.length] + ' ';
      if (i % 20 === 0) text += '. ';
    }
    return text;
  },

  /**
   * Generate nested object structure
   */
  nestedObject(depth: number = 5, breadth: number = 5): Record<string, unknown> {
    if (depth === 0) {
      return { value: 'leaf' };
    }

    const obj: Record<string, unknown> = {};

    for (let i = 0; i < breadth; i++) {
      obj[`field_${i}`] = this.nestedObject(depth - 1, breadth);
    }

    return obj;
  },

  /**
   * Generate realistic todo collection data
   */
  todoCollection(count: number = 100): Array<Record<string, unknown>> {
    const todos = [];

    for (let i = 0; i < count; i++) {
      todos.push({
        id: `todo-${i}`,
        text: `Todo item ${i}: ${this.largeText(Math.floor(Math.random() * 20))}`,
        completed: i % 3 === 0,
        priority: ['low', 'medium', 'high'][i % 3],
        dueDate: i % 5 === 0 ? new Date(Date.now() + i * 86400000).toISOString() : null,
        tags: ['work', 'personal', 'urgent', 'backlog'].slice(0, (i % 4) + 1),
        metadata: {
          created: new Date(Date.now() - i * 3600000).toISOString(),
          modified: new Date().toISOString(),
          version: i,
        },
      });
    }

    return todos;
  },
};

/**
 * Compression benchmark runner
 */
export class CompressionBenchmark {
  private compression: CompressionService;

  constructor(options?: {
    useMessagePack?: boolean;
    useCompression?: boolean;
    compressionLevel?: number;
  }) {
    this.compression = new CompressionService(options);
  }

  /**
   * Run a single benchmark
   */
  async benchmark(
    name: string,
    data: unknown,
    iterations: number = 100
  ): Promise<CompressionBenchmarkResult> {
    this.compression.resetStats();

    // Warm up
    for (let i = 0; i < 5; i++) {
      const encoded = this.compression.encode(data);
      this.compression.decode(encoded);
    }

    this.compression.resetStats();

    // Measure encoding
    const encodeStart = performance.now();
    let encoded: Uint8Array | null = null;

    for (let i = 0; i < iterations; i++) {
      encoded = this.compression.encode(data);
    }

    const encodeEnd = performance.now();

    // Measure decoding
    const decodeStart = performance.now();

    for (let i = 0; i < iterations; i++) {
      this.compression.decode(encoded!);
    }

    const decodeEnd = performance.now();

    // Calculate statistics
    const stats = this.compression.getStats();
    const originalSize = JSON.stringify(data).length;
    const compressedSize = encoded!.length;

    return {
      name,
      iterations,
      totalBytes: originalSize * iterations,
      compressedBytes: compressedSize * iterations,
      compressionRatio: compressedSize / originalSize,
      avgEncodeTime: (encodeEnd - encodeStart) / iterations,
      avgDecodeTime: (decodeEnd - decodeStart) / iterations,
      throughputMBps: {
        encode: (originalSize / 1024 / 1024) / ((encodeEnd - encodeStart) / iterations / 1000),
        decode: (originalSize / 1024 / 1024) / ((decodeEnd - decodeStart) / iterations / 1000),
      },
    };
  }

  /**
   * Run all benchmarks
   */
  async runAll(): Promise<CompressionBenchmarkResult[]> {
    const results: CompressionBenchmarkResult[] = [];

    // Benchmark 1: Simple object
    results.push(
      await this.benchmark(
        'Simple Object',
        TestDataGenerators.simpleObject(),
        1000
      )
    );

    // Benchmark 2: Sync actions (typical use case)
    results.push(
      await this.benchmark(
        'Sync Actions (100 items)',
        TestDataGenerators.syncActions(100),
        100
      )
    );

    // Benchmark 3: Document update payload
    results.push(
      await this.benchmark(
        'Document Update',
        TestDataGenerators.documentUpdate(),
        50
      )
    );

    // Benchmark 4: Large text
    results.push(
      await this.benchmark(
        'Large Text (10KB)',
        TestDataGenerators.largeText(10000),
        50
      )
    );

    // Benchmark 5: Todo collection
    results.push(
      await this.benchmark(
        'Todo Collection (100 items)',
        TestDataGenerators.todoCollection(100),
        20
      )
    );

    return results;
  }

  /**
   * Compare compression settings
   */
  async compareCompressionLevels(): Promise<CompressionBenchmarkResult[]> {
    const levels = [1, 3, 6, 9];
    const results: CompressionBenchmarkResult[] = [];
    const testData = TestDataGenerators.documentUpdate();

    for (const level of levels) {
      const benchmark = new CompressionBenchmark({
        useMessagePack: true,
        useCompression: true,
        compressionLevel: level,
      });

      const result = await benchmark.benchmark(
        `Compression Level ${level}`,
        testData,
        50
      );

      results.push(result);
    }

    return results;
  }

  /**
   * Compare MessagePack vs JSON
   */
  async compareFormats(): Promise<{
    messagePack: CompressionBenchmarkResult;
    json: CompressionBenchmarkResult;
  }> {
    const testData = TestDataGenerators.documentUpdate();

    const msgpackBenchmark = new CompressionBenchmark({
      useMessagePack: true,
      useCompression: true,
    });

    const jsonBenchmark = new CompressionBenchmark({
      useMessagePack: false,
      useCompression: true,
    });

    return {
      messagePack: await msgpackBenchmark.benchmark('MessagePack + DEFLATE', testData, 50),
      json: await jsonBenchmark.benchmark('JSON + DEFLATE', testData, 50),
    };
  }
}

/**
 * Quick benchmark function
 */
export async function runCompressionBenchmark(): Promise<{
  results: CompressionBenchmarkResult[];
  summary: {
    avgCompressionRatio: number;
    avgEncodeTime: number;
    avgDecodeTime: number;
    totalDataSaved: number;
  };
}> {
  const benchmark = new CompressionBenchmark({
    useMessagePack: true,
    useCompression: true,
    compressionLevel: 6,
  });

  const results = await benchmark.runAll();

  const summary = {
    avgCompressionRatio: results.reduce((sum, r) => sum + r.compressionRatio, 0) / results.length,
    avgEncodeTime: results.reduce((sum, r) => sum + r.avgEncodeTime, 0) / results.length,
    avgDecodeTime: results.reduce((sum, r) => sum + r.avgDecodeTime, 0) / results.length,
    totalDataSaved: results.reduce((sum, r) => sum + (r.totalBytes - r.compressedBytes), 0),
  };

  return { results, summary };
}

/**
 * Format benchmark results as table
 */
export function formatCompressionBenchmarkResults(results: CompressionBenchmarkResult[]): string {
  const lines: string[] = [];

  lines.push('Compression Benchmark Results');
  lines.push('='.repeat(100));
  lines.push('');

  // Header
  lines.push(
    padRight('Test Name', 30) +
    padRight('Iter', 8) +
    padRight('Ratio', 10) +
    padRight('Encode', 12) +
    padRight('Decode', 12) +
    'Throughput (MB/s)'
  );
  lines.push('-'.repeat(100));

  // Results
  for (const result of results) {
    lines.push(
      padRight(result.name, 30) +
      padRight(String(result.iterations), 8) +
      padRight(result.compressionRatio.toFixed(2) + 'x', 10) +
      padRight(result.avgEncodeTime.toFixed(2) + 'ms', 12) +
      padRight(result.avgDecodeTime.toFixed(2) + 'ms', 12) +
      `E: ${result.throughputMBps.encode.toFixed(2)} / D: ${result.throughputMBps.decode.toFixed(2)}`
    );
  }

  lines.push('');
  lines.push('Ratio = compressed / original (lower is better)');
  lines.push('Throughput shown for both Encode (E) and Decode (D)');

  return lines.join('\n');
}

function padRight(str: string, length: number): string {
  return str.padEnd(length);
}
