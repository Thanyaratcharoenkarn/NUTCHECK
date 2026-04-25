const os = require("os");
const path = require("path");
const fs = require("fs");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const TIME_ZONE = "Asia/Bangkok";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";
const dataDir = process.env.DATA_DIR || __dirname;
const db = new sqlite3.Database(path.join(dataDir, "attendance.db"));
const uploadsDir = path.join(dataDir, "uploads");
const adminSessions = new Map();

fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");
});

function getLocalDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatCheckInTime(date = new Date()) {
  return date.toLocaleString("th-TH", {
    timeZone: APP_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function getLanAddress() {
  const networkInterfaces = os.networkInterfaces();

  for (const addresses of Object.values(networkInterfaces)) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return null;
}

function sendDbError(res, message, err) {
  console.error(message, err);
  res.status(500).json({ message });
}

function normalizeStudentPayload(payload = {}) {
  return {
    id: String(payload.id || "").trim(),
    name: String(payload.name || "").trim(),
    className: String(payload.class_name || payload.className || "").trim(),
    nfcUid: String(payload.nfc_uid || payload.nfcUid || "").trim(),
    photoUrl: String(payload.photo_url || payload.photoUrl || "").trim()
  };
}

function validateStudentPayload(student, { requireId = true } = {}) {
  if (requireId && !student.id) {
    return "กรุณาระบุรหัสนักเรียน";
  }

  if (!student.name) {
    return "กรุณาระบุชื่อนักเรียน";
  }

  return null;
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes
      });
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

async function migrateDatabase() {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS logs (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      check_in_at TEXT NOT NULL,
      check_in_date TEXT NOT NULL,
      status TEXT NOT NULL
    )
  `);

  const studentColumns = [
    ["class_name", "TEXT DEFAULT ''"],
    ["nfc_uid", "TEXT UNIQUE"],
    ["photo_url", "TEXT DEFAULT ''"]
  ];

  for (const [columnName, definition] of studentColumns) {
    try {
      await runQuery(`ALTER TABLE students ADD COLUMN ${columnName} ${definition}`);
    } catch (err) {
      if (!String(err.message || "").includes("duplicate column name")) {
        throw err;
      }
    }
  }

  const logColumns = [
    ["method", "TEXT DEFAULT 'manual'"]
  ];

  for (const [columnName, definition] of logColumns) {
    try {
      await runQuery(`ALTER TABLE logs ADD COLUMN ${columnName} ${definition}`);
    } catch (err) {
      if (!String(err.message || "").includes("duplicate column name")) {
        throw err;
      }
    }
  }

  await runQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_students_nfc_uid_unique
    ON students(nfc_uid)
    WHERE nfc_uid IS NOT NULL AND nfc_uid != ''
  `);

  await runQuery(`
    CREATE INDEX IF NOT EXISTS idx_students_name
    ON students(name)
  `);

  await runQuery(`
    CREATE INDEX IF NOT EXISTS idx_logs_check_in_date
    ON logs(check_in_date)
  `);

  await runQuery(`
    CREATE INDEX IF NOT EXISTS idx_logs_student_date
    ON logs(id, check_in_date)
  `);

  const studentCountRow = await getQuery("SELECT COUNT(*) AS count FROM students");
  if ((studentCountRow?.count || 0) === 0) {
    const sampleStudents = [
      ["65001", "Min", "", "", ""],
      ["65002", "Nina", "", "", ""],
      ["65003", "Boss", "", "", ""],
      ["65004", "Ploy", "", "", ""]
    ];

    for (const student of sampleStudents) {
      await runQuery(
        `
          INSERT INTO students (id, name, class_name, nfc_uid, photo_url)
          VALUES (?, ?, ?, ?, ?)
        `,
        student
      );
    }
  }
}

async function getStudentById(id) {
  return getQuery(
    `
      SELECT id, name, class_name, nfc_uid, photo_url
      FROM students
      WHERE id = ?
    `,
    [id]
  );
}

async function saveAttendance(student, method = "manual") {
  const now = new Date();
  const checkInAt = formatCheckInTime(now);
  const checkInDate = getLocalDateKey(now);

  const existingLog = await getQuery(
    `
      SELECT log_id, check_in_at
      FROM logs
      WHERE id = ? AND check_in_date = ?
      ORDER BY log_id DESC
      LIMIT 1
    `,
    [student.id, checkInDate]
  );

  if (existingLog) {
    return {
      alreadyCheckedIn: true,
      message: `🟤 ${student.name} เช็คชื่อแล้ววันนี้ (${existingLog.check_in_at})`,
      student
    };
  }

  await runQuery(
    `
      INSERT INTO logs (
        id,
        student_name,
        check_in_at,
        check_in_date,
        status,
        method
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [student.id, student.name, checkInAt, checkInDate, "เข้าเรียน", method]
  );

  return {
    alreadyCheckedIn: false,
    message: `✅ ${student.name} มาแล้ว (${checkInAt})`,
    student
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    host: HOST,
    port: PORT,
    dbPath: DB_PATH
  });
});

app.get("/api/database/status", async (req, res) => {
  try {
    const [studentCount, logCount, latestLog] = await Promise.all([
      getQuery("SELECT COUNT(*) AS total FROM students"),
      getQuery("SELECT COUNT(*) AS total FROM logs"),
      getQuery(
        `
          SELECT log_id, id, student_name, check_in_at, check_in_date, status, method
          FROM logs
          ORDER BY log_id DESC
          LIMIT 1
        `
      )
    ]);

    res.json({
      ok: true,
      database: {
        path: DB_PATH,
        type: "sqlite"
      },
      totals: {
        students: studentCount?.total || 0,
        logs: logCount?.total || 0
      },
      latestLog: latestLog || null
    });
  } catch (err) {
    sendDbError(res, "โหลดสถานะฐานข้อมูลไม่สำเร็จ", err);
  }
});

app.get("/api/students", async (req, res) => {
  try {
    const rows = await allQuery(
      `
        SELECT id, name, class_name, nfc_uid, photo_url
        FROM students
        ORDER BY id ASC
      `
    );

    res.json(rows);
  } catch (err) {
    sendDbError(res, "โหลดรายชื่อนักเรียนไม่สำเร็จ", err);
  }
});

app.get("/api/students/:id", async (req, res) => {
  try {
    const student = await getStudentById(req.params.id);

    if (!student) {
      res.status(404).json({ message: "ไม่พบข้อมูลนักเรียน" });
      return;
    }

    res.json(student);
  } catch (err) {
    sendDbError(res, "โหลดข้อมูลนักเรียนไม่สำเร็จ", err);
  }
});

app.post("/api/students", async (req, res) => {
  const student = normalizeStudentPayload(req.body);
  const validationMessage = validateStudentPayload(student);

  if (validationMessage) {
    res.status(400).json({ message: validationMessage });
    return;
  }

  try {
    await runQuery(
      `
        INSERT INTO students (id, name, class_name, nfc_uid, photo_url)
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        student.id,
        student.name,
        student.className,
        student.nfcUid || null,
        student.photoUrl
      ]
    );

    res.status(201).json({
      message: "เพิ่มนักเรียนสำเร็จ",
      student: await getStudentById(student.id)
    });
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) {
      res.status(409).json({ message: "รหัสนักเรียนหรือ UID ซ้ำในระบบ" });
      return;
    }

    sendDbError(res, "เพิ่มนักเรียนไม่สำเร็จ", err);
  }
});

