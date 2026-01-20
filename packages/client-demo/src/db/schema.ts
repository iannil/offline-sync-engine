/**
 * Local schema definitions for the demo app
 * In a real app, these would come from @offline-sync/sdk
 */

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

export const todoSchema = {
  title: 'todo',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    completed: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    deleted: { type: 'boolean', default: false },
  },
  required: ['id', 'text', 'createdAt', 'updatedAt'],
} as const;
