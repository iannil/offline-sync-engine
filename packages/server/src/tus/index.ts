/**
 * TUS Protocol Server Implementation
 * @module tus
 *
 * Implements the TUS protocol v1.0.0 for resumable uploads on the server
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TUS upload metadata
 */
interface TusUpload {
  id: string;
  uploadUrl: string;
  size: number;
  offset: number;
  metadata: Record<string, string>;
  createdAt: number;
  fileExtension?: string;
}

/**
 * In-memory upload storage (in production, use Redis or database)
 */
const uploads = new Map<string, TusUpload>();

/**
 * Upload directory for temporary files
 */
const UPLOAD_DIR = process.env.TUS_UPLOAD_DIR || '/tmp/tus-uploads';

/**
 * Ensure upload directory exists
 */
async function ensureUploadDir(): Promise<void> {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * Decode TUS metadata
 */
function decodeMetadata(metadataHeader?: string): Record<string, string> {
  if (!metadataHeader) return {};

  const metadata: Record<string, string> = {};

  for (const part of metadataHeader.split(',')) {
    const [key, base64Value] = part.split(' ');
    if (key && base64Value) {
      try {
        metadata[key] = Buffer.from(base64Value, 'base64').toString('utf-8');
      } catch {
        // Ignore invalid base64
      }
    }
  }

  return metadata;
}

/**
 * Extract file extension from metadata
 */
function extractFileExtension(metadata: Record<string, string>): string {
  const filename = metadata.filename || metadata.name;
  if (filename) {
    const ext = filename.split('.').pop();
    if (ext && ext !== filename) {
      return `.${ext}`;
    }
  }
  const contentType = metadata.type || metadata.contentType;
  if (contentType) {
    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'application/json': '.json',
    };
    return extMap[contentType] || '';
  }
  return '';
}

/**
 * Clear all uploads (for testing)
 */
export function clearUploads(): void {
  uploads.clear();
}

/**
 * Clean up expired uploads (older than 24 hours)
 */
export function cleanupExpiredUploads(): void {
  const expiry = Date.now() - 24 * 60 * 60 * 1000;

  for (const [id, upload] of uploads.entries()) {
    if (upload.createdAt < expiry) {
      uploads.delete(id);

      // Delete temporary file
      const filePath = join(UPLOAD_DIR, `${id}${upload.fileExtension || ''}`);
      unlink(filePath).catch(() => {
        // Ignore errors
      });
    }
  }
}

/**
 * Get upload by URL
 */
function getUploadByUrl(uploadUrl: string): TusUpload | undefined {
  for (const upload of uploads.values()) {
    if (upload.uploadUrl === uploadUrl) {
      return upload;
    }
  }
  return undefined;
}

/**
 * Register TUS protocol routes
 */
