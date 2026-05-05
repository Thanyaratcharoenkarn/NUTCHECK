let allStudents = [];
let allLogs = [];
let allUsers = [];

function setStudentSummaryLabels(isStudent) {
  document.getElementById("totalStudentsLabel").textContent = isStudent ? "ข้อมูลของฉัน" : "นักเรียนทั้งหมด";
  document.getElementById("todayCheckInsLabel").textContent = isStudent ? "เช็คชื่อวันนี้ของฉัน" : "เช็คชื่อวันนี้";
  document.getElementById("uniqueCheckInsLabel").textContent = isStudent ? "มาเรียนวันนี้" : "มาเรียนไม่ซ้ำ";
  document.getElementById("absentCountLabel").textContent = isStudent ? "สถานะวันนี้" : "ยังไม่เช็คชื่อ";
}

async function loadStudentInsight(studentId, token) {
  const suggestionEl = document.getElementById("studentAiSuggestion");
  const descriptionEl = document.getElementById("studentAiDescription");
  const badgeEl = document.getElementById("studentAiBadge");

  if (!studentId || !suggestionEl || !descriptionEl || !badgeEl) {
    return;
  }

  suggestionEl.textContent = "กำลังโหลดผลวิเคราะห์...";
  descriptionEl.textContent = "ระบบกำลังสรุปข้อมูลเฉพาะของคุณ";
  badgeEl.style.display = "none";

  try {
    const response = await fetch(`/api/students/${studentId}/analysis`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error("โหลดผลวิเคราะห์ไม่สำเร็จ");
    }

    const data = await response.json();
    suggestionEl.textContent = data.suggestion || "ยังไม่มีคำแนะนำ";
    descriptionEl.textContent = data.description || "ยังไม่มีคำอธิบายเพิ่มเติม";
    badgeEl.style.display = data.isMocked ? "inline-block" : "none";
  } catch (error) {
    suggestionEl.textContent = "ยังโหลดผลวิเคราะห์ไม่ได้";
    descriptionEl.textContent = error.message;
    badgeEl.style.display = "none";
  }
}

function renderStudentFocusCard(student, logs) {
  const panel = document.getElementById("studentFocusPanel");
  if (!panel || !student) {
    return;
  }

  panel.style.display = "grid";
  document.getElementById("studentProfileName").textContent = student.name || "ไม่พบชื่อ";
  document.getElementById("studentProfileId").textContent = student.id || "-";
  document.getElementById("studentProfileClass").textContent = student.class_name || "ยังไม่ระบุ";
  document.getElementById("studentProfileStatus").textContent = student.attendanceStatus || "ยังไม่เช็คชื่อ";
  document.getElementById("studentProfileLatest").textContent = logs.length ? logs[0].check_in_at : "ยังไม่มีประวัติ";
}

async function loadDashboard() {
  const token = localStorage.getItem('nutcheck_token');
  const userStr = localStorage.getItem('nutcheck_user');
  
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  let isAdminOrTeacher = false;
  let isAdmin = false;
  let currentUser = null;
  if (userStr) {
    const user = JSON.parse(userStr);
    currentUser = user;
    const userInfoEl = document.getElementById('userInfo');
    if (userInfoEl) userInfoEl.textContent = `ผู้ใช้งาน: ${user.username} (${user.role})`;
    isAdminOrTeacher = user.role === 'admin' || user.role === 'teacher';
    isAdmin = user.role === 'admin';
    
    const addBtn = document.getElementById('addStudentBtn');
    if (addBtn) addBtn.style.display = isAdminOrTeacher ? 'block' : 'none';
    
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdminOrTeacher ? 'table-cell' : 'none');
    
    const myAnalysisLink = document.getElementById('myAnalysisLink');
    if (myAnalysisLink && !isAdminOrTeacher && user.studentId) {
      myAnalysisLink.style.display = 'inline-block';
    }

    const filterContainer = document.querySelector('.filter-container');
    if (filterContainer) {
      filterContainer.style.display = isAdminOrTeacher ? 'flex' : 'none';
    }

    const exportStudentsBtn = document.getElementById('exportStudentsBtn');
    const exportLogsBtn = document.getElementById('exportLogsBtn');
    if (exportStudentsBtn) exportStudentsBtn.style.display = isAdminOrTeacher ? 'inline-flex' : 'none';
    if (exportLogsBtn) exportLogsBtn.style.display = isAdminOrTeacher ? 'inline-flex' : 'none';
    
    if (isAdmin) {
      document.getElementById('usersPanel').style.display = 'block';
      loadUsers();
    }
  }

  const headers = { 'Authorization': `Bearer ${token}` };

  const [summaryResponse, studentsResponse, logsResponse] = await Promise.all([
    fetch("/api/dashboard/summary", { headers }),
    fetch("/api/dashboard/students", { headers }),
    fetch("/api/dashboard/logs", { headers })
  ]);

  if (summaryResponse.status === 401 || summaryResponse.status === 403) {
    if (summaryResponse.status === 403) {
      try {
        const data = await summaryResponse.json();
        alert(data.message || "บัญชีนี้ยังไม่พร้อมใช้งานหน้า dashboard");
      } catch (error) {
        alert("บัญชีนี้ยังไม่พร้อมใช้งานหน้า dashboard");
      }
    }
    localStorage.removeItem('nutcheck_token');
    window.location.href = '/login.html';
    return;
  }

  const summary = await summaryResponse.json();
  allStudents = await studentsResponse.json();
  allLogs = await logsResponse.json();

  if (!isAdminOrTeacher && userStr) {
    const user = JSON.parse(userStr);
    if (user.studentId) {
      allStudents = allStudents.filter(s => s.id === user.studentId);
      allLogs = allLogs.filter(l => l.id === user.studentId);
    }
  }

  setStudentSummaryLabels(!isAdminOrTeacher);

  document.getElementById("totalStudents").textContent = summary.totalStudents;
  document.getElementById("todayCheckIns").textContent = summary.todayCheckIns;
  document.getElementById("uniqueCheckIns").textContent = summary.uniqueCheckIns;
  document.getElementById("absentCount").textContent = summary.absentCount;
  document.getElementById("dashboardDate").textContent = `อัปเดตข้อมูลวันที่ ${summary.date}`;

  populateClassFilter();
  renderTables(isAdminOrTeacher);

  if (!isAdminOrTeacher && currentUser?.studentId) {
    const myStudent = allStudents.find(student => student.id === currentUser.studentId);
    if (myStudent) {
      renderStudentFocusCard(myStudent, allLogs);
      await loadStudentInsight(currentUser.studentId, token);
    }
  } else {
    const panel = document.getElementById("studentFocusPanel");
    if (panel) panel.style.display = "none";
  }
}

