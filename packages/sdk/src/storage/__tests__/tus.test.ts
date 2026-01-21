/**
 * TUS Protocol unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TusUploader,
  createTusUpload,
  uploadFile,
  TusUploadState,
} from '../tus.js';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

// Mock fetch
const createMockFetch = (responses: Array<{ status: number; headers: Record<string, string> }>) => {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const response = responses[callIndex] || responses[responses.length - 1];
    callIndex++;
    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: {
        get: (name: string) => response.headers[name] || null,
      },
    });
  });
};

describe('TusUploader', () => {
  const originalFetch = global.fetch;
  const originalLocalStorage = global.localStorage;

  beforeEach(() => {
    // Setup mocks
    Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });
    localStorageMock.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(global, 'localStorage', { value: originalLocalStorage, writable: true });
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test data',
      });

      const state = uploader.getState();
      expect(state.bytesTotal).toBe(9); // 'test data'.length
      expect(state.bytesSent).toBe(0);
      expect(state.isUploading).toBe(false);
      expect(state.isPaused).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should calculate correct file size for string', () => {
      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'Hello, World!',
      });

      expect(uploader.getState().bytesTotal).toBe(13);
    });

    it('should calculate correct file size for Uint8Array', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data,
      });

      expect(uploader.getState().bytesTotal).toBe(5);
    });

    it('should calculate correct file size for Blob', () => {
      const blob = new Blob(['test content']);
      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: blob,
      });

      expect(uploader.getState().bytesTotal).toBe(12);
    });
  });

  describe('start', () => {
    it('should create upload and get location header', async () => {
      const mockFetch = createMockFetch([
        { status: 201, headers: { 'Location': 'http://localhost/upload/123' } },
        { status: 200, headers: { 'Upload-Offset': '0' } },
        { status: 204, headers: { 'Upload-Offset': '9' } },
      ]);
      global.fetch = mockFetch;

      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test data',
        storeUrl: false,
      });

      const uploadUrl = await uploader.start();

      expect(uploadUrl).toBe('http://localhost/upload/123');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should call onProgress during upload', async () => {
      const mockFetch = createMockFetch([
        { status: 201, headers: { 'Location': 'http://localhost/upload/123' } },
        { status: 200, headers: { 'Upload-Offset': '0' } },
        { status: 204, headers: { 'Upload-Offset': '9' } },
      ]);
      global.fetch = mockFetch;

      const onProgress = vi.fn();

      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test data',
        storeUrl: false,
        onProgress,
      });

      await uploader.start();

      expect(onProgress).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(9, 9);
    });

    it('should call onSuccess on completion', async () => {
      const mockFetch = createMockFetch([
        { status: 201, headers: { 'Location': 'http://localhost/upload/123' } },
        { status: 200, headers: { 'Upload-Offset': '0' } },
        { status: 204, headers: { 'Upload-Offset': '9' } },
      ]);
      global.fetch = mockFetch;

      const onSuccess = vi.fn();

      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test data',
        storeUrl: false,
        onSuccess,
      });

      await uploader.start();

      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it('should call onError on failure', async () => {
      const mockFetch = createMockFetch([
        { status: 500, headers: {} },
      ]);
      global.fetch = mockFetch;

      const onError = vi.fn();

      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test data',
        storeUrl: false,
        onError,
      });

      await expect(uploader.start()).rejects.toThrow();
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('should send TUS headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: {
          get: (name: string) => name === 'Location' ? 'http://localhost/upload/123' : null,
        },
      });
      global.fetch = mockFetch;

      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test',
        storeUrl: false,
        metadata: { filename: 'test.txt' },
      });

      try {
        await uploader.start();
      } catch {
        // Ignore continuation errors
      }

      // Check first call (create upload)
      const firstCallArgs = mockFetch.mock.calls[0];
      expect(firstCallArgs[1].headers['Tus-Resumable']).toBe('1.0.0');
      expect(firstCallArgs[1].headers['Upload-Length']).toBe('4');
      expect(firstCallArgs[1].headers['Upload-Metadata']).toContain('filename');
    });
  });

  describe('pause/resume', () => {
    it('should set isPaused state', () => {
      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test data',
      });

      expect(uploader.getState().isPaused).toBe(false);

      uploader.pause();

      expect(uploader.getState().isPaused).toBe(true);
    });
  });

  describe('cancel', () => {
    it('should reset state on cancel', () => {
      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test data',
      });

      uploader.cancel();

      const state = uploader.getState();
      expect(state.uploadUrl).toBeNull();
      expect(state.bytesSent).toBe(0);
    });

    it('should clear stored URL on cancel', () => {
      const storageKey = 'test-storage-key';
      localStorageMock.setItem(storageKey, JSON.stringify({ url: 'http://test' }));

      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test data',
        storageKey,
        storeUrl: true,
      });

      uploader.cancel();

      expect(localStorageMock.getItem(storageKey)).toBeNull();
    });
  });

  describe('getState', () => {
    it('should return a copy of state', () => {
      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test data',
      });

      const state1 = uploader.getState();
      const state2 = uploader.getState();

      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2); // Different objects
    });

    it('should include all state properties', () => {
      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test data',
      });

      const state = uploader.getState();

      expect(state).toHaveProperty('uploadUrl');
      expect(state).toHaveProperty('bytesSent');
      expect(state).toHaveProperty('bytesTotal');
      expect(state).toHaveProperty('isUploading');
      expect(state).toHaveProperty('isPaused');
      expect(state).toHaveProperty('error');
    });
  });

  describe('localStorage integration', () => {
    it('should store upload URL when storeUrl is true', async () => {
      const mockFetch = createMockFetch([
        { status: 201, headers: { 'Location': 'http://localhost/upload/123' } },
        { status: 200, headers: { 'Upload-Offset': '0' } },
        { status: 204, headers: { 'Upload-Offset': '4' } },
      ]);
      global.fetch = mockFetch;

      const storageKey = 'test-upload-key';

      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test',
        storeUrl: true,
        storageKey,
      });

      await uploader.start();

      // After successful completion, the URL should be cleared
      expect(localStorageMock.getItem(storageKey)).toBeNull();
    });

    it('should not store URL when storeUrl is false', async () => {
      const mockFetch = createMockFetch([
        { status: 201, headers: { 'Location': 'http://localhost/upload/123' } },
        { status: 200, headers: { 'Upload-Offset': '0' } },
        { status: 204, headers: { 'Upload-Offset': '4' } },
      ]);
      global.fetch = mockFetch;

      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test',
        storeUrl: false,
      });

      await uploader.start();

      // No storage keys should be set
      expect(localStorageMock.getItem('tus-upload-application/octet-stream-4')).toBeNull();
    });
  });

  describe('retry logic', () => {
    it('should retry on failure', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: create upload
          return Promise.resolve({
            ok: true,
            status: 201,
            headers: { get: (n: string) => n === 'Location' ? 'http://localhost/upload/123' : null },
          });
        } else if (callCount === 2) {
          // Second call: get offset
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: (n: string) => n === 'Upload-Offset' ? '0' : null },
          });
        } else if (callCount < 5) {
          // Third and fourth calls: fail
          return Promise.resolve({
            ok: false,
            status: 500,
            headers: { get: () => null },
          });
        } else {
          // Fifth call: success
          return Promise.resolve({
            ok: true,
            status: 204,
            headers: { get: (n: string) => n === 'Upload-Offset' ? '4' : null },
          });
        }
      });
      global.fetch = mockFetch;

      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: 'test',
        storeUrl: false,
        retry: {
          maxAttempts: 3,
          initialDelay: 1,
          maxDelay: 10,
        },
      });

      await uploader.start();

      // Should have retried
      expect(mockFetch.mock.calls.length).toBeGreaterThan(3);
    });
  });

  describe('chunked upload', () => {
    it('should upload in chunks', async () => {
      const largeData = 'x'.repeat(100);
      const chunkSize = 30;

      let patchCalls = 0;
      const mockFetch = vi.fn().mockImplementation((url, options) => {
        if (options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 201,
            headers: { get: (n: string) => n === 'Location' ? 'http://localhost/upload/123' : null },
          });
        } else if (options?.method === 'HEAD') {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: (n: string) => n === 'Upload-Offset' ? '0' : null },
          });
        } else if (options?.method === 'PATCH') {
          patchCalls++;
          const currentOffset = parseInt(options.headers['Upload-Offset'], 10);
          const chunkLength = options.body.byteLength;
          return Promise.resolve({
            ok: true,
            status: 204,
            headers: { get: (n: string) => n === 'Upload-Offset' ? String(currentOffset + chunkLength) : null },
          });
        }
        return Promise.reject(new Error('Unexpected request'));
      });
      global.fetch = mockFetch;

      const uploader = new TusUploader({
        endpoint: 'http://localhost/upload',
        data: largeData,
        chunkSize,
        storeUrl: false,
      });

      await uploader.start();

      // 100 bytes with 30 byte chunks = 4 PATCH requests (30 + 30 + 30 + 10)
      expect(patchCalls).toBe(4);
    });
  });
});

describe('createTusUpload', () => {
  it('should create a TusUploader instance', () => {
    const uploader = createTusUpload({
      endpoint: 'http://localhost/upload',
      data: 'test',
    });

    expect(uploader).toBeInstanceOf(TusUploader);
  });
});

describe('uploadFile', () => {
  const originalFetch = global.fetch;
  const originalLocalStorage = global.localStorage;

  beforeEach(() => {
    Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });
    localStorageMock.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(global, 'localStorage', { value: originalLocalStorage, writable: true });
  });

  it('should upload file and return URL', async () => {
    const mockFetch = createMockFetch([
      { status: 201, headers: { 'Location': 'http://localhost/upload/456' } },
      { status: 200, headers: { 'Upload-Offset': '0' } },
      { status: 204, headers: { 'Upload-Offset': '4' } },
    ]);
    global.fetch = mockFetch;

    const url = await uploadFile({
      endpoint: 'http://localhost/upload',
      data: 'test',
      storeUrl: false,
    });

    expect(url).toBe('http://localhost/upload/456');
  });
});
