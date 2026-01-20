/**
 * TUS Protocol Implementation - Resumable file uploads
 * @module tus
 *
 * Implements the TUS protocol v1.0.0 for resumable uploads
 * See: https://tus.io/protocols/resumable-upload.html
 */

/**
 * TUS upload options
 */
export interface TusUploadOptions {
  /**
   * Upload endpoint URL
   */
  endpoint: string;

  /**
   * File data to upload
   */
  data: Blob | Uint8Array | string;

  /**
   * Metadata to send with the upload
   */
  metadata?: Record<string, string>;

  /**
   * Chunk size for upload (in bytes)
   * @default 5 * 1024 * 1024 (5MB)
   */
  chunkSize?: number;

  /**
   * Number of parallel uploads
   * @default 1
   */
  parallel?: number;

  /**
   * Request headers
   */
  headers?: Record<string, string>;

  /**
   * Progress callback
   */
  onProgress?: (bytesSent: number, bytesTotal: number) => void;

  /**
   * Success callback
   */
  onSuccess?: () => void;

  /**
   * Error callback
   */
  onError?: (error: Error) => void;

  /**
   * Override upload URL (for resuming)
   */
  uploadUrl?: string;

  /**
   * Store upload URL in localStorage for resume
   * @default true
   */
  storeUrl?: boolean;

  /**
   * Storage key for upload URL
   */
  storageKey?: string;

  /**
   * Retry configuration
   */
  retry?: {
    maxAttempts: number;
    initialDelay: number;
    maxDelay: number;
  };
}

/**
 * TUS upload state
 */
export interface TusUploadState {
  uploadUrl: string | null;
  bytesSent: number;
  bytesTotal: number;
  isUploading: boolean;
  isPaused: boolean;
  error: Error | null;
}

/**
 * Default chunk size (5MB)
 */
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

/**
 * Default retry configuration
 */
const DEFAULT_RETRY = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 10000,
};

/**
 * TUS Uploader class
 */
export class TusUploader {
  private options: Required<Omit<TusUploadOptions, 'data' | 'uploadUrl' | 'onProgress' | 'onSuccess' | 'onError' | 'retry'>> & {
    data: Blob | Uint8Array | string;
    uploadUrl?: string;
    onProgress?: (bytesSent: number, bytesTotal: number) => void;
    onSuccess?: () => void;
    onError?: (error: Error) => void;
    retry: Required<NonNullable<TusUploadOptions['retry']>>;
  };

  private state: TusUploadState;
  private abortController: AbortController | null = null;
  private fileSize: number;

  constructor(options: TusUploadOptions) {
    this.fileSize = this.getFileSize(options.data);

    this.options = {
      endpoint: options.endpoint,
      data: options.data,
      metadata: options.metadata || {},
      chunkSize: options.chunkSize || DEFAULT_CHUNK_SIZE,
      parallel: options.parallel || 1,
      headers: options.headers || {},
      storeUrl: options.storeUrl !== false,
      storageKey: options.storageKey || this.generateStorageKey(options.data),
      uploadUrl: options.uploadUrl,
      onProgress: options.onProgress,
      onSuccess: options.onSuccess,
      onError: options.onError,
      retry: { ...DEFAULT_RETRY, ...options.retry },
    };

    // Try to load stored upload URL
    const storedUrl = this.options.storeUrl
      ? this.loadStoredUrl()
      : null;

    this.state = {
      uploadUrl: storedUrl || options.uploadUrl || null,
      bytesSent: 0,
      bytesTotal: this.fileSize,
      isUploading: false,
      isPaused: false,
      error: null,
    };
  }

