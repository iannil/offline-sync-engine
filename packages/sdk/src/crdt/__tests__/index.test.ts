/**
 * CRDT Manager unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CRDTManager,
  createCRDTManager,
  CRDTState,
  CRDTUpdate,
} from '../index.js';

describe('CRDTManager', () => {
  let manager: CRDTManager;

  beforeEach(() => {
    manager = new CRDTManager({ clientId: 'test-client' });
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('constructor', () => {
    it('should create manager with custom client ID', () => {
      expect(manager.getClientId()).toBe('test-client');
    });

    it('should generate client ID if not provided', () => {
      const autoManager = new CRDTManager();
      expect(autoManager.getClientId()).toMatch(/^client-\d+-\w+$/);
      autoManager.destroy();
    });

    it('should accept gc option', () => {
      const gcManager = new CRDTManager({ gc: false });
      expect(gcManager).toBeDefined();
      gcManager.destroy();
    });
  });

  describe('getDocument', () => {
    it('should create new document for collection/documentId', () => {
      const doc = manager.getDocument('todos', 'doc-1');
      expect(doc).toBeDefined();
      expect(doc.guid).toBeDefined();
    });

    it('should return same document for same collection/documentId', () => {
      const doc1 = manager.getDocument('todos', 'doc-1');
      const doc2 = manager.getDocument('todos', 'doc-1');
      expect(doc1).toBe(doc2);
    });

    it('should create different documents for different documentIds', () => {
      const doc1 = manager.getDocument('todos', 'doc-1');
      const doc2 = manager.getDocument('todos', 'doc-2');
      expect(doc1).not.toBe(doc2);
    });

    it('should create different documents for different collections', () => {
      const doc1 = manager.getDocument('todos', 'doc-1');
      const doc2 = manager.getDocument('products', 'doc-1');
      expect(doc1).not.toBe(doc2);
    });
  });

  describe('hasDocument', () => {
    it('should return false for non-existent document', () => {
      expect(manager.hasDocument('todos', 'doc-1')).toBe(false);
    });

    it('should return true after document is created', () => {
      manager.getDocument('todos', 'doc-1');
      expect(manager.hasDocument('todos', 'doc-1')).toBe(true);
    });
  });

  describe('setField / getField', () => {
    it('should set and get primitive field', () => {
      manager.setField('todos', 'doc-1', 'text', 'Hello World');
      expect(manager.getField('todos', 'doc-1', 'text')).toBe('Hello World');
    });

    it('should set and get number field', () => {
      manager.setField('todos', 'doc-1', 'count', 42);
      expect(manager.getField('todos', 'doc-1', 'count')).toBe(42);
    });

    it('should set and get boolean field', () => {
      manager.setField('todos', 'doc-1', 'completed', true);
      expect(manager.getField('todos', 'doc-1', 'completed')).toBe(true);
    });

    it('should set and get object field', () => {
      const obj = { nested: 'value', num: 123 };
      manager.setField('todos', 'doc-1', 'metadata', obj);
      expect(manager.getField('todos', 'doc-1', 'metadata')).toEqual(obj);
    });

    it('should set and get array field', () => {
      const arr = ['item1', 'item2', 'item3'];
      manager.setField('todos', 'doc-1', 'tags', arr);
      expect(manager.getField('todos', 'doc-1', 'tags')).toEqual(arr);
    });

    it('should delete field when set to null', () => {
      manager.setField('todos', 'doc-1', 'text', 'Hello');
      manager.setField('todos', 'doc-1', 'text', null);
      expect(manager.getField('todos', 'doc-1', 'text')).toBeUndefined();
    });

    it('should delete field when set to undefined', () => {
      manager.setField('todos', 'doc-1', 'text', 'Hello');
      manager.setField('todos', 'doc-1', 'text', undefined);
      expect(manager.getField('todos', 'doc-1', 'text')).toBeUndefined();
    });

    it('should return undefined for non-existent field', () => {
      manager.getDocument('todos', 'doc-1');
      expect(manager.getField('todos', 'doc-1', 'nonexistent')).toBeUndefined();
    });
  });

  describe('getFields', () => {
    it('should return empty array for new document', () => {
      manager.getDocument('todos', 'doc-1');
      expect(manager.getFields('todos', 'doc-1')).toEqual([]);
    });

    it('should return all field names', () => {
      manager.setField('todos', 'doc-1', 'text', 'Hello');
      manager.setField('todos', 'doc-1', 'completed', false);
      manager.setField('todos', 'doc-1', 'priority', 1);

      const fields = manager.getFields('todos', 'doc-1');
      expect(fields).toContain('text');
      expect(fields).toContain('completed');
      expect(fields).toContain('priority');
      expect(fields.length).toBe(3);
    });
  });

  describe('setFields', () => {
    it('should set multiple fields at once', () => {
      manager.setFields('todos', 'doc-1', {
        text: 'Hello',
        completed: false,
        priority: 1,
      });

      expect(manager.getField('todos', 'doc-1', 'text')).toBe('Hello');
      expect(manager.getField('todos', 'doc-1', 'completed')).toBe(false);
      expect(manager.getField('todos', 'doc-1', 'priority')).toBe(1);
    });

    it('should handle nested objects in setFields', () => {
      manager.setFields('todos', 'doc-1', {
        text: 'Hello',
        metadata: { author: 'John', tags: ['work'] },
      });

      expect(manager.getField('todos', 'doc-1', 'metadata')).toEqual({
        author: 'John',
        tags: ['work'],
      });
    });

    it('should delete fields set to null in batch', () => {
      manager.setFields('todos', 'doc-1', {
        text: 'Hello',
        completed: false,
      });

      manager.setFields('todos', 'doc-1', {
        text: null,
      });

      expect(manager.getField('todos', 'doc-1', 'text')).toBeUndefined();
      expect(manager.getField('todos', 'doc-1', 'completed')).toBe(false);
    });
  });

  describe('getData', () => {
    it('should return empty object for new document', () => {
      manager.getDocument('todos', 'doc-1');
      expect(manager.getData('todos', 'doc-1')).toEqual({});
    });

    it('should return all fields as plain object', () => {
      manager.setFields('todos', 'doc-1', {
        text: 'Hello',
        completed: true,
        count: 5,
      });

      expect(manager.getData('todos', 'doc-1')).toEqual({
        text: 'Hello',
        completed: true,
        count: 5,
      });
    });
  });

  describe('getState', () => {
    it('should return state with state vector and full update', () => {
      manager.setField('todos', 'doc-1', 'text', 'Hello');
      const state = manager.getState('todos', 'doc-1');

      expect(state).toHaveProperty('stateVector');
      expect(state).toHaveProperty('fullUpdate');
      expect(state).toHaveProperty('documentId', 'doc-1');
      expect(state).toHaveProperty('collection', 'todos');
      expect(state.stateVector).toBeInstanceOf(Uint8Array);
      expect(state.fullUpdate).toBeInstanceOf(Uint8Array);
    });

    it('should return different state after modifications', () => {
      manager.setField('todos', 'doc-1', 'text', 'Hello');
      const state1 = manager.getState('todos', 'doc-1');

      manager.setField('todos', 'doc-1', 'text', 'World');
      const state2 = manager.getState('todos', 'doc-1');

      // Full update should be different
      expect(state1.fullUpdate.length).not.toBe(state2.fullUpdate.length);
    });
  });

  describe('getIncrementalUpdate', () => {
    it('should return full update when no state vector provided', () => {
      manager.setField('todos', 'doc-1', 'text', 'Hello');
      const update = manager.getIncrementalUpdate('todos', 'doc-1');

      expect(update).toBeInstanceOf(Uint8Array);
      expect(update.length).toBeGreaterThan(0);
    });

    it('should return incremental update since state vector', () => {
      manager.setField('todos', 'doc-1', 'text', 'Hello');
      const state1 = manager.getState('todos', 'doc-1');

      manager.setField('todos', 'doc-1', 'completed', true);
      const incrementalUpdate = manager.getIncrementalUpdate(
        'todos',
        'doc-1',
        state1.stateVector
      );

      // Incremental update should be smaller than full state
      const fullUpdate = manager.getState('todos', 'doc-1').fullUpdate;
      expect(incrementalUpdate.length).toBeLessThanOrEqual(fullUpdate.length);
    });
  });

  describe('applyUpdate', () => {
    it('should apply update from another manager', () => {
      const manager2 = new CRDTManager({ clientId: 'client-2' });

      // Manager 2 makes changes
      manager2.setField('todos', 'doc-1', 'text', 'From Manager 2');
      const state = manager2.getState('todos', 'doc-1');

      // Manager 1 applies the update
      const update: CRDTUpdate = {
        update: state.fullUpdate,
        documentId: 'doc-1',
        collection: 'todos',
        origin: 'client-2',
      };
      manager.applyUpdate(update);

      // Manager 1 should now have the data
      expect(manager.getField('todos', 'doc-1', 'text')).toBe('From Manager 2');

      manager2.destroy();
    });
  });

  describe('applyState', () => {
    it('should apply full state from another manager', () => {
      const manager2 = new CRDTManager({ clientId: 'client-2' });

      // Manager 2 has some data
      manager2.setFields('todos', 'doc-1', {
        text: 'Hello',
        completed: true,
      });
      const state = manager2.getState('todos', 'doc-1');

      // Manager 1 applies the state
      manager.applyState(state);

      // Manager 1 should have all the data
      expect(manager.getData('todos', 'doc-1')).toEqual({
        text: 'Hello',
        completed: true,
      });

      manager2.destroy();
    });
  });

  describe('merge', () => {
    it('should merge concurrent changes from two managers', () => {
      const manager2 = new CRDTManager({ clientId: 'client-2' });

      // Both managers start with same document
      manager.setField('todos', 'doc-1', 'text', 'Initial');
      manager2.applyState(manager.getState('todos', 'doc-1'));

      // Manager 1 changes 'text'
      manager.setField('todos', 'doc-1', 'text', 'Changed by M1');

      // Manager 2 adds 'completed'
      manager2.setField('todos', 'doc-1', 'completed', true);

      // Merge manager2's state into manager1
      const mergedState = manager.merge(
        'todos',
        'doc-1',
        manager2.getState('todos', 'doc-1')
      );

      // Manager 1 should now have both changes
      const data = manager.getData('todos', 'doc-1');
      expect(data).toHaveProperty('completed', true);
      // The 'text' field will be resolved by Yjs CRDT rules

      manager2.destroy();
    });
  });

  describe('markSynced', () => {
    it('should mark document as synced with state vector', () => {
      manager.setField('todos', 'doc-1', 'text', 'Hello');
      const state = manager.getState('todos', 'doc-1');

      manager.markSynced('todos', 'doc-1', state.stateVector);

      // No error thrown
      expect(true).toBe(true);
    });
  });

  describe('deleteDocument', () => {
    it('should delete document from memory', () => {
      manager.setField('todos', 'doc-1', 'text', 'Hello');
      expect(manager.hasDocument('todos', 'doc-1')).toBe(true);

      manager.deleteDocument('todos', 'doc-1');
      expect(manager.hasDocument('todos', 'doc-1')).toBe(false);
    });

    it('should not throw for non-existent document', () => {
      expect(() => manager.deleteDocument('todos', 'nonexistent')).not.toThrow();
    });
  });

  describe('getDocumentKeys', () => {
    it('should return empty array when no documents', () => {
      expect(manager.getDocumentKeys()).toEqual([]);
    });

    it('should return all document keys', () => {
      manager.getDocument('todos', 'doc-1');
      manager.getDocument('todos', 'doc-2');
      manager.getDocument('products', 'prod-1');

      const keys = manager.getDocumentKeys();
      expect(keys).toHaveLength(3);
      expect(keys).toContainEqual({ collection: 'todos', documentId: 'doc-1' });
      expect(keys).toContainEqual({ collection: 'todos', documentId: 'doc-2' });
      expect(keys).toContainEqual({
        collection: 'products',
        documentId: 'prod-1',
      });
    });
  });

  describe('onLocalChange callback', () => {
    it('should call callback when local changes occur', () => {
      const callback = vi.fn();
      const callbackManager = new CRDTManager({
        clientId: 'callback-client',
        onLocalChange: callback,
      });

      callbackManager.setField('todos', 'doc-1', 'text', 'Hello');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'doc-1',
          collection: 'todos',
          origin: 'callback-client',
        })
      );

      callbackManager.destroy();
    });

    it('should not call callback for remote updates', () => {
      const callback = vi.fn();
      const callbackManager = new CRDTManager({
        clientId: 'callback-client',
        onLocalChange: callback,
      });

      // Create another manager and get its state
      const remoteManager = new CRDTManager({ clientId: 'remote' });
      remoteManager.setField('todos', 'doc-1', 'text', 'Remote');
      const remoteState = remoteManager.getState('todos', 'doc-1');

      // Apply remote state
      callback.mockClear();
      callbackManager.applyState(remoteState);

      // Callback should NOT be called for remote updates
      expect(callback).not.toHaveBeenCalled();

      callbackManager.destroy();
      remoteManager.destroy();
    });
  });

  describe('destroy', () => {
    it('should clean up all documents', () => {
      manager.getDocument('todos', 'doc-1');
      manager.getDocument('todos', 'doc-2');

      manager.destroy();

      // After destroy, manager should be in destroyed state
      expect(manager.getDocumentKeys()).toEqual([]);
    });

    it('should be idempotent', () => {
      manager.destroy();
      expect(() => manager.destroy()).not.toThrow();
    });
  });

  describe('serialization', () => {
    describe('stateToBase64 / stateFromBase64', () => {
      it('should serialize and deserialize state', () => {
        manager.setFields('todos', 'doc-1', {
          text: 'Hello',
          completed: true,
        });
        const state = manager.getState('todos', 'doc-1');

        const base64 = CRDTManager.stateToBase64(state);
        expect(typeof base64).toBe('string');

        const restored = CRDTManager.stateFromBase64(base64);
        expect(restored.documentId).toBe(state.documentId);
        expect(restored.collection).toBe(state.collection);
        expect(restored.stateVector).toBeInstanceOf(Uint8Array);
        expect(restored.fullUpdate).toBeInstanceOf(Uint8Array);
      });

      it('should preserve data through serialization round-trip', () => {
        manager.setFields('todos', 'doc-1', {
          text: 'Hello',
          count: 42,
        });
        const originalState = manager.getState('todos', 'doc-1');

        // Serialize and deserialize
        const base64 = CRDTManager.stateToBase64(originalState);
        const restoredState = CRDTManager.stateFromBase64(base64);

        // Apply to new manager
        const newManager = new CRDTManager({ clientId: 'new' });
        newManager.applyState(restoredState);

        expect(newManager.getData('todos', 'doc-1')).toEqual({
          text: 'Hello',
          count: 42,
        });

        newManager.destroy();
      });
    });

    describe('updateToBase64 / updateFromBase64', () => {
      it('should serialize and deserialize update', () => {
        manager.setField('todos', 'doc-1', 'text', 'Hello');
        const state = manager.getState('todos', 'doc-1');

        const update: CRDTUpdate = {
          update: state.fullUpdate,
          documentId: 'doc-1',
          collection: 'todos',
          origin: 'test-client',
        };

        const base64 = CRDTManager.updateToBase64(update);
        expect(typeof base64).toBe('string');

        const restored = CRDTManager.updateFromBase64(base64);
        expect(restored.documentId).toBe(update.documentId);
        expect(restored.collection).toBe(update.collection);
        expect(restored.origin).toBe(update.origin);
        expect(restored.update).toBeInstanceOf(Uint8Array);
      });
    });
  });
});

describe('createCRDTManager', () => {
  it('should create a new CRDTManager instance', () => {
    const manager = createCRDTManager({ clientId: 'factory-test' });
    expect(manager).toBeInstanceOf(CRDTManager);
    expect(manager.getClientId()).toBe('factory-test');
    manager.destroy();
  });

  it('should work without options', () => {
    const manager = createCRDTManager();
    expect(manager).toBeInstanceOf(CRDTManager);
    manager.destroy();
  });
});
