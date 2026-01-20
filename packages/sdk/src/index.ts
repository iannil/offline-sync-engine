/**
 * Offline Sync Engine SDK
 *
 * A local-first database SDK with background synchronization.
 * Optimized for poor network conditions (2G/3G networks in Africa).
 *
 * @packageDocumentation
 */

// Storage
export * from './storage/index.js';

// Network
export * from './network/index.js';

// Outbox
export * from './outbox/index.js';

// Client
export * from './client/index.js';

// Sync
export * from './sync/index.js';

// Version
export const VERSION = '0.1.0' as const;
