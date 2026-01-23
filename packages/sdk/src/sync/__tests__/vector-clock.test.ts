/**
 * Tests for VectorClock implementation
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  VectorClock,
  createVectorClock,
  type VectorClockMap,
} from '../vector-clock.js';

describe('VectorClock', () => {
  describe('Construction', () => {
    it('should create empty clock with client entry', () => {
      const clock = new VectorClock('client-1');
      expect(clock.getClientId()).toBe('client-1');
      expect(clock.getTimestamp()).toBe(0);
      expect(clock.getClock()).toEqual({ 'client-1': 0 });
    });

    it('should initialize with provided clock', () => {
      const initial: VectorClockMap = {
        'client-1': 5,
        'client-2': 3,
      };
      const clock = new VectorClock('client-1', initial);
      expect(clock.getTimestamp('client-1')).toBe(5);
      expect(clock.getTimestamp('client-2')).toBe(3);
    });

    it('should not mutate initial clock', () => {
      const initial: VectorClockMap = { 'client-1': 5 };
      const clock = new VectorClock('client-1', initial);
      clock.increment();
      expect(initial['client-1']).toBe(5);
      expect(clock.getTimestamp()).toBe(6);
    });
  });

  describe('increment', () => {
    it('should increment local timestamp', () => {
      const clock = new VectorClock('client-1');
      expect(clock.getTimestamp()).toBe(0);

      clock.increment();
      expect(clock.getTimestamp()).toBe(1);

      clock.increment();
      expect(clock.getTimestamp()).toBe(2);
    });

    it('should return current clock state', () => {
      const clock = new VectorClock('client-1');
      const result = clock.increment();
      expect(result).toEqual({ 'client-1': 1 });
    });
  });

  describe('merge', () => {
    it('should take max of each component', () => {
      const clock1 = new VectorClock('client-1', {
        'client-1': 5,
        'client-2': 3,
      });
      const remoteClock: VectorClockMap = {
        'client-1': 3,
        'client-2': 7,
        'client-3': 2,
      };

      clock1.merge(remoteClock);

      expect(clock1.getTimestamp('client-1')).toBe(6); // max(5,3) + 1
      expect(clock1.getTimestamp('client-2')).toBe(7);
      expect(clock1.getTimestamp('client-3')).toBe(2);
    });

    it('should add new clients from remote', () => {
      const clock = new VectorClock('client-1');
      clock.merge({ 'client-2': 5 });

      expect(clock.getTimestamp('client-2')).toBe(5);
    });
  });

  describe('compare', () => {
    it('should return equal for identical clocks', () => {
      const clock1 = new VectorClock('client-1', {
        'client-1': 5,
        'client-2': 3,
      });
      const clock2: VectorClockMap = {
        'client-1': 5,
        'client-2': 3,
      };

      expect(clock1.compare(clock2)).toBe('equal');
    });

    it('should return before when local is strictly less', () => {
      const clock1 = new VectorClock('client-1', {
        'client-1': 3,
        'client-2': 2,
      });
      const clock2: VectorClockMap = {
        'client-1': 5,
        'client-2': 3,
      };

      expect(clock1.compare(clock2)).toBe('before');
    });

    it('should return after when local is strictly greater', () => {
      const clock1 = new VectorClock('client-1', {
        'client-1': 5,
        'client-2': 4,
      });
      const clock2: VectorClockMap = {
        'client-1': 3,
        'client-2': 2,
      };

      expect(clock1.compare(clock2)).toBe('after');
    });

    it('should return concurrent for divergent clocks', () => {
      const clock1 = new VectorClock('client-1', {
        'client-1': 5,
        'client-2': 2,
      });
      const clock2: VectorClockMap = {
        'client-1': 3,
        'client-2': 4,
      };

      expect(clock1.compare(clock2)).toBe('concurrent');
    });

    it('should handle missing clients correctly', () => {
      const clock1 = new VectorClock('client-1', {
        'client-1': 5,
      });
      const clock2: VectorClockMap = {
        'client-1': 5,
        'client-2': 3, // client-1 doesn't have this
      };

      expect(clock1.compare(clock2)).toBe('before');
    });
  });

  describe('dominates / isDominatedBy / isConcurrentWith', () => {
    it('dominates should return true when after', () => {
      const clock = new VectorClock('client-1', {
        'client-1': 5,
        'client-2': 4,
      });
      const other: VectorClockMap = {
        'client-1': 3,
        'client-2': 2,
      };

      expect(clock.dominates(other)).toBe(true);
      expect(clock.isDominatedBy(other)).toBe(false);
    });

    it('isDominatedBy should return true when before', () => {
      const clock = new VectorClock('client-1', {
        'client-1': 3,
        'client-2': 2,
      });
      const other: VectorClockMap = {
        'client-1': 5,
        'client-2': 4,
      };

      expect(clock.isDominatedBy(other)).toBe(true);
      expect(clock.dominates(other)).toBe(false);
    });

    it('isConcurrentWith should return true for concurrent', () => {
      const clock = new VectorClock('client-1', {
        'client-1': 5,
        'client-2': 2,
      });
      const other: VectorClockMap = {
        'client-1': 3,
        'client-2': 4,
      };

      expect(clock.isConcurrentWith(other)).toBe(true);
    });
  });

  describe('clone', () => {
    it('should create independent copy', () => {
      const clock = new VectorClock('client-1', {
        'client-1': 5,
        'client-2': 3,
      });
      const cloned = clock.clone();

      clock.increment();

      expect(clock.getTimestamp()).toBe(6);
      expect(cloned.getTimestamp()).toBe(5);
    });
  });

  describe('JSON serialization', () => {
    it('should serialize and deserialize correctly', () => {
      const clock = new VectorClock('client-1', {
        'client-1': 5,
        'client-2': 3,
      });

      const json = clock.toJSON();
      const restored = VectorClock.fromJSON('client-1', json);

      expect(restored.getClock()).toEqual(clock.getClock());
    });
  });

  describe('Static methods', () => {
    it('VectorClock.merge should merge without mutating', () => {
      const clock1: VectorClockMap = { 'client-1': 5, 'client-2': 3 };
      const clock2: VectorClockMap = { 'client-1': 3, 'client-2': 7 };

      const merged = VectorClock.merge('client-1', clock1, clock2);

      expect(merged).toEqual({
        'client-1': 5,
        'client-2': 7,
      });
      // Original clocks unchanged
      expect(clock1).toEqual({ 'client-1': 5, 'client-2': 3 });
      expect(clock2).toEqual({ 'client-1': 3, 'client-2': 7 });
    });

    it('VectorClock.compare should work statically', () => {
      const clock1: VectorClockMap = { 'client-1': 5, 'client-2': 2 };
      const clock2: VectorClockMap = { 'client-1': 3, 'client-2': 4 };

      expect(VectorClock.compare(clock1, clock2)).toBe('concurrent');
    });
  });

  describe('createVectorClock helper', () => {
    it('should create clock instance', () => {
      const clock = createVectorClock('client-1');
      expect(clock).toBeInstanceOf(VectorClock);
      expect(clock.getClientId()).toBe('client-1');
    });

    it('should accept initial clock', () => {
      const clock = createVectorClock('client-1', { 'client-1': 10 });
      expect(clock.getTimestamp()).toBe(10);
    });
  });

  describe('Sync scenarios', () => {
    let clientA: VectorClock;
    let clientB: VectorClock;
    let server: VectorClock;

    beforeEach(() => {
      clientA = new VectorClock('client-a');
      clientB = new VectorClock('client-b');
      server = new VectorClock('server');
    });

    it('should track causal order in simple sync', () => {
      // Client A makes a write
      clientA.increment();
      expect(clientA.getClock()).toEqual({ 'client-a': 1 });

      // Server receives from A
      server.merge(clientA.getClock());
      expect(server.getTimestamp('client-a')).toBe(1);
      expect(server.getTimestamp('server')).toBe(1);

      // Client B syncs with server
      clientB.merge(server.getClock());
      expect(clientB.getTimestamp('client-a')).toBe(1);
      expect(clientB.getTimestamp('server')).toBe(1);

      // Client B now knows about A's write
      expect(clientB.compare(clientA.getClock())).toBe('after');
    });

    it('should detect concurrent writes', () => {
      // Both clients write concurrently (without syncing)
      clientA.increment();
      clientB.increment();

      // Both have changes the other doesn't know about
      expect(clientA.compare(clientB.getClock())).toBe('concurrent');
      expect(clientB.compare(clientA.getClock())).toBe('concurrent');
    });

    it('should resolve concurrent writes after merge', () => {
      // Both clients write concurrently
      clientA.increment();
      clientA.increment(); // client-a: 2
      clientB.increment(); // client-b: 1

      // Server receives from A first
      server.merge(clientA.getClock());
      // server: { client-a: 2, server: 1 }

      // Server receives from B (concurrent)
      server.merge(clientB.getClock());
      // server: { client-a: 2, client-b: 1, server: 2 }

      // Server now dominates both
      expect(server.dominates(clientA.getClock())).toBe(true);
      expect(server.dominates(clientB.getClock())).toBe(true);

      // After server merges all, clients can sync with server
      // and get a consistent view of all changes
      expect(server.getTimestamp('client-a')).toBe(2);
      expect(server.getTimestamp('client-b')).toBe(1);
      expect(server.getTimestamp('server')).toBe(2);
    });

    it('should handle offline-to-online scenario', () => {
      // Initial sync
      clientA.increment();
      server.merge(clientA.getClock());
      clientB.merge(server.getClock());

      // Client A goes offline and makes multiple writes
      clientA.increment();
      clientA.increment();
      clientA.increment(); // client-a: 4

      // Meanwhile, client B writes
      clientB.increment(); // client-b: 2

      // Client B syncs with server
      server.merge(clientB.getClock());

      // Client A comes back online
      // First, detect conflict
      expect(clientA.isConcurrentWith(server.getClock())).toBe(true);

      // Sync with server (A's offline changes merge with B's changes)
      server.merge(clientA.getClock());
      clientA.merge(server.getClock());

      // Now A has all changes
      expect(clientA.getTimestamp('client-a')).toBeGreaterThan(4);
      expect(clientA.getTimestamp('client-b')).toBe(2);
    });
  });
});
