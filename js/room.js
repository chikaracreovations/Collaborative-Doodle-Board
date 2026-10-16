/**
 * Collaborative Whiteboard Client Script
 * Handles real-time drawing synchronization, WebSocket networking,
 * presence indicators, undo/redo history, and export features.
 */

document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const canvas = document.getElementById('whiteboard');
  const ctx = canvas.getContext('2d');
  const colorPicker = document.getElementById('colorPicker');
  const sizePicker = document.getElementById('sizePicker');
  const eraserBtn = document.getElementById('eraserBtn');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const menuBtn = document.getElementById('menuBtn');
  const menuPopup = document.getElementById('menu-popup');
  const clearBtn = document.getElementById('clearBtn');
  const saveBtn = document.getElementById('saveBtn');
  const loadBtn = document.getElementById('loadBtn');
  const leaveBtn = document.getElementById('leaveBtn');
  const roomIdDisplay = document.getElementById('room-id');
  const userCountDisplay = document.getElementById('user-count');
  const copyRoomIdBtn = document.getElementById('copy-room-id');
  const connectionStatus = document.getElementById('connection-status');

  // Helper: Generate random user/session ID
  function generateId() {
    return Math.random().toString(36).substring(2, 10);
  }

  // Room state initialization
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('roomId') || generateId();
  const isHost = urlParams.get('host') === 'true';
  const userId = generateId();
  const userName = localStorage.getItem('userName') || `User-${userId.substring(0, 4)}`;

  if (roomIdDisplay) {
    roomIdDisplay.textContent = roomId;
  }

  // Drawing state
  let drawing = false;
  let erasing = false;
  let drawingHistory = [];
  let currentStateIndex = -1;
  const MAX_HISTORY_STATES = 50;

  // Remote presence
  let userCount = 1;
  const otherUsers = {};

  // Network batching (~60fps)
  let socket = null;
  let pingInterval = null;
  let drawQueue = [];
  let lastSendTime = 0;
  const SEND_INTERVAL = 16;
  const MAX_BATCH_SIZE = 50;
  const RECONNECT_DELAY = 2000;
  const PING_INTERVAL = 30000;

  // Compute smart WebSocket URL
  function getSocketUrl() {
    // If running via HTTP/HTTPS server (local dev or full-stack deploy)
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      // If hosted on GitHub Pages (*.github.io), point to remote cloud backend
      if (window.location.hostname.endsWith('github.io')) {
        return 'wss://collaborative-doodle-board-server.onrender.com';
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.host}`;
    }
    // Fallback if opened via file:// or static server without WS
    return 'wss://collaborative-doodle-board-server.onrender.com';
  }

  const socketUrl = getSocketUrl();

  // Canvas helper methods
  CanvasRenderingContext2D.prototype.setCurrentPoint = function(point) {
    this.currentPoint = point;
  };
  CanvasRenderingContext2D.prototype.getCurrentPoint = function() {
    return this.currentPoint;
  };

  // Resize canvas to window dimensions while preserving drawing
  function resizeCanvas() {
    const toolbar = document.getElementById('toolbar');
    const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
    
    // Save current canvas content before resize
    const prevImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - toolbarHeight;

    if (drawingHistory.length > 0 && currentStateIndex >= 0) {
      redrawCanvas(drawingHistory[currentStateIndex]);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Broadcast viewport size to peers
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'viewport',
        width: canvas.width,
        height: canvas.height,
        userId
      }));
    }
  }

  // Canvas History (Undo/Redo)
  function saveState() {
    if (currentStateIndex < drawingHistory.length - 1) {
      drawingHistory = drawingHistory.slice(0, currentStateIndex + 1);
    }

    if (drawingHistory.length >= MAX_HISTORY_STATES) {
      drawingHistory.shift();
      currentStateIndex--;
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    drawingHistory.push(imageData);
    currentStateIndex++;
    updateUndoRedoButtons();
  }

  function redrawCanvas(imageData) {
    if (imageData) {
      ctx.putImageData(imageData, 0, 0);
    }
  }

  function undo() {
    if (currentStateIndex > 0) {
      currentStateIndex--;
      redrawCanvas(drawingHistory[currentStateIndex]);
      updateUndoRedoButtons();
      broadcastCanvasState();
    }
  }

  function redo() {
    if (currentStateIndex < drawingHistory.length - 1) {
      currentStateIndex++;
      redrawCanvas(drawingHistory[currentStateIndex]);
      updateUndoRedoButtons();
      broadcastCanvasState();
    }
  }

  function updateUndoRedoButtons() {
    if (undoBtn) undoBtn.disabled = currentStateIndex <= 0;
    if (redoBtn) redoBtn.disabled = currentStateIndex >= drawingHistory.length - 1;
  }

  // Pointer position calculation
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  // Drawing event handlers
  function startDraw(e) {
    drawing = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.setCurrentPoint(pos);

    saveState();
    broadcastCursorPosition(pos.x, pos.y);
    e.preventDefault();
  }

  function endDraw(e) {
    if (drawing) {
      drawing = false;
      ctx.beginPath();
      processDrawQueue(true);
      saveState();

      if (e.type !== 'mouseout') {
        const pos = getPos(e);
        broadcastCursorPosition(pos.x, pos.y);
      }
    }
    e.preventDefault();
  }

  function draw(e) {
    if (!drawing) return;

    const pos = getPos(e);
    const prevPos = ctx.getCurrentPoint() || pos;

    ctx.lineWidth = sizePicker ? sizePicker.value : 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = erasing ? '#ffffff' : (colorPicker ? colorPicker.value : '#000000');

    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    drawQueue.push({
      x0: prevPos.x,
      y0: prevPos.y,
      x1: pos.x,
      y1: pos.y,
      color: colorPicker ? colorPicker.value : '#000000',
      size: sizePicker ? sizePicker.value : 2,
      isErasing: erasing
    });

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.setCurrentPoint(pos);

    e.preventDefault();
  }

  // Queue-based batching for smooth multi-user rendering
  function processDrawQueue(force = false) {
    const now = Date.now();
    const shouldSend = force ||
      (drawQueue.length >= 10) ||
      (drawQueue.length > 0 && (now - lastSendTime >= SEND_INTERVAL));

    if (shouldSend && socket && socket.readyState === WebSocket.OPEN) {
      const batch = drawQueue.slice(0, MAX_BATCH_SIZE);
      socket.send(JSON.stringify({
        type: 'drawBatch',
        commands: batch,
        userId
      }));

      drawQueue = drawQueue.slice(batch.length);
      lastSendTime = now;
    }
  }

  function broadcastCursorPosition(x, y) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'cursorMove',
        x,
        y,
        userId,
        userName,
        color: colorPicker ? colorPicker.value : '#0ea5e9'
      }));
    }
  }

  function broadcastCanvasState() {
    if (socket && socket.readyState === WebSocket.OPEN && isHost) {
      const state = {
        imageData: canvas.toDataURL(),
        version: Date.now()
      };
      socket.send(JSON.stringify({
        type: 'state',
        state: JSON.stringify(state),
        userId
      }));
    }
  }

  function clearCanvas() {
    saveState();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    saveState();

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'clear',
        userId
      }));
    }
  }

  // Remote Event Handlers
  function handleRemoteDraw(message) {
    if (message.userId === userId) return;

    const { x0, y0, x1, y1, color, size, isErasing } = message;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = isErasing ? '#ffffff' : color;

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  function handleRemoteDrawBatch(message) {
    if (message.userId === userId || !message.commands || message.commands.length === 0) return;

    const firstCmd = message.commands[0];
    ctx.lineWidth = firstCmd.size || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = firstCmd.isErasing ? '#ffffff' : (firstCmd.color || '#000000');

    ctx.beginPath();
    message.commands.forEach(cmd => {
      ctx.moveTo(cmd.x0, cmd.y0);
      ctx.lineTo(cmd.x1, cmd.y1);
    });
    ctx.stroke();
  }

  function handleRemoteClear() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    saveState();
  }

  function handleCanvasState(state) {
    try {
      const parsed = typeof state === 'string' ? JSON.parse(state) : state;
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        saveState();
      };
      img.src = parsed.imageData || parsed;
    } catch (err) {
      console.error('Failed to load received canvas state:', err);
    }
  }

  function handleUserJoin(message) {
    if (message.userId === userId) return;

    const cursor = document.createElement('div');
    cursor.className = 'user-cursor';
    cursor.id = `cursor-${message.userId}`;
    cursor.style.backgroundColor = message.color || '#0ea5e9';

    const nameTag = document.createElement('div');
    nameTag.className = 'user-name-tag';
    nameTag.id = `name-${message.userId}`;
    nameTag.textContent = message.userName || 'Guest';

    document.body.appendChild(cursor);
    document.body.appendChild(nameTag);

    otherUsers[message.userId] = { cursor, nameTag };
  }

  function handleUserLeave(leavingUserId) {
    if (otherUsers[leavingUserId]) {
      document.body.removeChild(otherUsers[leavingUserId].cursor);
      document.body.removeChild(otherUsers[leavingUserId].nameTag);
      delete otherUsers[leavingUserId];
    }
  }

  function handleCursorMove(message) {
    if (message.userId === userId || !otherUsers[message.userId]) return;
    const { cursor, nameTag } = otherUsers[message.userId];
    cursor.style.left = `${message.x}px`;
    cursor.style.top = `${message.y}px`;
    nameTag.style.left = `${message.x}px`;
    nameTag.style.top = `${message.y}px`;
  }

  function updateUserCount(count) {
    userCount = count;
    if (userCountDisplay) {
      userCountDisplay.textContent = `${count} user${count !== 1 ? 's' : ''}`;
    }
  }

  // WebSocket Connection & Reconnection Logic
  function connectWebSocket() {
    if (socket) {
      socket.onclose = null;
      socket.close();
    }

    if (connectionStatus) {
      connectionStatus.textContent = 'Connecting...';
      connectionStatus.style.backgroundColor = '#f59e0b';
    }

    const wsUrl = `${socketUrl}?roomId=${encodeURIComponent(roomId)}&userId=${encodeURIComponent(userId)}&userName=${encodeURIComponent(userName)}`;
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('Connected to Collaborative Whiteboard WebSocket server');
      if (connectionStatus) {
        connectionStatus.textContent = 'Live';
        connectionStatus.style.backgroundColor = '#10b981';
      }

      // Heartbeat pings
      pingInterval = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL);

      // Request latest canvas state if joiner
      if (!isHost) {
        socket.send(JSON.stringify({
          type: 'requestState',
          userId
        }));
      }
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        switch (message.type) {
          case 'draw':
            handleRemoteDraw(message);
            break;
          case 'drawBatch':
            handleRemoteDrawBatch(message);
            break;
          case 'clear':
            handleRemoteClear();
            break;
          case 'state':
            handleCanvasState(message.state);
            break;
          case 'userJoin':
            handleUserJoin(message);
            break;
          case 'userLeave':
            handleUserLeave(message.userId);
            break;
          case 'cursorMove':
            handleCursorMove(message);
            break;
          case 'userCount':
            updateUserCount(message.count);
            break;
          case 'hostPromotion':
            console.log('You have been promoted to room host');
            break;
          case 'pong':
            break;
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    };

    socket.onclose = () => {
      if (connectionStatus) {
        connectionStatus.textContent = 'Reconnecting...';
        connectionStatus.style.backgroundColor = '#ef4444';
      }
      if (pingInterval) clearInterval(pingInterval);

      // Clean up remote user avatars
      Object.keys(otherUsers).forEach(id => handleUserLeave(id));

      setTimeout(connectWebSocket, RECONNECT_DELAY + Math.random() * 1500);
    };

    socket.onerror = (err) => {
      console.error('WebSocket connection error:', err);
      if (connectionStatus) {
        connectionStatus.textContent = 'Connection Error';
        connectionStatus.style.backgroundColor = '#ef4444';
      }
    };
  }

  // Event Listeners Registration
  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseout', endDraw);
  canvas.addEventListener('mousemove', draw);

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    canvas.dispatchEvent(mouseEvent);
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    canvas.dispatchEvent(mouseEvent);
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    const mouseEvent = new MouseEvent('mouseup', {});
    canvas.dispatchEvent(mouseEvent);
  }, { passive: false });

  // Broadcast mouse position across canvas when not drawing
  document.addEventListener('mousemove', (e) => {
    if (!drawing) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x >= 0 && x <= canvas.width && y >= 0 && y <= canvas.height) {
        broadcastCursorPosition(x, y);
      }
    }
  });

  // Toolbar Actions
  if (eraserBtn) {
    eraserBtn.addEventListener('click', () => {
      erasing = !erasing;
      eraserBtn.classList.toggle('active', erasing);
    });
  }

  if (undoBtn) undoBtn.addEventListener('click', undo);
  if (redoBtn) redoBtn.addEventListener('click', redo);

  if (menuBtn && menuPopup) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menuPopup.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!menuBtn.contains(e.target) && !menuPopup.contains(e.target)) {
        menuPopup.classList.remove('show');
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear the canvas?')) {
        clearCanvas();
      }
      menuPopup?.classList.remove('show');
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = `whiteboard-${roomId}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      menuPopup?.classList.remove('show');
    });
  }

  if (loadBtn) {
    loadBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
              saveState();
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              saveState();
              broadcastCanvasState();
            };
            img.src = event.target.result;
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
      menuPopup?.classList.remove('show');
    });
  }

  if (leaveBtn) {
    leaveBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to leave this room?')) {
        window.location.href = 'index.html';
      }
    });
  }

  if (copyRoomIdBtn) {
    copyRoomIdBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(roomId)
        .then(() => {
          const originalText = copyRoomIdBtn.innerHTML;
          copyRoomIdBtn.innerHTML = '✓ Copied';
          setTimeout(() => {
            copyRoomIdBtn.innerHTML = originalText;
          }, 2000);
        })
        .catch(err => {
          console.error('Failed to copy room ID:', err);
        });
    });
  }

  // Window lifecycle
  window.addEventListener('resize', resizeCanvas);

  // Initialize
  resizeCanvas();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  connectWebSocket();
  setInterval(processDrawQueue, SEND_INTERVAL);

  if (isHost) {
    saveState();
  }
});
