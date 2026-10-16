/**
 * Collaborative Doodle Board - Real-Time Backend Server
 * 
 * Combines an HTTP static file server (for serving HTML/CSS/JS)
 * with a high-performance WebSocket server for multi-user whiteboard synchronization.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const ROOT_DIR = path.join(__dirname, '..');

// MIME types for static asset serving
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// HTTP Static Server
const server = http.createServer((req, res) => {
  // Normalize request path
  let reqUrl = req.url.split('?')[0];

  // Route aliases for backward compatibility & clean URLs
  if (reqUrl === '/' || reqUrl === '/main.html') {
    reqUrl = '/index.html';
  } else if (reqUrl === '/createroom.html') {
    reqUrl = '/create-room.html';
  } else if (reqUrl === '/joinroom.html') {
    reqUrl = '/join-room.html';
  }

  // Prevent directory traversal
  const safePath = path.normalize(reqUrl).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT_DIR, safePath);

  // Check if file exists
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// WebSocket Server attached to the HTTP server
const wss = new WebSocket.Server({ server });

// State & presence tracking
const rooms = {};
const messageRates = {};
const PING_INTERVAL = 30000; // 30 seconds

wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
  const roomId = urlParams.get('roomId');
  const userId = urlParams.get('userId');
  const userName = decodeURIComponent(urlParams.get('userName') || `User-${userId ? userId.substring(0, 4) : 'Guest'}`);

  if (!roomId || !userId) {
    ws.close(4001, 'Missing roomId or userId');
    return;
  }

  // Create room if it doesn't exist
  if (!rooms[roomId]) {
    rooms[roomId] = {
      users: {},
      canvasState: null,
      hostId: userId,
      version: 0
    };
  }

  const room = rooms[roomId];

  // Initialize rate limiting per user
  messageRates[userId] = { lastDraw: 0, count: 0 };

  // Register user in room
  room.users[userId] = {
    ws,
    userName,
    color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`,
    lastActive: Date.now()
  };

  // Heartbeat ping interval
  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, PING_INTERVAL);

  // Broadcast updated room occupancy
  broadcastUserCount(room);

  // Send initial canvas state to newly joined user (if host has drawn)
  if (room.canvasState && userId !== room.hostId) {
    safeSend(ws, {
      type: 'state',
      state: room.canvasState,
      version: room.version || 0
    });
  }

  // Announce user arrival to other peers
  broadcastToRoom(room, {
    type: 'userJoin',
    userId,
    userName,
    color: room.users[userId].color
  }, userId);

  // Incoming message dispatcher
  ws.on('message', (message) => {
    try {
      room.users[userId].lastActive = Date.now();
      const data = JSON.parse(message);

      // Rate limit protection
      if (messageRates[userId].count > 500) {
        return;
      }
      messageRates[userId].count++;

      switch (data.type) {
        case 'draw':
          if (Date.now() - messageRates[userId].lastDraw < 25) {
            return;
          }
          messageRates[userId].lastDraw = Date.now();
          broadcastToRoom(room, data, userId);
          break;

        case 'drawBatch':
          if (data.commands && data.commands.length > 0) {
            broadcastToRoom(room, {
              type: 'drawBatch',
              commands: data.commands,
              userId
            }, userId);
          }
          break;

        case 'clear':
          room.canvasState = null;
          room.version = (room.version || 0) + 1;
          broadcastToRoom(room, data, userId);
          break;

        case 'state':
          if (userId === room.hostId) {
            room.canvasState = data.state;
            room.version = (room.version || 0) + 1;
            broadcastToRoom(room, {
              type: 'state',
              state: data.state,
              version: room.version
            }, userId);
          }
          break;

        case 'requestState':
          if (room.canvasState) {
            safeSend(ws, {
              type: 'state',
              state: room.canvasState,
              version: room.version || 0
            });
          }
          break;

        case 'cursorMove':
          broadcastToRoom(room, {
            ...data,
            color: room.users[userId]?.color
          }, userId);
          break;

        case 'pong':
          room.users[userId].lastActive = Date.now();
          break;

        default:
          break;
      }
    } catch (e) {
      console.error('Error handling WebSocket message:', e);
    }
  });

  // Disconnection handler
  ws.on('close', () => {
    clearInterval(pingTimer);
    delete messageRates[userId];

    if (room.users[userId]) {
      delete room.users[userId];

      broadcastToRoom(room, {
        type: 'userLeave',
        userId
      });

      broadcastUserCount(room);

      // Re-assign room host if previous host left
      if (userId === room.hostId && Object.keys(room.users).length > 0) {
        room.hostId = Object.keys(room.users)[0];
        safeSend(room.users[room.hostId].ws, {
          type: 'hostPromotion'
        });
      }
    }

    // Clean up empty rooms
    if (Object.keys(room.users).length === 0) {
      delete rooms[roomId];
    }
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for user ${userId}:`, err);
    ws.close();
  });

  // Reset rate counter every second
  const rateInterval = setInterval(() => {
    if (messageRates[userId]) {
      messageRates[userId].count = 0;
    }
  }, 1000);

  ws.on('close', () => {
    clearInterval(rateInterval);
  });
});

// Helper: Broadcast payload to all peers in a room
function broadcastToRoom(room, message, excludeUserId = null) {
  Object.entries(room.users).forEach(([id, user]) => {
    if (id !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
      safeSend(user.ws, message);
    }
  });
}

// Helper: Broadcast room count
function broadcastUserCount(room) {
  const count = Object.keys(room.users).length;
  broadcastToRoom(room, {
    type: 'userCount',
    count
  });
}

// Helper: Safe JSON send
function safeSend(ws, data) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  } catch (e) {
    console.error('Error sending WebSocket payload:', e);
  }
}

// Periodic cleanup of stale connections
setInterval(() => {
  const now = Date.now();
  Object.entries(rooms).forEach(([roomId, room]) => {
    Object.entries(room.users).forEach(([userId, user]) => {
      if (now - user.lastActive > PING_INTERVAL * 2) {
        console.log(`Terminating idle connection: ${userId}`);
        user.ws.close(4002, 'Idle timeout');
      }
    });
  });
}, PING_INTERVAL);

// Start server
server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🎨 Collaborative Doodle Board Server Running`);
  console.log(`🌐 Local Web App: http://localhost:${PORT}`);
  console.log(`⚡ WebSocket URL: ws://localhost:${PORT}`);
  console.log(`===============================================`);
});
