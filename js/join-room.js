/**
 * Join Room Script
 * Handles room ID entry, recent room history from localStorage, and navigation
 */

document.addEventListener('DOMContentLoaded', () => {
  // Update footer copyright year dynamically
  const yearElement = document.getElementById('current-year');
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  // Pre-fill previously stored username
  const userNameInput = document.getElementById('userName');
  const roomIdInput = document.getElementById('roomId');
  const roomPasswordInput = document.getElementById('roomPassword');
  const recentRoomsList = document.getElementById('recentRooms');

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

  // Load and display recent rooms from localStorage
  const recentRooms = JSON.parse(localStorage.getItem('recentRooms') || '[]');

  function updateRecentRoomsList() {
    if (!recentRoomsList) return;
    recentRoomsList.innerHTML = '';

    if (recentRooms.length === 0) {
      const emptyMsg = document.createElement('li');
      emptyMsg.className = 'room-item';
      emptyMsg.style.justifyContent = 'center';
      emptyMsg.style.opacity = '0.6';
      emptyMsg.textContent = 'No recent rooms';
      recentRoomsList.appendChild(emptyMsg);
      return;
    }

    recentRooms.slice(0, 3).forEach(room => {
      const li = document.createElement('li');
      li.className = 'room-item';
      li.innerHTML = `
        <span><i class="fas fa-hashtag"></i> ${room.id}</span>
        <i class="fas fa-chevron-right"></i>
      `;
      li.addEventListener('click', () => {
        if (roomIdInput) roomIdInput.value = room.id;
        if (room.userName && userNameInput && !userNameInput.value) {
          userNameInput.value = room.userName;
        }
      });
      recentRoomsList.appendChild(li);
    });
  }

  updateRecentRoomsList();

  // Join Room Handler
  const joinBtn = document.getElementById('joinBtn');

  const handleJoin = () => {
    const roomId = roomIdInput ? roomIdInput.value.trim().toUpperCase() : '';
    const userName = userNameInput ? userNameInput.value.trim() : '';
    const password = roomPasswordInput ? roomPasswordInput.value : '';

    if (!roomId) {
      alert('Please enter a room ID');
      roomIdInput?.focus();
      return;
    }

    if (!userName) {
      alert('Please enter your display name');
      userNameInput?.focus();
      return;
    }

    // Update recent rooms cache (max 5)
    const existingIndex = recentRooms.findIndex(r => r.id === roomId);
    if (existingIndex >= 0) {
      recentRooms.splice(existingIndex, 1);
    }
    recentRooms.unshift({ id: roomId, userName });
    if (recentRooms.length > 5) recentRooms.pop();
    localStorage.setItem('recentRooms', JSON.stringify(recentRooms));

    // Cache user display name
    localStorage.setItem('userName', userName);

    // Redirect to collaborative room
    const passwordParam = password ? `&password=${encodeURIComponent(password)}` : '';
    window.location.href = `room.html?roomId=${encodeURIComponent(roomId)}${passwordParam}`;
  };

  if (joinBtn) {
    joinBtn.addEventListener('click', handleJoin);
  }

  // Allow enter key submission
  [roomIdInput, userNameInput, roomPasswordInput].forEach(input => {
    input?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleJoin();
      }
    });
  });
});
