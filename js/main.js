/**
 * Main Landing Page Scripts
 * Handles navigation, mobile sidebar drawer, and interactive animations
 */

document.addEventListener('DOMContentLoaded', () => {
  // Update footer copyright year dynamically
  const yearElement = document.getElementById('current-year');
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  // Navigation button handlers
  const soloBtn = document.getElementById('soloBtn');
  if (soloBtn) {
    soloBtn.addEventListener('click', () => {
      window.location.href = 'solo.html';
    });
  }

  const createRoomBtn = document.getElementById('createRoomBtn');
  if (createRoomBtn) {
    createRoomBtn.addEventListener('click', () => {
      window.location.href = 'create-room.html';
    });
  }

  const joinRoomBtn = document.getElementById('joinRoomBtn');
  if (joinRoomBtn) {
    joinRoomBtn.addEventListener('click', () => {
      window.location.href = 'join-room.html';
    });
  }

  // Sidebar navigation drawer
  const menuBtn = document.querySelector('.menu-btn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.overlay');
  const mainContent = document.querySelector('main.landing-main');

  if (menuBtn && sidebar && overlay) {
    const toggleSidebar = () => {
      const isOpen = sidebar.classList.toggle('open');
      overlay.classList.toggle('open', isOpen);
      menuBtn.classList.toggle('open', isOpen);
      if (mainContent) {
        mainContent.classList.toggle('shifted', isOpen);
      }
    };

    const closeSidebar = () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
      menuBtn.classList.remove('open');
      if (mainContent) {
        mainContent.classList.remove('shifted');
      }
    };

    menuBtn.addEventListener('click', toggleSidebar);
    overlay.addEventListener('click', closeSidebar);

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) {
        closeSidebar();
      }
    });
  }

  // Micro-interaction animation for feature cards & buttons
  const buttons = document.querySelectorAll('.btn');
  buttons.forEach(button => {
    const icon = button.querySelector('i');
    if (icon) {
      button.addEventListener('mouseenter', () => {
        icon.style.transform = 'scale(1.2)';
        icon.style.transition = 'transform 0.2s ease';
      });
      button.addEventListener('mouseleave', () => {
        icon.style.transform = 'scale(1)';
      });
    }
  });
});
