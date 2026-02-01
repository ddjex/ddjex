/**
 * ddjex WebSocket Manager
 * Handles WebSocket connections for ddjex programs
 */

import { logger } from './logger.js';

// Security: Maximum payload size to prevent memory issues (1MB)
const MAX_WS_PAYLOAD_SIZE = 1024 * 1024;

// Security: Allowed WebSocket protocols
const ALLOWED_WS_PROTOCOLS = ['ws:', 'wss:'];

class WebSocketManager {
  constructor() {
    this.connections = new Map();
    this.handlers = new Map();
  }

  /**
   * Connect to a WebSocket server
   */
  connect(id, url, options = {}) {
    return new Promise((resolve, reject) => {
      // Security: Validate WebSocket URL scheme
      try {
        const parsedUrl = new URL(url);
        if (!ALLOWED_WS_PROTOCOLS.includes(parsedUrl.protocol)) {
          reject({
            error: true,
            code: 'INVALID_WS_PROTOCOL',
            message: `WebSocket URL must use ws:// or wss:// protocol, got: ${parsedUrl.protocol}`
          });
          return;
        }
      } catch (e) {
        reject({
          error: true,
          code: 'INVALID_WS_URL',
          message: `Invalid WebSocket URL: ${e.message}`
        });
        return;
      }

      if (this.connections.has(id)) {
        this.disconnect(id);
      }

      const ws = new WebSocket(url);
      const connection = {
        ws,
        url,
        status: 'connecting',
        reconnect: options.reconnect ?? true,
        reconnectInterval: options.reconnectInterval ?? 1000,
        maxReconnects: options.maxReconnects ?? 10,
        reconnectCount: 0,
        handlers: new Map()
      };

      ws.onopen = () => {
        connection.status = 'connected';
        connection.reconnectCount = 0;
        this.emit(id, 'open', { id, url });
        resolve({ id, status: 'connected' });
      };

      ws.onclose = (event) => {
        connection.status = 'disconnected';
        this.emit(id, 'close', { id, code: event.code, reason: event.reason });

        // Auto-reconnect
        if (connection.reconnect && connection.reconnectCount < connection.maxReconnects) {
          connection.reconnectCount++;
          setTimeout(() => {
            if (connection.reconnect) {
              this.connect(id, url, options);
            }
          }, connection.reconnectInterval);
        }
      };

      ws.onerror = (error) => {
        this.emit(id, 'error', { id, error: error.message || 'Connection error' });
        if (connection.status === 'connecting') {
          reject({ error: true, code: 'WS_CONNECT_ERROR', message: 'Failed to connect' });
        }
      };

      ws.onmessage = (event) => {
        let data = event.data;

        // Security: Check payload size before processing
        if (typeof data === 'string' && data.length > MAX_WS_PAYLOAD_SIZE) {
          this.emit(id, 'error', {
            id,
            error: `Payload too large (${data.length} bytes, max ${MAX_WS_PAYLOAD_SIZE})`,
            code: 'PAYLOAD_TOO_LARGE'
          });
          return;
        }

        // Try to parse JSON
        try {
          data = JSON.parse(event.data);
        } catch (e) {
          // Keep as string
        }

        this.emit(id, 'message', { id, data });
      };

      this.connections.set(id, connection);
    });
  }

  /**
   * Send data through WebSocket
   */
  send(id, data) {
    const connection = this.connections.get(id);
    if (!connection || connection.status !== 'connected') {
      return { error: true, code: 'WS_NOT_CONNECTED', message: `WebSocket ${id} is not connected` };
    }

    const message = typeof data === 'string' ? data : JSON.stringify(data);
    connection.ws.send(message);
    return { sent: true };
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(id) {
    const connection = this.connections.get(id);
    if (connection) {
      connection.reconnect = false; // Prevent auto-reconnect
      connection.ws.close();
      this.connections.delete(id);
      return { disconnected: true };
    }
    return { error: true, code: 'WS_NOT_FOUND', message: `WebSocket ${id} not found` };
  }

  /**
   * Get connection status
   */
  status(id) {
    const connection = this.connections.get(id);
    if (!connection) {
      return { status: 'not_found' };
    }
    return {
      status: connection.status,
      url: connection.url,
      reconnectCount: connection.reconnectCount
    };
  }

  /**
   * Register event handler
   */
  on(id, event, handler) {
    const key = `${id}:${event}`;
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    this.handlers.get(key).add(handler);
    return () => this.handlers.get(key).delete(handler);
  }

  /**
   * Emit event to handlers
   */
  emit(id, event, data) {
    const key = `${id}:${event}`;
    const handlers = this.handlers.get(key);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (e) {
          logger.error(`WebSocket handler error:`, e);
        }
      }
    }

    // Also emit to wildcard handlers
    const wildcardKey = `${id}:*`;
    const wildcardHandlers = this.handlers.get(wildcardKey);
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler({ event, ...data });
        } catch (e) {
          logger.error(`WebSocket handler error:`, e);
        }
      }
    }
  }

  /**
   * Close all connections
   */
  disconnectAll() {
    for (const id of this.connections.keys()) {
      this.disconnect(id);
    }
  }
}

// Singleton instance
let wsManager = null;

function getWebSocketManager() {
  if (!wsManager) {
    wsManager = new WebSocketManager();
  }
  return wsManager;
}

export { WebSocketManager, getWebSocketManager };
