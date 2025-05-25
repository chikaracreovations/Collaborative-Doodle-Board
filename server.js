const WebSocket = require('ws');
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });
const rooms = {};

// Track message rates per user
const messageRates = {};
const PING_INTERVAL = 30000; // 30 seconds

wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const roomId = urlParams.get('roomId');
  const userId = urlParams.get('userId');
  const userName = decodeURIComponent(urlParams.get('userName') || `User-${userId.substr(0, 4)}`);

  if (!roomId || !userId) {
    ws.close(4001, 'Missing roomId or userId');
    return;
  }

  if (!rooms[roomId]) {
    rooms[roomId] = {
      users: {},
      canvasState: null,
      hostId: userId // First user becomes host
    };
  }

  const room = rooms[roomId];
  
  // Initialize user tracking
  messageRates[userId] = { lastDraw: 0, count: 0 };
  
  // Add user to room
  room.users[userId] = {
    ws,
    userName,
    color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`,
    lastActive: Date.now()
  };

  // Set up ping/pong
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, PING_INTERVAL);

  // Notify all users in room about new count
  broadcastUserCount(room);

  // Send welcome message with current state if available
  if (room.canvasState && userId !== room.hostId) {
    safeSend(ws, {
      type: 'state',
      state: room.canvasState,
      version: room.version || 0
    });
  }

  // Notify others about new user
  broadcastToRoom(room, {
    type: 'userJoin',
    userId,
    userName,
    color: room.users[userId].color
  }, userId);

  ws.on('message', (message) => {
    try {
      room.users[userId].lastActive = Date.now();
      const data = JSON.parse(message);
      
      // Rate limiting
      if (messageRates[userId].count > 500) { // More reasonable safety limit
        console.log(`Rate limiting user ${userId}`);
        return;
      }
      messageRates[userId].count++;
      
      switch(data.type) {
        case 'draw':
          // Less aggressive throttle (30ms)
          if (Date.now() - messageRates[userId].lastDraw < 30) {
            return;
          }
          messageRates[userId].lastDraw = Date.now();
          broadcastToRoom(room, data, userId);
          break;
          
        case 'drawBatch':
          // Immediately broadcast batches
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
          // Only host can update state
          if (userId === room.hostId) {
            room.canvasState = data.state;
            room.version = (room.version || 0) + 1;
            // Broadcast to all except host (host already has latest)
            broadcastToRoom(room, {
              type: 'state',
              state: data.state,
              version: room.version
            }, userId);
          }
          break;
          
        case 'requestState':
          // Send current state to requesting user
          if (room.canvasState) {
            safeSend(ws, {
              type: 'state',
              state: room.canvasState,
              version: room.version || 0
            });
          }
          break;
          
        case 'cursorMove':
          // Broadcast cursor position
          broadcastToRoom(room, {
            ...data,
            color: room.users[userId]?.color
          }, userId);
          break;
          
        case 'pong':
          // Update last active on pong
          room.users[userId].lastActive = Date.now();
          break;
          
        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (e) {
      console.error('Error handling message:', e);
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    
    // Clean up user data
    delete messageRates[userId];
    
    // Remove user from room if still exists
    if (room.users[userId]) {
      delete room.users[userId];
      
      // Notify others about user leaving
      broadcastToRoom(room, {
        type: 'userLeave',
        userId
      });
      
      // Update user count
      broadcastUserCount(room);
      
      // If host left, assign new host
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
    console.error('WebSocket error:', err);
    ws.close();
  });

  // Reset message count every second
  const rateTimer = setInterval(() => {
    if (messageRates[userId]) {
      messageRates[userId].count = 0;
    }
  }, 1000);

  ws.on('close', () => {
    clearInterval(rateTimer);
  });
});

function broadcastToRoom(room, message, excludeUserId = null) {
  Object.entries(room.users).forEach(([id, user]) => {
    if (id !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
      safeSend(user.ws, message);
    }
  });
}

function broadcastUserCount(room) {
  const count = Object.keys(room.users).length;
  broadcastToRoom(room, {
    type: 'userCount',
    count
  });
}

function safeSend(ws, data) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  } catch (e) {
    console.error('Error sending message:', e);
  }
}

// Clean up inactive connections
setInterval(() => {
  const now = Date.now();
  Object.entries(rooms).forEach(([roomId, room]) => {
    Object.entries(room.users).forEach(([userId, user]) => {
      if (now - user.lastActive > PING_INTERVAL * 2) {
        console.log(`Closing inactive connection: ${userId}`);
        user.ws.close(4002, 'Inactive connection');
      }
    });
  });
}, PING_INTERVAL);

console.log(`WebSocket server running on port ${port}`);

