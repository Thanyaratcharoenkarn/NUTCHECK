async function loadDashboard() {
  const [summaryResponse, studentsResponse, logsResponse] = await Promise.all([
    fetch("/api/dashboard/summary"),
    fetch("/api/dashboard/students"),
    fetch("/api/dashboard/logs")
  ]);

  const summary = await summaryResponse.json();
  const students = await studentsResponse.json();
  const logs = await logsResponse.json();

  document.getElementById("totalStudents").textContent = summary.totalStudents;
  document.getElementById("todayCheckIns").textContent = summary.todayCheckIns;
  document.getElementById("uniqueCheckIns").textContent = summary.uniqueCheckIns;
  document.getElementById("absentCount").textContent = summary.absentCount;
  document.getElementById("dashboardDate").textContent = `อัปเดตข้อมูลวันที่ ${summary.date}`;

  const studentsTable = document.getElementById("studentsTable");
  studentsTable.innerHTML = students
    .map(
      (student) => `
        <tr>
          <td>${student.id}</td>
          <td>${student.name}</td>
          <td><span class="badge ${student.attendanceStatus === "มาเรียน" ? "badge-ok" : "badge-pending"}">${student.attendanceStatus}</span></td>
        </tr>
      `
    )
    .join("");

  const logsTable = document.getElementById("logsTable");
  logsTable.innerHTML = logs.length
    ? logs
        .map(
          (log) => `
            <tr>
              <td>${log.check_in_at}</td>
              <td>${log.id}</td>
              <td>${log.student_name}</td>
              <td>${log.status}</td>
            </tr>
          `
        )
        .join("")
    : `
        <tr>
          <td colspan="4" class="empty-state">ยังไม่มีรายการเช็คชื่อ</td>
        </tr>
      `;
}

document.getElementById("refreshDashboard").addEventListener("click", () => {
  loadDashboard().catch(() => {
    alert("โหลด dashboard ไม่สำเร็จ");
  });
});

loadDashboard().catch(() => {
  alert("โหลด dashboard ไม่สำเร็จ");
});