function populateClassFilter() {
  const filter = document.getElementById('classFilter');
  if (!filter) return;
  const currentVal = filter.value;
  const classes = [...new Set(allStudents.map(s => s.class_name).filter(c => c))].sort();
  filter.innerHTML = '<option value="">ทั้งหมด</option>' + classes.map(c => `<option value="${c}">${c}</option>`).join('');
  if (classes.includes(currentVal)) filter.value = currentVal;
}

function renderTables(isAdminOrTeacher) {
  const filterVal = document.getElementById('classFilter').value;
  const user = JSON.parse(localStorage.getItem('nutcheck_user') || '{}');
  const myId = user.studentId;
  
  const filteredStudents = filterVal ? allStudents.filter(s => s.class_name === filterVal) : allStudents;
  const studentsTable = document.getElementById("studentsTable");
  studentsTable.innerHTML = filteredStudents
    .map(
      (student) => `
        <tr>
          <td>${student.id}</td>
          <td>${student.name}</td>
          <td><span class="badge ${student.attendanceStatus === "มาเรียน" ? "badge-ok" : "badge-pending"}">${student.attendanceStatus}</span></td>
          <td style="display:flex; gap:0.25rem;">
            ${(isAdminOrTeacher || (student.id === myId)) ? `
              <button class="primary-button ai-student-btn" data-student='${JSON.stringify(student).replace(/'/g, "&#39;")}' style="padding:0.25rem 0.5rem; font-size:0.75rem; background-color:#8b5cf6;">🧠 AI / เกรด</button>
            ` : '<span class="muted" style="font-size:0.75rem;">-</span>'}
            ${isAdminOrTeacher ? `
            <button class="secondary-button edit-student-btn" data-student='${JSON.stringify(student).replace(/'/g, "&#39;")}' style="padding:0.25rem 0.5rem; font-size:0.75rem;">แก้ไข</button>
            <button class="primary-button delete-student-btn" data-id="${student.id}" style="padding:0.25rem 0.5rem; font-size:0.75rem; background-color:#ef4444;">ลบ</button>
            ` : ''}
          </td>
        </tr>
      `
    ).join("");

  // Attach student listeners
  document.querySelectorAll('.ai-student-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const student = JSON.parse(e.target.dataset.student);
      window.location.href = `/analysis.html?id=${student.id}`;
    });
  });

  if (isAdminOrTeacher) {

    document.querySelectorAll('.edit-student-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const student = JSON.parse(e.target.dataset.student);
        openStudentModal(student);
      });
    });
    
    document.querySelectorAll('.delete-student-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        if (confirm(`คุณต้องการลบนักเรียนรหัส ${id} ใช่หรือไม่?`)) {
          try {
            const token = localStorage.getItem('nutcheck_token');
            const res = await fetch(`/api/students/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) {
              let msg = "ลบข้อมูลไม่สำเร็จ";
              try { msg = (await res.json()).message; } catch(e) {}
              throw new Error(msg);
            }
            loadDashboard();
          } catch (err) {
            alert('ลบไม่สำเร็จ: ' + err.message);
          }
        }
      });
    });
  }

  // Filter logs
  const filteredStudentIds = new Set(filteredStudents.map(s => s.id));
  const filteredLogs = filterVal ? allLogs.filter(l => filteredStudentIds.has(l.id)) : allLogs;
  
  const logsTable = document.getElementById("logsTable");
  logsTable.innerHTML = filteredLogs.length
    ? filteredLogs.map(log => `<tr><td>${log.check_in_at}</td><td>${log.id}</td><td>${log.student_name}</td><td>${log.status}</td></tr>`).join("")
    : `<tr><td colspan="4" class="empty-state">ยังไม่มีรายการเช็คชื่อ</td></tr>`;
}

document.getElementById('classFilter').addEventListener('change', () => {
  const userStr = localStorage.getItem('nutcheck_user');
  let isAdminOrTeacher = false;
  if (userStr) {
    const user = JSON.parse(userStr);
    isAdminOrTeacher = user.role === 'admin' || user.role === 'teacher';
  }
  renderTables(isAdminOrTeacher);
});

// CSV Export
function downloadCSV(csv, filename) {
  const blob = new Blob(["\uFEFF"+csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

document.getElementById('exportStudentsBtn').addEventListener('click', () => {
  const filterVal = document.getElementById('classFilter').value;
  const data = filterVal ? allStudents.filter(s => s.class_name === filterVal) : allStudents;
  let csv = "รหัส,ชื่อ,ชั้นเรียน,สถานะ\n";
  data.forEach(s => {
    csv += `"${s.id}","${s.name}","${s.class_name||''}","${s.attendanceStatus}"\n`;
  });
  downloadCSV(csv, `students_${filterVal||'all'}.csv`);
});

document.getElementById('exportLogsBtn').addEventListener('click', () => {
  const filterVal = document.getElementById('classFilter').value;
  const filteredStudentIds = filterVal ? new Set(allStudents.filter(s => s.class_name === filterVal).map(s => s.id)) : null;
  const data = filterVal ? allLogs.filter(l => filteredStudentIds.has(l.id)) : allLogs;
  let csv = "เวลา,รหัส,ชื่อ,สถานะ,วิธีเช็คชื่อ\n";
  data.forEach(l => {
    csv += `"${l.check_in_at}","${l.id}","${l.student_name}","${l.status}","${l.method}"\n`;
  });
  downloadCSV(csv, `logs_${filterVal||'all'}.csv`);
});

// User Management Logic
async function loadUsers() {
  const token = localStorage.getItem('nutcheck_token');
  try {
    const res = await fetch("/api/users", { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) return;
    allUsers = await res.json();
    const usersTable = document.getElementById("usersTable");
    usersTable.innerHTML = allUsers.map(u => `
      <tr>
        <td>${u.username}</td>
        <td>${u.role}</td>
        <td>${u.student_id || '-'}${u.role === 'teacher' && u.assigned_class ? ` <br><small class="muted">Class: ${u.assigned_class}</small>` : ''}</td>
        <td>
          <button class="secondary-button edit-user-btn" data-user='${JSON.stringify(u).replace(/'/g, "&#39;")}' style="padding:0.25rem 0.5rem; font-size:0.75rem;">แก้ไข</button>
          <button class="primary-button delete-user-btn" data-id="${u.id}" style="padding:0.25rem 0.5rem; font-size:0.75rem; background-color:#ef4444;">ลบ</button>
        </td>
      </tr>
    `).join("");

    document.querySelectorAll('.edit-user-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const user = JSON.parse(e.target.dataset.user);
        openUserModal(user);
      });
    });
    
    document.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        if (confirm(`ลบผู้ใช้ ID ${id} ใช่หรือไม่?`)) {
          const res = await fetch(`/api/users/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
          if (res.ok) loadUsers();
        }
      });
    });
  } catch (err) { console.error(err); }
}

