const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

const rooms = {};

// Track message rates per user
const messageRates = {};

wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const roomId = urlParams.get('roomId');
  const userId = urlParams.get('userId');
  const userName = decodeURIComponent(urlParams.get('userName') || `User-${userId.substr(0, 4)}`);

  if (!rooms[roomId]) {
    rooms[roomId] = {
      users: {},
      canvasState: null,
      drawBatches: {}
    };
  }

  const room = rooms[roomId];
  
  // Initialize user tracking
  messageRates[userId] = { lastDraw: 0, count: 0 };
  
  // Add user to room
  room.users[userId] = {
    ws,
    userName,
    color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`
  };

  // Notify all users in room about new count
  broadcastUserCount(room);

  // Send welcome message with current state if available
  if (room.canvasState) {
    safeSend(ws, {
      type: 'state',
      state: room.canvasState
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
      const data = JSON.parse(message);
      
      // Rate limiting
      if (messageRates[userId].count > 1000) { // Safety limit
        console.log(`Rate limiting user ${userId}`);
        return;
      }
      messageRates[userId].count++;
      
      switch(data.type) {
        case 'draw':
          // Throttle rapid draw messages
          if (Date.now() - messageRates[userId].lastDraw < 10) {
            return;
          }
          messageRates[userId].lastDraw = Date.now();
          broadcastToRoom(room, data, userId);
          break;
          
        case 'drawBatch':
          // Handle batched draw commands
          if (!room.drawBatches[userId]) {
            room.drawBatches[userId] = [];
            // Process batches on next tick
            setImmediate(() => {
              if (room.drawBatches[userId] && room.drawBatches[userId].length > 0) {
                broadcastToRoom(room, {
                  type: 'drawBatch',
                  commands: room.drawBatches[userId],
                  userId
                }, userId);
                delete room.drawBatches[userId];
              }
            });
          }
          room.drawBatches[userId].push(...data.commands);
          break;
          
        case 'clear':
          room.canvasState = null;
          broadcastToRoom(room, data, userId);
          break;
          
        case 'state':
          // Host is sending updated state
          if (data.userId === userId) {
            room.canvasState = data.state;
          }
          break;
          
        case 'requestState':
          // Send current state to requesting user
          if (room.canvasState) {
            safeSend(room.users[userId].ws, {
              type: 'state',
              state: room.canvasState
            });
          }
          break;
          
        case 'cursorMove':
          // Broadcast cursor position
          broadcastToRoom(room, data, userId);
          break;
          
        default:
          broadcastToRoom(room, data, userId);
      }
    } catch (e) {
      console.error('Error handling message:', e);
    }
  });

  ws.on('close', () => {
    // Clean up user data
    delete messageRates[userId];
    
    // Remove pending batches
    if (room.drawBatches[userId]) {
      delete room.drawBatches[userId];
    }
    
    // Remove user from room
    delete room.users[userId];
    
    // Notify others about user leaving
    broadcastToRoom(room, {
      type: 'userLeave',
      userId
    });
    
    // Update user count
    broadcastUserCount(room);
    
    // Clean up empty rooms
    if (Object.keys(room.users).length === 0) {
      delete rooms[roomId];
    }
  });

  // Reset message count every second
  const rateTimer = setInterval(() => {
    messageRates[userId].count = 0;
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

// Clean up empty rooms periodically
setInterval(() => {
  Object.keys(rooms).forEach(roomId => {
    if (Object.keys(rooms[roomId].users).length === 0) {
      console.log(`Cleaning up empty room: ${roomId}`);
      delete rooms[roomId];
    }
  });
}, 60000); // Every minute

console.log('WebSocket server running on ws://localhost:8080');