app.put("/api/students/:id", async (req, res) => {
  const student = normalizeStudentPayload(req.body);
  const validationMessage = validateStudentPayload(student, { requireId: false });

  if (validationMessage) {
    res.status(400).json({ message: validationMessage });
    return;
  }

  try {
    const result = await runQuery(
      `
        UPDATE students
        SET name = ?, class_name = ?, nfc_uid = ?, photo_url = ?
        WHERE id = ?
      `,
      [
        student.name,
        student.className,
        student.nfcUid || null,
        student.photoUrl,
        req.params.id
      ]
    );

    if (result.changes === 0) {
      res.status(404).json({ message: "ไม่พบข้อมูลนักเรียน" });
      return;
    }

    res.json({
      message: "อัปเดตข้อมูลนักเรียนสำเร็จ",
      student: await getStudentById(req.params.id)
    });
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) {
      res.status(409).json({ message: "UID ซ้ำในระบบ" });
      return;
    }

    sendDbError(res, "อัปเดตข้อมูลนักเรียนไม่สำเร็จ", err);
  }
});

app.delete("/api/students/:id", async (req, res) => {
  try {
    const result = await runQuery("DELETE FROM students WHERE id = ?", [req.params.id]);

    if (result.changes === 0) {
      res.status(404).json({ message: "ไม่พบข้อมูลนักเรียน" });
      return;
    }

    res.json({ message: "ลบนักเรียนสำเร็จ" });
  } catch (err) {
    sendDbError(res, "ลบนักเรียนไม่สำเร็จ", err);
  }
});

app.post("/api/check", async (req, res) => {
  const id = String(req.body?.id || "").trim();

  if (!id) {
    res.status(400).json({ message: "กรุณาระบุรหัสนักเรียน" });
    return;
  }

  try {
    const student = await getStudentById(id);

    if (!student) {
      res.status(404).json({ message: "❌ ไม่พบข้อมูลนักเรียน" });
      return;
    }

    res.json(await saveAttendance(student, "manual"));
  } catch (err) {
    sendDbError(res, "บันทึกเวลาเช็คชื่อไม่สำเร็จ", err);
  }
});

