/**
 * Product schema definition
 * @module storage/schemas/product
 */

import type { RxJsonSchema } from 'rxdb';

/**
 * Product schema
 */
export const productSchema: RxJsonSchema<Product> = {
  title: 'product',
  version: 0,
  description: 'A product in the inventory',
  type: 'object',
  primaryKey: 'id',
  properties: {
    id: {
      type: 'string',
    },
    name: {
      type: 'string',
      minLength: 1,
    },
    price: {
      type: 'number',
      minimum: 0,
    },
    stock: {
      type: 'integer',
      minimum: 0,
    },
    category: {
      type: 'string',
    },
    description: {
      type: 'string',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
    },
    deleted: {
      type: 'boolean',
      default: false,
    },
  },
  required: ['id', 'name', 'price', 'stock', 'category', 'createdAt', 'updatedAt'],
  indexes: ['createdAt', 'category', 'deleted'],
};

/**
 * Product type definition
 */
export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}
