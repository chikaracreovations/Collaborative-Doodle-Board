/**
 * Create Room Script
 * Handles room code generation, user display name caching, and navigation
 */

document.addEventListener('DOMContentLoaded', () => {
  // Update footer copyright year dynamically
  const yearElement = document.getElementById('current-year');
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  // Pre-fill previously stored username
  const userNameInput = document.getElementById('userName');
  const savedName = localStorage.getItem('userName');
  if (savedName && userNameInput) {
    userNameInput.value = savedName;
  }

  // Back button functionality
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = 'index.html';
      }
    });
  }

  // Helper: Generate a clean 6-character alphanumeric room code
  function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // Room Creation Handler
  const createRoomBtn = document.getElementById('createRoomBtn');
  const roomNameInput = document.getElementById('roomName');
  const roomPasswordInput = document.getElementById('roomPassword');

  const handleCreateRoom = () => {
    const roomName = roomNameInput ? roomNameInput.value.trim() : '';
    const userName = userNameInput ? userNameInput.value.trim() : '';
    const password = roomPasswordInput ? roomPasswordInput.value : '';

    if (!roomName) {
      alert('Please enter a room name');
      roomNameInput?.focus();
      return;
    }

    if (!userName) {
      alert('Please enter your display name');
      userNameInput?.focus();
      return;
    }

    const roomId = generateRoomId();

    // Persist display name for convenience
    localStorage.setItem('userName', userName);

    // Redirect to collaborative room as host
    const passwordParam = password ? `&password=${encodeURIComponent(password)}` : '';
    const nameParam = `&roomName=${encodeURIComponent(roomName)}`;
    window.location.href = `room.html?roomId=${roomId}&host=true${nameParam}${passwordParam}`;
  };

  if (createRoomBtn) {
    createRoomBtn.addEventListener('click', handleCreateRoom);
  }

  // Allow enter key submission
  [roomNameInput, userNameInput, roomPasswordInput].forEach(input => {
    input?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleCreateRoom();
      }
    });
  });
});
