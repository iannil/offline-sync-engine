/**
 * Network manager - monitors network status and quality
 * @module network
 */

import { BehaviorSubject } from 'rxjs';

/**
 * Network status information
 */
export interface NetworkStatus {
  isOnline: boolean;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  lastChanged: number;
}

/**
 * Network quality levels
 */
export enum NetworkQuality {
  EXCELLENT = 'excellent',
  GOOD = 'good',
  FAIR = 'fair',
  POOR = 'poor',
  OFFLINE = 'offline',
}

/**
 * Configuration for network manager
 */
export interface NetworkManagerConfig {
  pingUrl?: string;
  pingInterval?: number;
  pingTimeout?: number;
}

/**
 * Network manager - monitors and reports network status
 */
export class NetworkManager {
  private statusSubject = new BehaviorSubject<NetworkStatus>({
    isOnline: navigator.onLine,
    lastChanged: Date.now(),
  });

  private qualitySubject = new BehaviorSubject<NetworkQuality>(
    this.calculateQuality()
  );

  private pingTimer?: ReturnType<typeof setTimeout>;
  private abortController?: AbortController;

  private config: Required<NetworkManagerConfig> = {
    pingUrl: 'https://www.google.com/favicon.ico',
    pingInterval: 30000,
    pingTimeout: 5000,
  };

  constructor(config: NetworkManagerConfig = {}) {
    this.config = { ...this.config, ...config };
    this.init();
  }

  /**
   * Initialize network event listeners
   */
  private init(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);

      // Check for Network Information API support
      if ('connection' in navigator) {
        const conn = navigator.connection as NetworkInformation;
        conn.addEventListener('change', this.handleConnectionChange);
        this.updateConnectionInfo();
      }

      // Start periodic ping
      this.startPing();
    }
  }

  /**
   * Handle browser online event
   */
  private handleOnline = (): void => {
    this.updateStatus({ isOnline: true });
    this.startPing();
  };

  /**
   * Handle browser offline event
   */
  private handleOffline = (): void => {
    this.updateStatus({ isOnline: false });
    this.stopPing();
  };

  /**
   * Handle connection information change
   */
  private handleConnectionChange = (): void => {
    this.updateConnectionInfo();
  };

  /**
   * Update connection information from Network Information API
   */
  private updateConnectionInfo(): void {
    if ('connection' in navigator) {
      const conn = navigator.connection as NetworkInformation;
      this.updateStatus({
        effectiveType: conn.effectiveType,
        downlink: conn.downlink,
        rtt: conn.rtt,
        saveData: conn.saveData,
      });
    }
  }

  /**
   * Update network status
   */
  private updateStatus(updates: Partial<NetworkStatus>): void {
    const current = this.statusSubject.value;
    const newStatus: NetworkStatus = {
      ...current,
      ...updates,
      lastChanged: Date.now(),
    };

    this.statusSubject.next(newStatus);
    this.qualitySubject.next(this.calculateQuality());
  }

  /**
   * Calculate network quality based on current status
   */
  private calculateQuality(): NetworkQuality {
    const status = this.statusSubject.value;

    if (!status.isOnline) {
      return NetworkQuality.OFFLINE;
    }

    if (status.effectiveType === '4g' || (status.downlink ?? 0) >= 10) {
      return NetworkQuality.EXCELLENT;
    }

    if (status.effectiveType === '3g' || (status.downlink ?? 0) >= 1.5) {
      return NetworkQuality.GOOD;
    }

    if (status.effectiveType === '2g' || (status.downlink ?? 0) >= 0.5) {
      return NetworkQuality.FAIR;
    }

    return NetworkQuality.POOR;
  }

  /**
   * Start periodic ping to verify connectivity
   */
  private startPing(): void {
    this.stopPing();

    this.pingTimer = setInterval(() => {
      this.ping();
    }, this.config.pingInterval);

    // Initial ping
    this.ping();
  }

  /**
   * Stop periodic ping
   */
  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }
  }

  /**
   * Ping server to verify connectivity
   */
  private async ping(): Promise<boolean> {
    if (!this.statusSubject.value.isOnline) {
      return false;
    }

    try {
      this.abortController = new AbortController();

      const response = await fetch(this.config.pingUrl, {
        method: 'HEAD',
        cache: 'no-cache',
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Ping failed: ${response.status}`);
      }

      return true;
    } catch {
      // Ping failed - might still be online but server unreachable
      // Don't immediately mark as offline, let the browser handle that
      return false;
    }
  }

  /**
   * Observable of network status changes
   */
  public readonly status$ = this.statusSubject.asObservable();

  /**
   * Observable of network quality changes
   */
  public readonly quality$ = this.qualitySubject.asObservable();

  /**
   * Current network status
   */
  public get status(): NetworkStatus {
    return this.statusSubject.value;
  }

  /**
   * Current network quality
   */
  public get quality(): NetworkQuality {
    return this.qualitySubject.value;
  }

  /**
   * Check if currently online
   */
  public get isOnline(): boolean {
    return this.statusSubject.value.isOnline;
  }

  /**
   * Manually trigger a connectivity check
   */
  public async checkConnectivity(): Promise<boolean> {
    return this.ping();
  }

  /**
   * Cleanup and remove event listeners
   */
  public destroy(): void {
    this.stopPing();

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);

      if ('connection' in navigator) {
        const conn = navigator.connection as NetworkInformation;
        conn.removeEventListener('change', this.handleConnectionChange);
      }
    }

    this.statusSubject.complete();
    this.qualitySubject.complete();
  }
}

/**
 * Global network manager instance
 */
let globalNetworkManager: NetworkManager | null = null;

/**
 * Get the global network manager instance
 */
export function getNetworkManager(
  config?: NetworkManagerConfig
): NetworkManager {
  if (!globalNetworkManager) {
    globalNetworkManager = new NetworkManager(config);
  }
  return globalNetworkManager;
}

/**
 * Reset the global network manager instance
 */
export function resetNetworkManager(): void {
  if (globalNetworkManager) {
    globalNetworkManager.destroy();
    globalNetworkManager = null;
  }
}

/**
 * Types for Network Information API
 */
interface NetworkInformation extends EventTarget {
  readonly effectiveType?: string;
  readonly downlink?: number;
  readonly rtt?: number;
  readonly saveData?: boolean;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: EventListenerOptions | boolean
  ): void;
}

declare global {
  interface Navigator {
    readonly connection?: NetworkInformation;
  }
}
