/**
 * TUS protocol server unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerTusRoutes, cleanupExpiredUploads, clearUploads } from '../index.js';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 0 }),
  open: vi.fn().mockResolvedValue({
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

describe('TUS Protocol', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    clearUploads(); // Clear uploads between tests

    // Create Fastify instance
    fastify = Fastify();

    // Register routes
    await fastify.register(registerTusRoutes);

    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  describe('POST /api/tus (Create Upload)', () => {
    it('should create new upload with valid headers', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/tus',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Length': '1024',
          'Upload-Metadata': 'filename dGVzdC50eHQ=', // base64 for 'test.txt'
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.headers['tus-resumable']).toBe('1.0.0');
      expect(response.headers['location']).toContain('/api/tus/');
    });

    it('should reject missing Tus-Resumable header', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/tus',
        headers: {
          'Upload-Length': '1024',
        },
      });

      expect(response.statusCode).toBe(412);
      expect(response.headers['tus-resumable']).toBe('1.0.0');
    });

    it('should reject missing Upload-Length without Upload-Defer-Length', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/tus',
        headers: {
          'Tus-Resumable': '1.0.0',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should accept Upload-Defer-Length header', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/tus',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Defer-Length': '1',
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it('should decode metadata correctly', async () => {
      const filename = Buffer.from('document.pdf').toString('base64');
      const contentType = Buffer.from('application/pdf').toString('base64');

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/tus',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Length': '1024',
          'Upload-Metadata': `filename ${filename},contentType ${contentType}`,
        },
      });

      expect(response.statusCode).toBe(201);
    });
  });

  describe('HEAD /api/tus/:id (Get Upload Info)', () => {
    let uploadId: string;

    beforeEach(async () => {
      // Create an upload first
      const createResponse = await fastify.inject({
        method: 'POST',
        url: '/api/tus',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Length': '1024',
        },
      });

      // Extract upload ID from Location header
      const location = createResponse.headers['location'] as string;
      uploadId = location.split('/').pop()!;
    });

    it('should return upload info', async () => {
      const response = await fastify.inject({
        method: 'HEAD',
        url: `/api/tus/${uploadId}`,
        headers: {
          'Tus-Resumable': '1.0.0',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['upload-offset']).toBe('0');
      expect(response.headers['upload-length']).toBe('1024');
      expect(response.headers['tus-resumable']).toBe('1.0.0');
    });

    it('should return 404 for non-existent upload', async () => {
      const response = await fastify.inject({
        method: 'HEAD',
        url: '/api/tus/non-existent-id',
        headers: {
          'Tus-Resumable': '1.0.0',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject missing Tus-Resumable header', async () => {
      const response = await fastify.inject({
        method: 'HEAD',
        url: `/api/tus/${uploadId}`,
      });

      expect(response.statusCode).toBe(412);
    });
  });

  describe('PATCH /api/tus/:id (Upload Chunk)', () => {
    let uploadId: string;

    beforeEach(async () => {
      // Create an upload first
      const createResponse = await fastify.inject({
        method: 'POST',
        url: '/api/tus',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Length': '1024',
        },
      });

      const location = createResponse.headers['location'] as string;
      uploadId = location.split('/').pop()!;
    });

    it('should reject missing Tus-Resumable header', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: `/api/tus/${uploadId}`,
        headers: {
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': '0',
        },
        payload: Buffer.alloc(100),
      });

      expect(response.statusCode).toBe(412);
    });

    it('should reject invalid Content-Type', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: `/api/tus/${uploadId}`,
        headers: {
          'Tus-Resumable': '1.0.0',
          'Content-Type': 'text/plain', // Use a Content-Type without built-in parser
          'Upload-Offset': '0',
        },
        payload: 'test data',
      });

      expect(response.statusCode).toBe(415);
    });

    it('should reject missing Upload-Offset header', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: `/api/tus/${uploadId}`,
        headers: {
          'Tus-Resumable': '1.0.0',
          'Content-Type': 'application/offset+octet-stream',
        },
        payload: Buffer.alloc(100),
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 for non-existent upload', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: '/api/tus/non-existent-id',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': '0',
        },
        payload: Buffer.alloc(100),
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject offset mismatch', async () => {
      const response = await fastify.inject({
        method: 'PATCH',
        url: `/api/tus/${uploadId}`,
        headers: {
          'Tus-Resumable': '1.0.0',
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': '100', // Should be 0
        },
        payload: Buffer.alloc(100),
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('DELETE /api/tus/:id (Cancel Upload)', () => {
    let uploadId: string;

    beforeEach(async () => {
      // Create an upload first
      const createResponse = await fastify.inject({
        method: 'POST',
        url: '/api/tus',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Length': '1024',
        },
      });

      const location = createResponse.headers['location'] as string;
      uploadId = location.split('/').pop()!;
    });

    it('should delete upload', async () => {
      const response = await fastify.inject({
        method: 'DELETE',
        url: `/api/tus/${uploadId}`,
        headers: {
          'Tus-Resumable': '1.0.0',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['tus-resumable']).toBe('1.0.0');

      // Verify upload is deleted
      const headResponse = await fastify.inject({
        method: 'HEAD',
        url: `/api/tus/${uploadId}`,
        headers: {
          'Tus-Resumable': '1.0.0',
        },
      });

      expect(headResponse.statusCode).toBe(404);
    });

    it('should return 404 for non-existent upload', async () => {
      const response = await fastify.inject({
        method: 'DELETE',
        url: '/api/tus/non-existent-id',
        headers: {
          'Tus-Resumable': '1.0.0',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject missing Tus-Resumable header', async () => {
      const response = await fastify.inject({
        method: 'DELETE',
        url: `/api/tus/${uploadId}`,
      });

      expect(response.statusCode).toBe(412);
    });
  });

  describe('GET /api/tus/:id (Get Upload Status)', () => {
    let uploadId: string;

    beforeEach(async () => {
      // Create an upload first
      const createResponse = await fastify.inject({
        method: 'POST',
        url: '/api/tus',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Length': '1024',
          'Upload-Metadata': 'filename dGVzdC50eHQ=',
        },
      });

      const location = createResponse.headers['location'] as string;
      uploadId = location.split('/').pop()!;
    });

    it('should return upload status', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: `/api/tus/${uploadId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(uploadId);
      expect(body.size).toBe(1024);
      expect(body.offset).toBe(0);
      expect(body.isComplete).toBe(false);
      expect(body.progress).toBe(0);
    });

    it('should return 404 for non-existent upload', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/tus/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/tus (List Uploads)', () => {
    it('should list all uploads', async () => {
      // Create two uploads
      await fastify.inject({
        method: 'POST',
        url: '/api/tus',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Length': '1024',
        },
      });

      await fastify.inject({
        method: 'POST',
        url: '/api/tus',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Length': '2048',
        },
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/tus',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.uploads).toHaveLength(2);
      expect(body.count).toBe(2);
    });
  });
});

describe('cleanupExpiredUploads', () => {
  it('should not throw when called', () => {
    expect(() => cleanupExpiredUploads()).not.toThrow();
  });
});