export async function registerTusRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
) {
  // Ensure upload directory exists
  await ensureUploadDir();

  // Add content-type parser for TUS protocol
  fastify.addContentTypeParser(
    'application/offset+octet-stream',
    { parseAs: 'buffer' },
    (request, payload, done) => {
      done(null, payload);
    }
  );

  // Start cleanup interval
  const cleanupInterval = setInterval(cleanupExpiredUploads, 60 * 60 * 1000);

  fastify.addHook('onClose', () => {
    clearInterval(cleanupInterval);
  });

  /**
   * POST /api/tus - Create new upload
   */
  fastify.post('/api/tus', async (request, reply) => {
    const uploadLength = request.headers['upload-length'];
    const uploadMetadata = request.headers['upload-metadata'] as string;
    const uploadDeferLength = request.headers['upload-defer-length'];

    // Validate headers
    if (request.headers['tus-resumable'] !== '1.0.0') {
      reply.code(412);
      reply.header('Tus-Resumable', '1.0.0');
      return { error: 'Missing Tus-Resumable header' };
    }

    if (!uploadLength && !uploadDeferLength) {
      reply.code(400);
      return { error: 'Missing Upload-Length header' };
    }

    const size = uploadLength ? parseInt(uploadLength, 10) : 0;
    const metadata = decodeMetadata(uploadMetadata);
    const fileExtension = extractFileExtension(metadata);

    // Create upload record
    const id = randomUUID();
    const uploadUrl = `${request.headers.origin || 'http://localhost:3000'}/api/tus/${id}`;

    const upload: TusUpload = {
      id,
      uploadUrl,
      size,
      offset: 0,
      metadata,
      createdAt: Date.now(),
      fileExtension,
    };

    uploads.set(id, upload);

    // Create empty file
    const filePath = join(UPLOAD_DIR, `${id}${fileExtension}`);
    await writeFile(filePath, Buffer.alloc(0));

    reply.code(201);
    reply.header('Tus-Resumable', '1.0.0');
    reply.header('Location', uploadUrl);
    reply.header('Upload-Expires', new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString());

    return;
  });

  /**
   * HEAD /api/tus/:id - Get upload info
   */
  fastify.head('/api/tus/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (request.headers['tus-resumable'] !== '1.0.0') {
      reply.code(412);
      reply.header('Tus-Resumable', '1.0.0');
      return;
    }

    const upload = uploads.get(id);
    if (!upload) {
      reply.code(404);
      reply.header('Tus-Resumable', '1.0.0');
      return;
    }

    reply.header('Tus-Resumable', '1.0.0');
    reply.header('Upload-Offset', String(upload.offset));
    reply.header('Upload-Length', String(upload.size));
    reply.header('Cache-Control', 'no-store');

    return;
  });

  /**
   * PATCH /api/tus/:id - Upload chunk
   */
  fastify.patch('/api/tus/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const uploadOffset = request.headers['upload-offset'];
    const contentType = request.headers['content-type'];

    // Validate headers
    if (request.headers['tus-resumable'] !== '1.0.0') {
      reply.code(412);
      reply.header('Tus-Resumable', '1.0.0');
      return { error: 'Missing Tus-Resumable header' };
    }

    if (contentType !== 'application/offset+octet-stream') {
      reply.code(415);
      reply.header('Tus-Resumable', '1.0.0');
      return { error: 'Invalid Content-Type' };
    }

    if (uploadOffset === undefined) {
      reply.code(400);
      return { error: 'Missing Upload-Offset header' };
    }

    const offset = parseInt(uploadOffset, 10);
    const upload = uploads.get(id);

    if (!upload) {
      reply.code(404);
      reply.header('Tus-Resumable', '1.0.0');
      return { error: 'Upload not found' };
    }

    if (offset !== upload.offset) {
      reply.code(409);
      reply.header('Tus-Resumable', '1.0.0');
      return { error: 'Offset mismatch' };
    }

    // Get chunk data - body is parsed by the content-type parser
    const data = request.body as Buffer || Buffer.alloc(0);

    if (data.length === 0) {
      reply.code(400);
      return { error: 'No data received' };
    }

    // Append data to file
    const filePath = join(UPLOAD_DIR, `${id}${upload.fileExtension || ''}`);
    const fileHandle = await import('node:fs/promises').then(fs => fs.open(filePath, 'a'));

    try {
      await fileHandle.write(data);
    } finally {
      await fileHandle.close();
    }

    // Update offset
    upload.offset += data.length;

    // Check if upload is complete
    const isComplete = upload.size > 0 && upload.offset >= upload.size;

    reply.header('Tus-Resumable', '1.0.0');
    reply.header('Upload-Offset', String(upload.offset));

    if (isComplete) {
      // Upload complete - you can trigger file processing here
      fastify.log.info(`Upload complete: ${id} (${upload.offset} bytes)`);

      // Optionally move file to permanent location
      // and trigger any post-processing
    }

    reply.code(204);
    return;
  });

  /**
   * DELETE /api/tus/:id - Cancel upload
   */
  fastify.delete('/api/tus/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    if (request.headers['tus-resumable'] !== '1.0.0') {
      reply.code(412);
      reply.header('Tus-Resumable', '1.0.0');
      return { error: 'Missing Tus-Resumable header' };
    }

    const upload = uploads.get(id);
    if (!upload) {
      reply.code(404);
      reply.header('Tus-Resumable', '1.0.0');
      return { error: 'Upload not found' };
    }

    // Delete temporary file
    const filePath = join(UPLOAD_DIR, `${id}${upload.fileExtension || ''}`);
    await unlink(filePath).catch(() => {
      // Ignore errors
    });

    // Remove from tracking
    uploads.delete(id);

    reply.code(204);
    reply.header('Tus-Resumable', '1.0.0');
    return;
  });

  /**
   * GET /api/tus/:id - Get upload status
   */
  fastify.get('/api/tus/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const upload = uploads.get(id);
    if (!upload) {
      reply.code(404);
      return { error: 'Upload not found' };
    }

    return {
      id: upload.id,
      size: upload.size,
      offset: upload.offset,
      metadata: upload.metadata,
      isComplete: upload.size > 0 && upload.offset >= upload.size,
      progress: upload.size > 0 ? (upload.offset / upload.size) * 100 : 0,
    };
  });

  /**
   * GET /api/tus - List all uploads
   */
  fastify.get('/api/tus', async () => {
    const uploadList = Array.from(uploads.values()).map((upload) => ({
      id: upload.id,
      size: upload.size,
      offset: upload.offset,
      isComplete: upload.size > 0 && upload.offset >= upload.size,
      progress: upload.size > 0 ? (upload.offset / upload.size) * 100 : 0,
      createdAt: upload.createdAt,
    }));

    return {
      uploads: uploadList,
      count: uploadList.length,
    };
  });
}
