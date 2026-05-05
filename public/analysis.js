let allStudents = [];
let aiChartInstance = null;

async function init() {
  const token = localStorage.getItem('nutcheck_token');
  const userStr = localStorage.getItem('nutcheck_user');
  
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  let isAdminOrTeacher = false;
  let user = null;
  if (userStr) {
    user = JSON.parse(userStr);
    const userInfoEl = document.getElementById('userInfo');
    if (userInfoEl) userInfoEl.textContent = `ผู้ใช้งาน: ${user.username} (${user.role})`;
    isAdminOrTeacher = user.role === 'admin' || user.role === 'teacher';
  }

  if (!isAdminOrTeacher) {
    // Strict student view
    document.querySelector('.student-list-panel').style.display = 'none';
    document.querySelector('.analysis-container').style.gridTemplateColumns = '1fr';
    document.querySelector('#gradesEditSection h3').innerHTML = '📝 กรอกคะแนนของฉัน <span id="mockedBadge" style="font-size:0.7rem; background:#fbbf24; color:#92400e; padding:0.2rem 0.5rem; border-radius:4px; display:none; vertical-align:middle;">ข้อมูลจำลอง</span>';
    
    if (!user || !user.studentId) {
      document.getElementById('emptyState').innerHTML = '<h2 style="margin:0; font-size:1.5rem; color:#ef4444;">ไม่พบรหัสนักเรียนที่ผูกกับบัญชีนี้</h2>';
      return;
    }
    
    try {
      const studentRes = await fetch(`/api/students/${user.studentId}`, { headers: { 'Authorization': `Bearer ${token}` } });
      const studentData = await studentRes.json();
      selectStudent({ id: user.studentId, name: studentData.name || user.username });
    } catch(e) {
      selectStudent({ id: user.studentId, name: user.username });
    }
  } else {
    // Admin/Teacher view
    try {
      const res = await fetch("/api/dashboard/students", { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) throw new Error("Unauthorized");
      allStudents = await res.json();
      renderStudentList(allStudents);
      
      const params = new URLSearchParams(window.location.search);
      const studentId = params.get('id');
      if (studentId) {
        const student = allStudents.find(s => s.id === studentId);
        if (student) selectStudent(student);
      }
    } catch (err) {
      window.location.href = '/login.html';
    }
  }
}

function renderStudentList(students) {
  const container = document.getElementById('studentList');
  if (students.length === 0) {
    container.innerHTML = '<p class="muted">ไม่พบนักเรียน</p>';
    return;
  }
  container.innerHTML = students.map(s => `
    <div class="student-item" data-id="${s.id}" data-name="${s.name}">
      <strong style="display:block;">${s.name}</strong>
      <span style="font-size:0.8rem; color:#6b7280;">รหัส: ${s.id} | ห้อง: ${s.class_name || '-'}</span>
    </div>
  `).join('');

  document.querySelectorAll('.student-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const name = el.dataset.name;
      selectStudent({ id, name });
    });
  });
}

document.getElementById('searchStudent').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = allStudents.filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
  renderStudentList(filtered);
});

async function selectStudent(student) {
  document.querySelectorAll('.student-item').forEach(el => el.classList.remove('active'));
  const activeEl = document.querySelector(`.student-item[data-id="${student.id}"]`);
  if (activeEl) activeEl.classList.add('active');

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('analysisContent').style.display = 'block';

  document.getElementById('aiStudentName').textContent = student.name;
  document.getElementById('aiStudentId').value = student.id;
  
  document.getElementById('aiSuggestion').textContent = 'AI NUTNUT กำลังวิเคราะห์ข้อมูล...';
  document.getElementById('aiDescription').textContent = 'รอสักครู่...';
  document.getElementById('mockedBadge').style.display = 'none';
  if (aiChartInstance) {
    aiChartInstance.destroy();
    aiChartInstance = null;
  }

  await loadAiAnalysis(student.id);
}

async function loadAiAnalysis(id) {
  const token = localStorage.getItem('nutcheck_token');
  try {
    const res = await fetch(`/api/students/${id}/analysis`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) throw new Error("โหลดข้อมูลวิเคราะห์ไม่ได้");
    const data = await res.json();
    
    document.getElementById('g_math').value = data.grades["คณิตศาสตร์"] || 0;
    document.getElementById('g_sci').value = data.grades["วิทยาศาสตร์"] || 0;
    document.getElementById('g_lang').value = data.grades["ภาษาต่างประเทศ"] || 0;
    document.getElementById('g_art').value = data.grades["ศิลปะ/ความคิดสร้างสรรค์"] || 0;
    document.getElementById('g_phys').value = data.grades["กีฬา/ร่างกาย"] || 0;
    
    document.getElementById('aiSuggestion').textContent = data.suggestion;
    document.getElementById('aiDescription').textContent = data.description;
    document.getElementById('mockedBadge').style.display = data.isMocked ? 'inline-block' : 'none';

    renderRadarChart([
      data.grades["คณิตศาสตร์"] || 0,
      data.grades["วิทยาศาสตร์"] || 0,
      data.grades["ภาษาต่างประเทศ"] || 0,
      data.grades["ศิลปะ/ความคิดสร้างสรรค์"] || 0,
      data.grades["กีฬา/ร่างกาย"] || 0
    ]);
  } catch(e) {
    console.error(e);
    document.getElementById('aiSuggestion').textContent = 'เกิดข้อผิดพลาด';
    document.getElementById('aiDescription').textContent = e.message;
  }
}

function renderRadarChart(dataArr) {
  const ctx = document.getElementById('aiRadarChart');
  if (!ctx) return;
  if (aiChartInstance) aiChartInstance.destroy();
  aiChartInstance = new Chart(ctx.getContext('2d'), {
    type: 'radar',
    data: {
      labels: ['คณิตศาสตร์', 'วิทยาศาสตร์', 'ภาษาต่างประเทศ', 'ศิลปะ/ความคิดสร้างสรรค์', 'กีฬา/ร่างกาย'],
      datasets: [{
        label: 'คะแนนความถนัด',
        data: dataArr,
        backgroundColor: 'rgba(139, 92, 246, 0.2)',
        borderColor: 'rgba(139, 92, 246, 1)',
        pointBackgroundColor: 'rgba(139, 92, 246, 1)',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgba(139, 92, 246, 1)'
      }]
    },
    options: {
      scales: {
        r: {
          angleLines: { display: true },
          suggestedMin: 0,
          suggestedMax: 100
        }
      }
    }
  });
}

const gradesForm = document.getElementById('gradesForm');
if (gradesForm) {
  gradesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('aiStudentId').value;
    const grades = {
      "คณิตศาสตร์": document.getElementById('g_math').value,
      "วิทยาศาสตร์": document.getElementById('g_sci').value,
      "ภาษาต่างประเทศ": document.getElementById('g_lang').value,
      "ศิลปะ/ความคิดสร้างสรรค์": document.getElementById('g_art').value,
      "กีฬา/ร่างกาย": document.getElementById('g_phys').value
    };
    const token = localStorage.getItem('nutcheck_token');
    try {
      document.getElementById('aiSuggestion').textContent = 'AI NUTNUT กำลังวิเคราะห์คะแนนใหม่...';
      const res = await fetch(`/api/students/${id}/grades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ grades })
      });
      if (!res.ok) throw new Error("บันทึกคะแนนไม่สำเร็จ");
      await loadAiAnalysis(id);
    } catch(err) {
      alert(err.message);
    }
  });
}

init();
