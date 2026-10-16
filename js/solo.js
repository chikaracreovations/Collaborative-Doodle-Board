/**
 * Solo Whiteboard Script
 * Offline / single-player sketching canvas with history, eraser, and export
 */

document.addEventListener('DOMContentLoaded', () => {
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

  let drawing = false;
  let erasing = false;
  let drawingHistory = [];
  let currentStateIndex = -1;
  const MAX_HISTORY_STATES = 50;

  function resizeCanvas() {
    const toolbar = document.getElementById('toolbar');
    const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight - toolbarHeight;

    if (drawingHistory.length > 0 && currentStateIndex >= 0) {
      redrawCanvas(drawingHistory[currentStateIndex]);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

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
    }
  }

  function redo() {
    if (currentStateIndex < drawingHistory.length - 1) {
      currentStateIndex++;
      redrawCanvas(drawingHistory[currentStateIndex]);
      updateUndoRedoButtons();
    }
  }

  function updateUndoRedoButtons() {
    if (undoBtn) undoBtn.disabled = currentStateIndex <= 0;
    if (redoBtn) redoBtn.disabled = currentStateIndex >= drawingHistory.length - 1;
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function startDraw(e) {
    drawing = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    saveState();
    e.preventDefault();
  }

  function endDraw(e) {
    if (drawing) {
      drawing = false;
      ctx.beginPath();
      saveState();
    }
    e.preventDefault();
  }

  function draw(e) {
    if (!drawing) return;
    const pos = getPos(e);
    ctx.lineWidth = sizePicker ? sizePicker.value : 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = erasing ? '#ffffff' : (colorPicker ? colorPicker.value : '#000000');
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  }

  // Pointer & Touch Events
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
      if (confirm('Clear the entire canvas?')) {
        saveState();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        saveState();
      }
      menuPopup?.classList.remove('show');
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = `doodle-solo-${Date.now()}.png`;
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
      window.location.href = 'index.html';
    });
  }

  window.addEventListener('resize', resizeCanvas);

  // Initialize
  resizeCanvas();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  saveState();
});