app.post("/api/check/nfc", async (req, res) => {
  const uid = String(req.body?.uid || "").trim();

  if (!uid) {
    res.status(400).json({ message: "กรุณาระบุ UID ของบัตร" });
    return;
  }

  try {
    const student = await getQuery(
      `
        SELECT id, name, class_name, nfc_uid, photo_url
        FROM students
        WHERE nfc_uid = ?
      `,
      [uid]
    );

    if (!student) {
      res.status(404).json({ message: "ไม่พบบัตรนี้ในระบบ" });
      return;
    }

    res.json(await saveAttendance(student, "nfc"));
  } catch (err) {
    sendDbError(res, "เช็คชื่อด้วยบัตรไม่สำเร็จ", err);
  }
});

app.get("/api/logs", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
  const date = String(req.query.date || "").trim();

  try {
    const rows = await allQuery(
      `
        SELECT log_id, id, student_name, check_in_at, check_in_date, status, method
        FROM logs
        ${date ? "WHERE check_in_date = ?" : ""}
        ORDER BY log_id DESC
        LIMIT ?
      `,
      date ? [date, limit] : [limit]
    );

    res.json(rows);
  } catch (err) {
    sendDbError(res, "โหลดประวัติการเช็คชื่อไม่สำเร็จ", err);
  }
});

app.get("/api/dashboard/summary", async (req, res) => {
  const today = String(req.query.date || getLocalDateKey()).trim();

  try {
    const studentRow = await getQuery("SELECT COUNT(*) AS totalStudents FROM students");
    const logRow = await getQuery(
      `
        SELECT COUNT(*) AS todayCheckIns,
               COUNT(DISTINCT id) AS uniqueCheckIns
        FROM logs
        WHERE check_in_date = ?
      `,
      [today]
    );

    res.json({
      date: today,
      totalStudents: studentRow.totalStudents,
      todayCheckIns: logRow.todayCheckIns,
      uniqueCheckIns: logRow.uniqueCheckIns,
      absentCount: studentRow.totalStudents - logRow.uniqueCheckIns
    });
  } catch (err) {
    sendDbError(res, "โหลดสรุปข้อมูลไม่สำเร็จ", err);
  }
});

app.get("/api/dashboard/logs", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
  const date = String(req.query.date || "").trim();

  try {
    const rows = await allQuery(
      `
        SELECT log_id, id, student_name, check_in_at, check_in_date, status, method
        FROM logs
        ${date ? "WHERE check_in_date = ?" : ""}
        ORDER BY log_id DESC
        LIMIT ?
      `,
      date ? [date, limit] : [limit]
    );

    res.json(rows);
  } catch (err) {
    sendDbError(res, "โหลดรายการเช็คชื่อไม่สำเร็จ", err);
  }
});

app.get("/api/dashboard/students", async (req, res) => {
  const date = String(req.query.date || getLocalDateKey()).trim();

  try {
    const rows = await allQuery(
      `
        SELECT
          s.id,
          s.name,
          s.class_name,
          s.nfc_uid,
          s.photo_url,
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM logs l
              WHERE l.id = s.id AND l.check_in_date = ?
            ) THEN 'มาเรียน'
            ELSE 'ยังไม่เช็คชื่อ'
          END AS attendanceStatus
        FROM students s
        ORDER BY s.id ASC
      `,
      [date]
    );

    res.json(rows);
  } catch (err) {
    sendDbError(res, "โหลดสถานะนักเรียนไม่สำเร็จ", err);
  }
});

app.get("/api/history", async (req, res) => {
  const date = String(req.query.date || getLocalDateKey()).trim();

  try {
    const [summary, logs] = await Promise.all([
      getQuery(
        `
          SELECT COUNT(*) AS totalCheckIns,
                 COUNT(DISTINCT id) AS uniqueCheckIns
          FROM logs
          WHERE check_in_date = ?
        `,
        [date]
      ),
      allQuery(
        `
          SELECT log_id, id, student_name, check_in_at, check_in_date, status, method
          FROM logs
          WHERE check_in_date = ?
          ORDER BY log_id DESC
        `,
        [date]
      )
    ]);

    res.json({
      date,
      summary,
      logs
    });
  } catch (err) {
    sendDbError(res, "โหลดประวัติย้อนหลังไม่สำเร็จ", err);
  }
});

migrateDatabase()
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`NutCheck server running at http://127.0.0.1:${PORT}`);

      const lanAddress = getLanAddress();
      if (lanAddress) {
        console.log(`Share on your Wi-Fi: http://${lanAddress}:${PORT}`);
      }
    });
  })
  .catch((err) => {
    console.error("Database migration failed", err);
    process.exit(1);
  });
