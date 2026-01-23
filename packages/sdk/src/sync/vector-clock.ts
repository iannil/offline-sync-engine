/**
 * Vector Clock implementation for distributed synchronization
 * @module sync/vector-clock
 *
 * A vector clock is a mechanism for ordering events in a distributed system.
 * Each client maintains a logical timestamp for every known client/node.
 */

/**
 * Vector clock type - maps client IDs to their logical timestamps
 */
export type VectorClockMap = Record<string, number>;

/**
 * Comparison result between two vector clocks
 */
export type ClockComparison =
  | 'equal' // Clocks are identical
  | 'before' // Local is strictly before remote (local < remote)
  | 'after' // Local is strictly after remote (local > remote)
  | 'concurrent'; // Clocks are concurrent (neither dominates)

/**
 * Vector Clock class for tracking causal ordering of events
 *
 * @example
 * ```typescript
 * const clock = new VectorClock('client-1');
 *
 * // Increment on local write
 * clock.increment();
 *
 * // Merge with remote clock on receive
 * clock.merge(remoteClock);
 *
 * // Compare clocks
 * const comparison = clock.compare(otherClock);
 * ```
 */
export class VectorClock {
  private clock: VectorClockMap;
  private clientId: string;

  constructor(clientId: string, initialClock?: VectorClockMap) {
    this.clientId = clientId;
    this.clock = initialClock ? { ...initialClock } : {};

    // Ensure this client has an entry
    if (!(clientId in this.clock)) {
      this.clock[clientId] = 0;
    }
  }

  /**
   * Get the current clock state
   */
  getClock(): VectorClockMap {
    return { ...this.clock };
  }

  /**
   * Get the timestamp for a specific client
   */
  getTimestamp(clientId?: string): number {
    const id = clientId || this.clientId;
    return this.clock[id] || 0;
  }

  /**
   * Get the local client ID
   */
  getClientId(): string {
    return this.clientId;
  }

  /**
   * Increment the local timestamp (call on local writes)
   */
  increment(): VectorClockMap {
    this.clock[this.clientId] = (this.clock[this.clientId] || 0) + 1;
    return this.getClock();
  }

  /**
   * Set a specific client's timestamp
   */
  setTimestamp(clientId: string, timestamp: number): void {
    this.clock[clientId] = timestamp;
  }

  /**
   * Merge with another clock (call when receiving remote updates)
   * Takes the max of each component
   */
  merge(remoteClock: VectorClockMap): VectorClockMap {
    // Merge all entries from remote clock
    for (const [clientId, timestamp] of Object.entries(remoteClock)) {
      this.clock[clientId] = Math.max(this.clock[clientId] || 0, timestamp);
    }

    // Increment local timestamp after merge
    this.clock[this.clientId] = (this.clock[this.clientId] || 0) + 1;

    return this.getClock();
  }

  /**
   * Compare this clock with another
   *
   * @returns
   * - 'equal': clocks are identical
   * - 'before': this clock is strictly before other
   * - 'after': this clock is strictly after other
   * - 'concurrent': neither dominates (conflict possible)
   */
  compare(other: VectorClockMap): ClockComparison {
    let isLessOrEqual = true;
    let isGreaterOrEqual = true;

    // Get all unique client IDs
    const allClientIds = new Set([
      ...Object.keys(this.clock),
      ...Object.keys(other),
    ]);

    for (const clientId of allClientIds) {
      const localTs = this.clock[clientId] || 0;
      const remoteTs = other[clientId] || 0;

      if (localTs < remoteTs) {
        isGreaterOrEqual = false;
      }
      if (localTs > remoteTs) {
        isLessOrEqual = false;
      }
    }

    if (isLessOrEqual && isGreaterOrEqual) {
      return 'equal';
    } else if (isLessOrEqual) {
      return 'before';
    } else if (isGreaterOrEqual) {
      return 'after';
    } else {
      return 'concurrent';
    }
  }

  /**
   * Check if this clock dominates another (is strictly after)
   */
  dominates(other: VectorClockMap): boolean {
    return this.compare(other) === 'after';
  }

  /**
   * Check if this clock is dominated by another (is strictly before)
   */
  isDominatedBy(other: VectorClockMap): boolean {
    return this.compare(other) === 'before';
  }

  /**
   * Check if clocks are concurrent (potential conflict)
   */
  isConcurrentWith(other: VectorClockMap): boolean {
    return this.compare(other) === 'concurrent';
  }

  /**
   * Create a copy of this clock
   */
  clone(): VectorClock {
    return new VectorClock(this.clientId, this.clock);
  }

  /**
   * Serialize clock to JSON string
   */
  toJSON(): string {
    return JSON.stringify(this.clock);
  }

  /**
   * Create clock from JSON string
   */
  static fromJSON(clientId: string, json: string): VectorClock {
    const clock = JSON.parse(json) as VectorClockMap;
    return new VectorClock(clientId, clock);
  }

  /**
   * Merge two clocks and return a new merged clock
   * (doesn't modify inputs)
   */
  static merge(
    clientId: string,
    clock1: VectorClockMap,
    clock2: VectorClockMap
  ): VectorClockMap {
    const merged: VectorClockMap = { ...clock1 };

    for (const [id, timestamp] of Object.entries(clock2)) {
      merged[id] = Math.max(merged[id] || 0, timestamp);
    }

    return merged;
  }

  /**
   * Compare two clocks without creating instances
   */
  static compare(clock1: VectorClockMap, clock2: VectorClockMap): ClockComparison {
    let isLessOrEqual = true;
    let isGreaterOrEqual = true;

    const allClientIds = new Set([
      ...Object.keys(clock1),
      ...Object.keys(clock2),
    ]);

    for (const clientId of allClientIds) {
      const ts1 = clock1[clientId] || 0;
      const ts2 = clock2[clientId] || 0;

      if (ts1 < ts2) {
        isGreaterOrEqual = false;
      }
      if (ts1 > ts2) {
        isLessOrEqual = false;
      }
    }

    if (isLessOrEqual && isGreaterOrEqual) {
      return 'equal';
    } else if (isLessOrEqual) {
      return 'before';
    } else if (isGreaterOrEqual) {
      return 'after';
    } else {
      return 'concurrent';
    }
  }
}

/**
 * Create a new vector clock instance
 */
export function createVectorClock(
  clientId: string,
  initialClock?: VectorClockMap
): VectorClock {
  return new VectorClock(clientId, initialClock);
}
