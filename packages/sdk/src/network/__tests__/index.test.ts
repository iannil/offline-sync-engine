/**
 * Network manager unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  NetworkManager,
  NetworkQuality,
  NetworkStatus,
  getNetworkManager,
  resetNetworkManager,
} from '../index.js';

// Mock navigator
const mockNavigator = {
  onLine: true,
  connection: {
    effectiveType: '4g',
    downlink: 10,
    rtt: 50,
    saveData: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
};

// Mock window
const mockWindow = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

// Mock fetch
const mockFetch = vi.fn();

describe('NetworkManager', () => {
  let originalNavigator: Navigator;
  let originalWindow: Window & typeof globalThis;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    // Save originals
    originalNavigator = global.navigator;
    originalWindow = global.window;
    originalFetch = global.fetch;

    // Reset mocks
    vi.clearAllMocks();
    mockNavigator.onLine = true;
    mockNavigator.connection.effectiveType = '4g';
    mockNavigator.connection.downlink = 10;
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    // Setup mocks
    Object.defineProperty(global, 'navigator', {
      value: mockNavigator,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global, 'window', {
      value: mockWindow,
      writable: true,
      configurable: true,
    });
    global.fetch = mockFetch;

    // Reset global network manager
    resetNetworkManager();
  });

  afterEach(() => {
    // Restore originals
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
    global.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const manager = new NetworkManager();

      expect(manager.isOnline).toBe(true);
      expect(manager.status.lastChanged).toBeDefined();

      manager.destroy();
    });

    it('should accept custom config', () => {
      const config = {
        pingUrl: 'http://localhost/ping',
        pingInterval: 5000,
        pingTimeout: 1000,
      };

      const manager = new NetworkManager(config);
      expect(manager).toBeDefined();

      manager.destroy();
    });

    it('should register event listeners', () => {
      const manager = new NetworkManager();

      expect(mockWindow.addEventListener).toHaveBeenCalledWith(
        'online',
        expect.any(Function)
      );
      expect(mockWindow.addEventListener).toHaveBeenCalledWith(
        'offline',
        expect.any(Function)
      );

      manager.destroy();
    });

    it('should register connection change listener', () => {
      const manager = new NetworkManager();

      expect(mockNavigator.connection.addEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function)
      );

      manager.destroy();
    });
  });

  describe('status', () => {
    it('should return current network status', () => {
      const manager = new NetworkManager();
      const status = manager.status;

      expect(status).toHaveProperty('isOnline');
      expect(status).toHaveProperty('lastChanged');
      expect(typeof status.isOnline).toBe('boolean');
      expect(typeof status.lastChanged).toBe('number');

      manager.destroy();
    });

    it('should include connection info when available', () => {
      const manager = new NetworkManager();
      const status = manager.status;

      expect(status.effectiveType).toBe('4g');
      expect(status.downlink).toBe(10);
      expect(status.rtt).toBe(50);
      expect(status.saveData).toBe(false);

      manager.destroy();
    });
  });

  describe('quality', () => {
    it('should return EXCELLENT for 4g with high bandwidth', () => {
      mockNavigator.connection.effectiveType = '4g';
      mockNavigator.connection.downlink = 10;

      const manager = new NetworkManager();
      expect(manager.quality).toBe(NetworkQuality.EXCELLENT);

      manager.destroy();
    });

    it('should return GOOD for 3g connection', () => {
      mockNavigator.connection.effectiveType = '3g';
      mockNavigator.connection.downlink = 2;

      const manager = new NetworkManager();
      expect(manager.quality).toBe(NetworkQuality.GOOD);

      manager.destroy();
    });

    it('should return FAIR for 2g connection', () => {
      mockNavigator.connection.effectiveType = '2g';
      mockNavigator.connection.downlink = 0.5;

      const manager = new NetworkManager();
      expect(manager.quality).toBe(NetworkQuality.FAIR);

      manager.destroy();
    });

    it('should return POOR for slow connection', () => {
      mockNavigator.connection.effectiveType = 'slow-2g';
      mockNavigator.connection.downlink = 0.1;

      const manager = new NetworkManager();
      expect(manager.quality).toBe(NetworkQuality.POOR);

      manager.destroy();
    });

    it('should return OFFLINE when not online', () => {
      mockNavigator.onLine = false;

      const manager = new NetworkManager();
      expect(manager.quality).toBe(NetworkQuality.OFFLINE);

      manager.destroy();
    });
  });

  describe('isOnline', () => {
    it('should return true when online', () => {
      mockNavigator.onLine = true;
      const manager = new NetworkManager();

      expect(manager.isOnline).toBe(true);

      manager.destroy();
    });

    it('should return false when offline', () => {
      mockNavigator.onLine = false;
      const manager = new NetworkManager();

      expect(manager.isOnline).toBe(false);

      manager.destroy();
    });
  });

  describe('status$', () => {
    it('should emit status updates', async () => {
      const manager = new NetworkManager();
      const statuses: NetworkStatus[] = [];

      const subscription = manager.status$.subscribe((status) => {
        statuses.push(status);
      });

      // Initial status is emitted immediately
      expect(statuses.length).toBeGreaterThanOrEqual(1);
      expect(statuses[0].isOnline).toBe(true);

      subscription.unsubscribe();
      manager.destroy();
    });
  });

  describe('quality$', () => {
    it('should emit quality updates', async () => {
      const manager = new NetworkManager();
      const qualities: NetworkQuality[] = [];

      const subscription = manager.quality$.subscribe((quality) => {
        qualities.push(quality);
      });

      // Initial quality is emitted immediately
      expect(qualities.length).toBeGreaterThanOrEqual(1);

      subscription.unsubscribe();
      manager.destroy();
    });
  });

  describe('checkConnectivity', () => {
    it('should return true when ping succeeds', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const manager = new NetworkManager();
      const result = await manager.checkConnectivity();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalled();

      manager.destroy();
    });

    it('should return false when ping fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const manager = new NetworkManager();
      const result = await manager.checkConnectivity();

      expect(result).toBe(false);

      manager.destroy();
    });

    it('should return false when response is not ok', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const manager = new NetworkManager();
      const result = await manager.checkConnectivity();

      expect(result).toBe(false);

      manager.destroy();
    });

    it('should return false when offline', async () => {
      mockNavigator.onLine = false;

      const manager = new NetworkManager();
      const result = await manager.checkConnectivity();

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();

      manager.destroy();
    });
  });

  describe('destroy', () => {
    it('should remove event listeners', () => {
      const manager = new NetworkManager();
      manager.destroy();

      expect(mockWindow.removeEventListener).toHaveBeenCalledWith(
        'online',
        expect.any(Function)
      );
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith(
        'offline',
        expect.any(Function)
      );
    });

    it('should remove connection change listener', () => {
      const manager = new NetworkManager();
      manager.destroy();

      expect(mockNavigator.connection.removeEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function)
      );
    });

    it('should complete observables', () => {
      const manager = new NetworkManager();

      let statusCompleted = false;
      let qualityCompleted = false;

      manager.status$.subscribe({
        complete: () => { statusCompleted = true; },
      });
      manager.quality$.subscribe({
        complete: () => { qualityCompleted = true; },
      });

      manager.destroy();

      expect(statusCompleted).toBe(true);
      expect(qualityCompleted).toBe(true);
    });
  });
});

describe('NetworkQuality', () => {
  it('should have correct values', () => {
    expect(NetworkQuality.EXCELLENT).toBe('excellent');
    expect(NetworkQuality.GOOD).toBe('good');
    expect(NetworkQuality.FAIR).toBe('fair');
    expect(NetworkQuality.POOR).toBe('poor');
    expect(NetworkQuality.OFFLINE).toBe('offline');
  });
});

describe('getNetworkManager', () => {
  let originalNavigator: Navigator;
  let originalWindow: Window & typeof globalThis;

  beforeEach(() => {
    originalNavigator = global.navigator;
    originalWindow = global.window;

    Object.defineProperty(global, 'navigator', {
      value: mockNavigator,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global, 'window', {
      value: mockWindow,
      writable: true,
      configurable: true,
    });

    resetNetworkManager();
  });

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
    resetNetworkManager();
  });

  it('should return singleton instance', () => {
    const manager1 = getNetworkManager();
    const manager2 = getNetworkManager();

    expect(manager1).toBe(manager2);
  });

  it('should accept config on first call', () => {
    const config = {
      pingUrl: 'http://localhost/ping',
      pingInterval: 5000,
    };

    const manager = getNetworkManager(config);
    expect(manager).toBeDefined();
  });
});

describe('resetNetworkManager', () => {
  let originalNavigator: Navigator;
  let originalWindow: Window & typeof globalThis;

  beforeEach(() => {
    originalNavigator = global.navigator;
    originalWindow = global.window;

    Object.defineProperty(global, 'navigator', {
      value: mockNavigator,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global, 'window', {
      value: mockWindow,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
    resetNetworkManager();
  });

  it('should destroy and reset global instance', () => {
    const manager1 = getNetworkManager();
    resetNetworkManager();
    const manager2 = getNetworkManager();

    expect(manager1).not.toBe(manager2);
  });
});
