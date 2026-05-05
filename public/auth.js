document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        if (response.ok) {
          localStorage.setItem('nutcheck_token', data.token);
          localStorage.setItem('nutcheck_user', JSON.stringify(data.user));
          window.location.href = '/dashboard.html';
        } else {
          alert(data.message || 'ล็อกอินไม่สำเร็จ');
        }
      } catch (err) {
        console.error(err);
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
      }
    });
  }
});