const userModal = document.getElementById('userModal');
const closeUserModalBtn = document.getElementById('closeUserModalBtn');
const addUserBtn = document.getElementById('addUserBtn');
const userForm = document.getElementById('userForm');

function openUserModal(user = null) {
  if (user) {
    document.getElementById('userModalTitle').textContent = 'แก้ไขข้อมูลผู้ใช้';
    document.getElementById('userEditMode').value = 'true';
    document.getElementById('userOriginalId').value = user.id;
    document.getElementById('usrName').value = user.username;
    document.getElementById('usrRole').value = user.role;
    document.getElementById('usrStuId').value = user.student_id || '';
    document.getElementById('usrAssignedClass').value = user.assigned_class || '';
    document.getElementById('pwdHint').textContent = '(ปล่อยว่างถ้าไม่ต้องการเปลี่ยน)';
    document.getElementById('usrPwd').required = false;
  } else {
    document.getElementById('userModalTitle').textContent = 'เพิ่มข้อมูลผู้ใช้';
    document.getElementById('userEditMode').value = 'false';
    document.getElementById('userOriginalId').value = '';
    document.getElementById('usrName').value = '';
    document.getElementById('usrRole').value = 'student';
    document.getElementById('usrStuId').value = '';
    document.getElementById('usrAssignedClass').value = '';
    document.getElementById('pwdHint').textContent = '';
    document.getElementById('usrPwd').required = true;
  }
  userModal.style.display = 'flex';
}

