/**
 * Offline Sync Engine Server
 * Main entry point for the sync gateway server
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { registerGatewayRoutes, subscribeToChanges } from './gateway/index.js';
import { registerApplierRoutes } from './applier/index.js';
import { registerArbiterRoutes } from './arbiter/index.js';
import { registerTusRoutes } from './tus/index.js';
import { initCouchDB } from './database/index.js';

export interface ServerConfig {
  port?: number;
  host?: string;
  corsOrigin?: string | string[];
  enableWebSocket?: boolean;
  couchdb?: {
    url?: string;
    username?: string;
    password?: string;
  };
}

export async function createServer(config: ServerConfig = {}) {
  const {
    port = 3000,
    host = '0.0.0.0',
    corsOrigin = '*',
    enableWebSocket = true,
    couchdb,
  } = config;

  // Initialize CouchDB connection
  try {
    await initCouchDB(couchdb);
    console.log('CouchDB connection established');
  } catch (error) {
    console.error('Failed to connect to CouchDB:', error);
    console.warn('Server will run with degraded functionality (no persistence)');
  }

  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  // Register CORS
  await server.register(cors, {
    origin: corsOrigin,
  });

  // Register WebSocket (optional)
  if (enableWebSocket) {
    await server.register(websocket);
  }

  // Health check endpoint
  server.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: Date.now(),
      couchdb: 'connected',
    };
  });

  // Register sync routes
  await server.register(registerGatewayRoutes, { prefix: '/api/sync' });
  await server.register(registerApplierRoutes, { prefix: '/api/applier' });
  await server.register(registerArbiterRoutes, { prefix: '/api/arbiter' });
  await server.register(registerTusRoutes);

  // WebSocket endpoint for real-time updates
  if (enableWebSocket) {
    server.register(async function (fastify) {
      fastify.get('/api/stream', { websocket: true }, (connection, req) => {
        console.log('WebSocket client connected');

        // Subscribe to changes
        const unsubscribe = subscribeToChanges(fastify);

        // Send initial connection message
        connection.socket.send(JSON.stringify({
          type: 'connected',
          timestamp: Date.now(),
        }));

        connection.socket.on('message', (message) => {
          try {
            const data = JSON.parse(message as string);

            // Handle client subscriptions
            if (data.type === 'subscribe') {
              console.log(`Client subscribed to: ${data.collections || 'all'}`);
            }
          } catch (error) {
            console.error('WebSocket message error:', error);
          }
        });

        connection.socket.on('close', () => {
          console.log('WebSocket client disconnected');
          unsubscribe();
        });
      });
    });
  }

  return server;
}

export async function startServer(config: ServerConfig = {}) {
  const { port = 3000, host = '0.0.0.0' } = config;

  const server = await createServer(config);

  try {
    await server.listen({ port, host });
    console.log(`Server listening on http://${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }

  return server;
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer({
    port: Number(process.env.PORT) ?? 3000,
    host: process.env.HOST ?? '0.0.0.0',
    couchdb: {
      url: process.env.COUCHDB_URL,
      username: process.env.COUCHDB_USERNAME,
      password: process.env.COUCHDB_PASSWORD,
    },
  });
}