  /**
   * Start or resume the upload
   */
  async start(): Promise<string> {
    if (this.state.isUploading) {
      return this.state.uploadUrl!;
    }

    this.state.isUploading = true;
    this.state.isPaused = false;
    this.abortController = new AbortController();

    try {
      // Create new upload or resume existing
      let uploadUrl = this.state.uploadUrl;

      if (!uploadUrl) {
        uploadUrl = await this.createUpload();
        this.state.uploadUrl = uploadUrl;
        this.storeUrl(uploadUrl);
      }

      // Get current offset
      const offset = await this.getOffset(uploadUrl);
      this.state.bytesSent = offset;

      // Upload chunks
      await this.uploadChunks(uploadUrl, offset);

      // Finalize upload
      this.state.isUploading = false;
      this.options.onSuccess?.();
      this.clearStoredUrl();

      return uploadUrl;
    } catch (error) {
      this.state.isUploading = false;
      this.state.error = error as Error;
      this.options.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Pause the upload
   */
  pause(): void {
    this.state.isPaused = true;
    this.abortController?.abort();
  }

  /**
   * Resume the upload
   */
  async resume(): Promise<string> {
    if (!this.state.isPaused) {
      return this.start();
    }

    this.state.isPaused = false;
    return this.start();
  }

  /**
   * Cancel the upload and remove stored state
   */
  cancel(): void {
    this.pause();
    this.state.uploadUrl = null;
    this.state.bytesSent = 0;
    this.clearStoredUrl();
  }

  /**
   * Get current upload state
   */
  getState(): TusUploadState {
    return { ...this.state };
  }

  /**
   * Create a new upload
   */
  private async createUpload(): Promise<string> {
    const metadata = this.encodeMetadata();
    const headers = {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(this.fileSize),
      'Upload-Metadata': metadata,
      ...this.options.headers,
    };

    const response = await fetch(this.options.endpoint, {
      method: 'POST',
      headers,
    });

    if (!response.status.toString().startsWith('2')) {
      throw new Error(`Failed to create upload: ${response.status}`);
    }

    const uploadUrl = response.headers.get('Location');
    if (!uploadUrl) {
      throw new Error('No Location header in response');
    }

    return uploadUrl;
  }

  /**
   * Get current upload offset
   */
  private async getOffset(uploadUrl: string): Promise<number> {
    const headers = {
      'Tus-Resumable': '1.0.0',
      ...this.options.headers,
    };

    const response = await fetch(uploadUrl, {
      method: 'HEAD',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to get offset: ${response.status}`);
    }

    const offset = response.headers.get('Upload-Offset');
    return offset ? parseInt(offset, 10) : 0;
  }

  /**
   * Upload file in chunks
   */
  private async uploadChunks(uploadUrl: string, offset: number): Promise<void> {
    const data = await this.getDataAsArrayBuffer();
    let currentOffset = offset;

    while (currentOffset < this.fileSize && !this.state.isPaused) {
      const chunk = data.slice(
        currentOffset,
        currentOffset + this.options.chunkSize
      );

      await this.uploadWithRetry(uploadUrl, chunk, currentOffset);

      currentOffset += chunk.byteLength;
      this.state.bytesSent = currentOffset;

      this.options.onProgress?.(currentOffset, this.fileSize);

      // Store progress
      if (this.options.storeUrl) {
        this.storeProgress(currentOffset);
      }
    }

    if (this.state.isPaused) {
      throw new Error('Upload paused');
    }
  }

  /**
   * Upload a chunk with retry logic
   */
  private async uploadWithRetry(
    uploadUrl: string,
    chunk: ArrayBuffer,
    offset: number
  ): Promise<void> {
    let lastError: Error | null = null;
    let delay = this.options.retry.initialDelay;

    for (let attempt = 0; attempt < this.options.retry.maxAttempts; attempt++) {
      try {
        const headers = {
          'Tus-Resumable': '1.0.0',
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': String(offset),
          'Content-Length': String(chunk.byteLength),
          ...this.options.headers,
        };

        const response = await fetch(uploadUrl, {
          method: 'PATCH',
          headers,
          body: chunk,
          signal: this.abortController?.signal,
        });

        if (!response.status.toString().startsWith('2')) {
          throw new Error(`Upload failed: ${response.status}`);
        }

        // Verify offset
        const responseOffset = response.headers.get('Upload-Offset');
        const newOffset = parseInt(responseOffset || String(offset), 10);

        if (newOffset !== offset + chunk.byteLength) {
          throw new Error(`Offset mismatch: expected ${offset + chunk.byteLength}, got ${newOffset}`);
        }

        return;
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.options.retry.maxAttempts - 1) {
          await this.delay(delay);
          delay = Math.min(delay * 2, this.options.retry.maxDelay);
        }
      }
    }

    throw lastError || new Error('Upload failed after retries');
  }

  /**
   * Encode metadata for TUS protocol
   */
  private encodeMetadata(): string {
    return Object.entries(this.options.metadata)
      .map(([key, value]) => {
        const encoded = btoa(value);
        return `${key} ${encoded}`;
      })
      .join(',');
  }

  /**
   * Get file size
   */
  private getFileSize(data: Blob | Uint8Array | string): number {
    if (data instanceof Blob) {
      return data.size;
    } else if (data instanceof Uint8Array) {
      return data.byteLength;
    } else {
      return new TextEncoder().encode(data).byteLength;
    }
  }

  /**
   * Get data as ArrayBuffer
   */
  private async getDataAsArrayBuffer(): Promise<ArrayBuffer> {
    const data = this.options.data;

    if (data instanceof Blob) {
      return await data.arrayBuffer();
    } else if (data instanceof Uint8Array) {
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    } else {
      return new TextEncoder().encode(data).buffer;
    }
  }

  /**
   * Generate storage key for upload URL
   */
  private generateStorageKey(data: Blob | Uint8Array | string): string {
    const size = this.getFileSize(data);
    const type = data instanceof Blob ? data.type : 'application/octet-stream';
    return `tus-upload-${type}-${size}`;
  }

  /**
   * Store upload URL
   */
  private storeUrl(uploadUrl: string): void {
    if (!this.options.storeUrl) return;

    try {
      const storageData = {
        url: uploadUrl,
        timestamp: Date.now(),
        size: this.fileSize,
      };
      localStorage.setItem(
        this.options.storageKey,
        JSON.stringify(storageData)
      );
    } catch (error) {
      console.warn('Failed to store upload URL:', error);
    }
  }

  /**
   * Store upload progress
   */
  private storeProgress(bytesSent: number): void {
    if (!this.options.storeUrl) return;

    try {
      const stored = localStorage.getItem(this.options.storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        data.bytesSent = bytesSent;
        data.timestamp = Date.now();
        localStorage.setItem(this.options.storageKey, JSON.stringify(data));
      }
    } catch (error) {
      console.warn('Failed to store progress:', error);
    }
  }

  /**
   * Load stored upload URL
   */
  private loadStoredUrl(): string | null {
    if (!this.options.storeUrl) return null;

    try {
      const stored = localStorage.getItem(this.options.storageKey);
      if (stored) {
        const data = JSON.parse(stored);

        // Validate stored URL is still usable (within 24 hours)
        const isRecent = Date.now() - data.timestamp < 24 * 60 * 60 * 1000;

        if (isRecent && data.size === this.fileSize) {
          this.state.bytesSent = data.bytesSent || 0;
          return data.url;
        }
      }
    } catch (error) {
      console.warn('Failed to load stored URL:', error);
    }

    return null;
  }

  /**
   * Clear stored upload URL
   */
  private clearStoredUrl(): void {
    if (!this.options.storeUrl) return;

    try {
      localStorage.removeItem(this.options.storageKey);
    } catch (error) {
      console.warn('Failed to clear stored URL:', error);
    }
  }

  /**
   * Delay helper for retry
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a new TUS upload
 */
export function createTusUpload(options: TusUploadOptions): TusUploader {
  return new TusUploader(options);
}

/**
 * Quick upload function
 */
export async function uploadFile(options: TusUploadOptions): Promise<string> {
  const uploader = new TusUploader(options);
  return uploader.start();
}