if (addUserBtn) addUserBtn.addEventListener('click', () => openUserModal());
if (closeUserModalBtn) closeUserModalBtn.addEventListener('click', () => userModal.style.display = 'none');
if (userModal) {
  userModal.addEventListener('click', (e) => {
    if (e.target === userModal) userModal.style.display = 'none';
  });
}

if (userForm) {
  userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isEdit = document.getElementById('userEditMode').value === 'true';
    const id = document.getElementById('userOriginalId').value;
    const payload = {
      username: document.getElementById('usrName').value,
      role: document.getElementById('usrRole').value,
      studentId: document.getElementById('usrStuId').value || null,
      assignedClass: document.getElementById('usrAssignedClass').value || null
    };
    const pwd = document.getElementById('usrPwd').value;
    if (pwd) payload.password = pwd;

    const token = localStorage.getItem('nutcheck_token');
    const url = isEdit ? `/api/users/${id}` : '/api/users';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      let errorMsg = "เซิร์ฟเวอร์ตอบกลับผิดพลาด";
      if (!res.ok) {
        try {
          const data = await res.json();
          errorMsg = data.message || errorMsg;
        } catch(e) {
          errorMsg = `Server Error: ${res.status}`;
        }
        throw new Error(errorMsg);
      }
      userModal.style.display = 'none';
      loadUsers();
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
  });
}

// Student Modal
const modal = document.getElementById('studentModal');
const closeBtn = document.getElementById('closeModalBtn');
const addStudentBtn = document.getElementById('addStudentBtn');
const studentForm = document.getElementById('studentForm');

function openStudentModal(student = null) {
  if (student) {
    document.getElementById('modalTitle').textContent = 'แก้ไขข้อมูลนักเรียน';
    document.getElementById('editMode').value = 'true';
    document.getElementById('originalId').value = student.id;
    document.getElementById('stuId').value = student.id;
    document.getElementById('stuId').disabled = true;
    document.getElementById('stuName').value = student.name;
    document.getElementById('stuClass').value = student.class_name || '';
    document.getElementById('stuUid').value = student.nfc_uid || '';
  } else {
    document.getElementById('modalTitle').textContent = 'เพิ่มข้อมูลนักเรียน';
    document.getElementById('editMode').value = 'false';
    document.getElementById('originalId').value = '';
    document.getElementById('stuId').value = '';
    document.getElementById('stuId').disabled = false;
    document.getElementById('stuName').value = '';
    document.getElementById('stuClass').value = '';
    document.getElementById('stuUid').value = '';
  }
  modal.style.display = 'flex';
}

if (addStudentBtn) addStudentBtn.addEventListener('click', () => openStudentModal());
if (closeBtn) closeBtn.addEventListener('click', () => modal.style.display = 'none');
if (modal) {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });
}

if (studentForm) {
  studentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isEdit = document.getElementById('editMode').value === 'true';
    const originalId = document.getElementById('originalId').value;
    const payload = {
      id: document.getElementById('stuId').value,
      name: document.getElementById('stuName').value,
      className: document.getElementById('stuClass').value,
      nfcUid: document.getElementById('stuUid').value
    };

    const token = localStorage.getItem('nutcheck_token');
    const url = isEdit ? `/api/students/${originalId}` : '/api/students';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      let errorMsg = "เซิร์ฟเวอร์ตอบกลับผิดพลาด";
      if (!res.ok) {
        try {
          const data = await res.json();
          errorMsg = data.message || errorMsg;
        } catch(e) {
          errorMsg = `Server Error: ${res.status}`;
        }
        throw new Error(errorMsg);
      }
      modal.style.display = 'none';
      loadDashboard();
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); }
  });
}

document.getElementById("refreshDashboard").addEventListener("click", () => {
  loadDashboard().catch(() => alert("โหลด dashboard ไม่สำเร็จ"));
});

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('nutcheck_token');
    localStorage.removeItem('nutcheck_user');
    window.location.href = '/login.html';
  });
}

loadDashboard().catch(() => alert("โหลด dashboard ไม่สำเร็จ"));
