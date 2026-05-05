const os = require("os");
const path = require("path");
const fs = require("fs");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const TIME_ZONE = "Asia/Bangkok";
const JWT_SECRET = process.env.JWT_SECRET || "nutcheck_super_secret_key_12345";
const dataDir = process.env.DATA_DIR || __dirname;
const uploadsDir = path.join(dataDir, "uploads");
const DB_PATH = path.join(dataDir, "attendance.db");
const adminSessions = new Map();

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });
const db = new sqlite3.Database(DB_PATH);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");
});

function getLocalDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatCheckInTime(date = new Date()) {
  return date.toLocaleString("th-TH", {
    timeZone: TIME_ZONE,
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

  await runQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      student_id TEXT,
      FOREIGN KEY (student_id) REFERENCES students(id)
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      score INTEGER NOT NULL,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE(student_id, subject)
    )
  `);

  const userCountRow = await getQuery("SELECT COUNT(*) AS count FROM users");
  if ((userCountRow?.count || 0) === 0) {
    const adminPasswordHash = await bcrypt.hash("1234", 10);
    await runQuery(
      `INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
      ["admin", adminPasswordHash, "admin"]
    );
  }

  const studentColumns = [
    ["class_name", "TEXT DEFAULT ''"],
    ["nfc_uid", "TEXT"],
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

  const userColumns = [
    ["assigned_class", "TEXT"]
  ];

  for (const [columnName, definition] of userColumns) {
    try {
      await runQuery(`ALTER TABLE users ADD COLUMN ${columnName} ${definition}`);
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

// Auth Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อนใช้งาน" });

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) return res.status(403).json({ message: "Token ไม่ถูกต้องหรือหมดอายุ" });

    try {
      if (user?.role === "student" && !user.studentId) {
        const linkedUser = await getQuery(
          `SELECT student_id FROM users WHERE id = ? OR username = ? LIMIT 1`,
          [user.id, user.username]
        );
        user.studentId = linkedUser?.student_id || null;
      }

      req.user = user;
      next();
    } catch (lookupError) {
      sendDbError(res, "ตรวจสอบสิทธิ์ผู้ใช้งานไม่สำเร็จ", lookupError);
    }
  });
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "คุณไม่มีสิทธิ์เข้าถึงส่วนนี้" });
    }
    next();
  };
}

function requireStudentSelfOrRole(roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อนใช้งาน" });
    }

    if (roles.includes(req.user.role)) {
      return next();
    }

    if (req.user.role === "student" && req.user.studentId === req.params.id) {
      return next();
    }

    return res.status(403).json({ message: "คุณไม่มีสิทธิ์เข้าถึงข้อมูลของนักเรียนคนนี้" });
  };
}

function ensureLinkedStudent(req, res) {
  if (req.user?.role === "student" && !req.user.studentId) {
    res.status(403).json({ message: "บัญชีนักเรียนนี้ยังไม่ถูกผูกกับรหัสนักเรียน" });
    return false;
  }

  return true;
}

// Auth Endpoints
app.post("/api/auth/register", async (req, res) => {
  const { username, password, role, studentId, assignedClass } = req.body;
  if (!username || !password || !role) return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
  if (!["admin", "teacher", "student"].includes(role)) return res.status(400).json({ message: "Role ไม่ถูกต้อง" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await runQuery(
      `INSERT INTO users (username, password, role, student_id, assigned_class) VALUES (?, ?, ?, ?, ?)`,
      [username, hashedPassword, role, studentId || null, assignedClass || null]
    );
    res.status(201).json({ message: "สมัครสมาชิกสำเร็จ" });
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) return res.status(409).json({ message: "ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว" });
    sendDbError(res, "สมัครสมาชิกไม่สำเร็จ", err);
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: "กรุณากรอก Username และ Password" });

  try {
    const user = await getQuery(`SELECT * FROM users WHERE username = ?`, [username]);
    if (!user) return res.status(401).json({ message: "Username หรือ Password ไม่ถูกต้อง" });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ message: "Username หรือ Password ไม่ถูกต้อง" });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, studentId: user.student_id, assignedClass: user.assigned_class },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({
      message: "เข้าสู่ระบบสำเร็จ",
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        studentId: user.student_id,
        assignedClass: user.assigned_class
      }
    });
  } catch (err) {
    sendDbError(res, "ล็อกอินไม่สำเร็จ", err);
  }
});

app.get("/api/auth/me", authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// User Management Endpoints (Admin only)
app.get("/api/users", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const rows = await allQuery(`SELECT id, username, role, student_id, assigned_class FROM users`);
    res.json(rows);
  } catch (err) {
    sendDbError(res, "โหลดผู้ใช้งานไม่สำเร็จ", err);
  }
});

app.post("/api/users", authenticateToken, requireRole(["admin"]), async (req, res) => {
  const { username, password, role, studentId, assignedClass } = req.body;
  if (!username || !password || !role) return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await runQuery(
      `INSERT INTO users (username, password, role, student_id, assigned_class) VALUES (?, ?, ?, ?, ?)`,
      [username, hashedPassword, role, studentId || null, assignedClass || null]
    );
    res.status(201).json({ message: "สร้างผู้ใช้สำเร็จ" });
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) return res.status(409).json({ message: "ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว" });
    if (String(err.message || "").includes("FOREIGN KEY")) return res.status(400).json({ message: "ไม่พบรหัสนักเรียนนี้ในระบบ" });
    sendDbError(res, "สร้างผู้ใช้ไม่สำเร็จ", err);
  }
});

app.put("/api/users/:id", authenticateToken, requireRole(["admin"]), async (req, res) => {
  const { username, password, role, studentId, assignedClass } = req.body;
  try {
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await runQuery(`UPDATE users SET username=?, password=?, role=?, student_id=?, assigned_class=? WHERE id=?`, [username, hashedPassword, role, studentId || null, assignedClass || null, req.params.id]);
    } else {
      await runQuery(`UPDATE users SET username=?, role=?, student_id=?, assigned_class=? WHERE id=?`, [username, role, studentId || null, assignedClass || null, req.params.id]);
    }
    res.json({ message: "อัปเดตผู้ใช้สำเร็จ" });
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE")) return res.status(409).json({ message: "ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว" });
    if (String(err.message || "").includes("FOREIGN KEY")) return res.status(400).json({ message: "ไม่พบรหัสนักเรียนนี้ในระบบ" });
    sendDbError(res, "อัปเดตผู้ใช้ไม่สำเร็จ", err);
  }
});

app.delete("/api/users/:id", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    await runQuery(`DELETE FROM users WHERE id=?`, [req.params.id]);
    res.json({ message: "ลบผู้ใช้สำเร็จ" });
  } catch (err) {
    sendDbError(res, "ลบผู้ใช้ไม่สำเร็จ", err);
  }
});

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

app.get("/api/students", authenticateToken, async (req, res) => {
  if (!ensureLinkedStudent(req, res)) {
    return;
  }

  try {
    let query = `
        SELECT id, name, class_name, nfc_uid, photo_url
        FROM students
        WHERE 1 = 1
      `;
    const params = [];

    if (req.user.role === "student" && req.user.studentId) {
      query += " AND id = ?";
      params.push(req.user.studentId);
    } else if (req.user.role === "teacher" && req.user.assignedClass) {
      query += " AND class_name = ?";
      params.push(req.user.assignedClass);
    }

    query += " ORDER BY id ASC";

    const rows = await allQuery(query, params);

    res.json(rows);
  } catch (err) {
    sendDbError(res, "โหลดรายชื่อนักเรียนไม่สำเร็จ", err);
  }
});

app.get("/api/students/:id", authenticateToken, requireStudentSelfOrRole(["admin", "teacher"]), async (req, res) => {
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

app.post("/api/students", authenticateToken, requireRole(["admin", "teacher"]), async (req, res) => {
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

app.put("/api/students/:id", authenticateToken, requireRole(["admin", "teacher"]), async (req, res) => {
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

app.delete("/api/students/:id", authenticateToken, requireRole(["admin", "teacher"]), async (req, res) => {
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

// Grades and AI Analysis Endpoints
app.get("/api/students/:id/grades", authenticateToken, requireStudentSelfOrRole(["admin", "teacher"]), async (req, res) => {
  try {
    const rows = await allQuery(`SELECT subject, score FROM grades WHERE student_id = ?`, [req.params.id]);
    res.json(rows);
  } catch (err) {
    sendDbError(res, "โหลดเกรดไม่สำเร็จ", err);
  }
});

app.post("/api/students/:id/grades", authenticateToken, requireStudentSelfOrRole(["admin", "teacher"]), async (req, res) => {
  const { grades } = req.body;
  const studentId = req.params.id;

  if (!grades || typeof grades !== "object") {
    res.status(400).json({ message: "กรุณากรอกคะแนนให้ครบถ้วน" });
    return;
  }

  try {
    await runQuery(`DELETE FROM grades WHERE student_id = ?`, [studentId]);
    for (const [subject, score] of Object.entries(grades)) {
      const numericScore = Number(score);

      if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
        res.status(400).json({ message: `คะแนนวิชา ${subject} ต้องอยู่ระหว่าง 0 ถึง 100` });
        return;
      }

      await runQuery(
        `INSERT INTO grades (student_id, subject, score) VALUES (?, ?, ?)`,
        [studentId, subject, numericScore]
      );
    }
    res.json({ message: "บันทึกคะแนนสำเร็จ" });
  } catch (err) {
    sendDbError(res, "บันทึกคะแนนไม่สำเร็จ", err);
  }
});

app.get("/api/students/:id/analysis", authenticateToken, requireStudentSelfOrRole(["admin", "teacher"]), async (req, res) => {
  try {
    const student = await getStudentById(req.params.id);
    if (!student) return res.status(404).json({ message: "ไม่พบข้อมูลนักเรียน" });

    const rows = await allQuery(`SELECT subject, score FROM grades WHERE student_id = ?`, [req.params.id]);
    let grades = {};
    rows.forEach(r => grades[r.subject] = r.score);

    const subjects = ["คณิตศาสตร์", "วิทยาศาสตร์", "ภาษาต่างประเทศ", "ศิลปะ/ความคิดสร้างสรรค์", "กีฬา/ร่างกาย"];
    let isMocked = false;
    if (Object.keys(grades).length === 0) {
      subjects.forEach(s => {
        grades[s] = Math.floor(Math.random() * 41) + 60; // 60-100 random
      });
      isMocked = true;
    } else {
      subjects.forEach(s => {
        if (grades[s] === undefined) grades[s] = 0;
      });
    }

    const m = grades["คณิตศาสตร์"];
    const s = grades["วิทยาศาสตร์"];
    const l = grades["ภาษาต่างประเทศ"];
    const a = grades["ศิลปะ/ความคิดสร้างสรรค์"];
    const p = grades["กีฬา/ร่างกาย"];

    const prompt = `You are an expert career counselor. Analyze these student grades out of 100: Math: ${m}, Science: ${s}, Foreign Language: ${l}, Arts: ${a}, Physical Education: ${p}. 
Suggest 2-3 suitable careers for this student and give a brief 1-2 sentence explanation of why. 
Format your response exactly like this in Thai:
Career: [Career 1, Career 2, Career 3]
Explanation: [Explanation in Thai]`;

    let suggestion = "กำลังคิด...";
    let description = "ไม่สามารถเชื่อมต่อ AI NUTNUT ได้";

    try {
      const ollamaRes = await fetch("http://127.0.0.1:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3",
          prompt: prompt,
          stream: false
        })
      });
      
      if (ollamaRes.ok) {
        const ollamaData = await ollamaRes.json();
        const text = ollamaData.response;
        const careerMatch = text.match(/Career:\s*(.+)/i);
        const explanationMatch = text.match(/Explanation:\s*([\s\S]+)/i);
        
        suggestion = careerMatch ? careerMatch[1].trim() : "หลากหลายอาชีพตามความถนัด";
        description = explanationMatch ? explanationMatch[1].trim() : text.trim();
      } else {
        description = "AI NUTNUT ตอบกลับข้อผิดพลาด โปรดตรวจสอบว่าระบบวิเคราะห์พร้อมใช้งาน";
      }
    } catch (e) {
      description = "ไม่สามารถเชื่อมต่อ AI NUTNUT ได้ กรุณาตรวจสอบว่าเซิร์ฟเวอร์วิเคราะห์ทำงานอยู่";
    }

    res.json({ grades, suggestion, description, isMocked });
  } catch (err) {
    sendDbError(res, "วิเคราะห์ผลไม่สำเร็จ", err);
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

app.get("/api/logs", authenticateToken, async (req, res) => {
  if (!ensureLinkedStudent(req, res)) {
    return;
  }

  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
  const date = String(req.query.date || "").trim();
  const isStudent = req.user.role === "student";
  const studentId = req.user.studentId;
  const isTeacher = req.user.role === "teacher" && req.user.assignedClass;

  let query = "SELECT l.log_id, l.id, l.student_name, l.check_in_at, l.check_in_date, l.status, l.method FROM logs l";
  let params = [];

  if (isTeacher) {
    query += " JOIN students s ON l.id = s.id WHERE s.class_name = ?";
    params.push(req.user.assignedClass);
  } else {
    query += " WHERE 1 = 1";
  }

  if (date) {
    query += " AND l.check_in_date = ?";
    params.push(date);
  }

  if (isStudent && studentId) {
    query += " AND l.id = ?";
    params.push(studentId);
  }

  query += " ORDER BY l.log_id DESC LIMIT ?";
  params.push(limit);

  try {
    const rows = await allQuery(query, params);

    res.json(rows);
  } catch (err) {
    sendDbError(res, "โหลดประวัติการเช็คชื่อไม่สำเร็จ", err);
  }
});

app.get("/api/dashboard/summary", authenticateToken, async (req, res) => {
  if (!ensureLinkedStudent(req, res)) {
    return;
  }

  const today = String(req.query.date || getLocalDateKey()).trim();
  const isTeacher = req.user.role === "teacher" && req.user.assignedClass;

  try {
    if (req.user.role === "student" && req.user.studentId) {
      const logRow = await getQuery(
        `
          SELECT COUNT(*) AS todayCheckIns,
                 COUNT(DISTINCT id) AS uniqueCheckIns
          FROM logs
          WHERE check_in_date = ? AND id = ?
        `,
        [today, req.user.studentId]
      );

      const hasCheckedIn = (logRow?.uniqueCheckIns || 0) > 0;
      res.json({
        date: today,
        totalStudents: 1,
        todayCheckIns: logRow?.todayCheckIns || 0,
        uniqueCheckIns: logRow?.uniqueCheckIns || 0,
        absentCount: hasCheckedIn ? 0 : 1
      });
      return;
    }

    let studentQuery = "SELECT COUNT(*) AS totalStudents FROM students";
    let studentParams = [];
    let logQuery = `
        SELECT COUNT(*) AS todayCheckIns,
               COUNT(DISTINCT l.id) AS uniqueCheckIns
        FROM logs l
      `;
    let logParams = [today];

    if (isTeacher) {
      studentQuery += " WHERE class_name = ?";
      studentParams.push(req.user.assignedClass);
      
      logQuery += " JOIN students s ON l.id = s.id WHERE l.check_in_date = ? AND s.class_name = ?";
      logParams.push(req.user.assignedClass);
    } else {
      logQuery += " WHERE l.check_in_date = ?";
    }

    const studentRow = await getQuery(studentQuery, studentParams);
    const logRow = await getQuery(logQuery, logParams);

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

app.get("/api/dashboard/logs", authenticateToken, async (req, res) => {
  if (!ensureLinkedStudent(req, res)) {
    return;
  }

  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
  const date = String(req.query.date || "").trim();
  const isStudent = req.user.role === "student";
  const studentId = req.user.studentId;
  const isTeacher = req.user.role === "teacher" && req.user.assignedClass;

  let query = "SELECT l.log_id, l.id, l.student_name, l.check_in_at, l.check_in_date, l.status, l.method FROM logs l";
  let params = [];

  if (isTeacher) {
    query += " JOIN students s ON l.id = s.id WHERE s.class_name = ?";
    params.push(req.user.assignedClass);
  } else {
    query += " WHERE 1 = 1";
  }

  if (date) {
    query += " AND l.check_in_date = ?";
    params.push(date);
  }

  if (isStudent && studentId) {
    query += " AND l.id = ?";
    params.push(studentId);
  }

  query += " ORDER BY l.log_id DESC LIMIT ?";
  params.push(limit);

  try {
    const rows = await allQuery(query, params);
    res.json(rows);
  } catch (err) {
    sendDbError(res, "โหลดรายการเช็คชื่อไม่สำเร็จ", err);
  }
});

app.get("/api/dashboard/students", authenticateToken, async (req, res) => {
  if (!ensureLinkedStudent(req, res)) {
    return;
  }

  const date = String(req.query.date || getLocalDateKey()).trim();
  const isStudent = req.user.role === "student";
  const studentId = req.user.studentId;
  const isTeacher = req.user.role === "teacher" && req.user.assignedClass;

  let query = `
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
        WHERE 1 = 1
      `;
  const params = [date];

  if (isStudent && studentId) {
    query += " AND s.id = ?";
    params.push(studentId);
  } else if (isTeacher) {
    query += " AND s.class_name = ?";
    params.push(req.user.assignedClass);
  }

  query += " ORDER BY s.id ASC";

  try {
    const rows = await allQuery(query, params);

    res.json(rows);
  } catch (err) {
    sendDbError(res, "โหลดสถานะนักเรียนไม่สำเร็จ", err);
  }
});

app.get("/api/history", authenticateToken, requireRole(["admin", "teacher"]), async (req, res) => {
  const date = String(req.query.date || getLocalDateKey()).trim();
  const isTeacher = req.user.role === "teacher" && req.user.assignedClass;

  try {
    let summaryQuery = `
          SELECT COUNT(*) AS totalCheckIns,
                 COUNT(DISTINCT l.id) AS uniqueCheckIns
          FROM logs l
        `;
    let logsQuery = `
          SELECT l.log_id, l.id, l.student_name, l.check_in_at, l.check_in_date, l.status, l.method
          FROM logs l
        `;
    let params = [date];

    if (isTeacher) {
      const classJoin = " JOIN students s ON l.id = s.id WHERE l.check_in_date = ? AND s.class_name = ?";
      summaryQuery += classJoin;
      logsQuery += classJoin + " ORDER BY l.log_id DESC";
      params.push(req.user.assignedClass);
    } else {
      summaryQuery += " WHERE l.check_in_date = ?";
      logsQuery += " WHERE l.check_in_date = ? ORDER BY l.log_id DESC";
    }

    const [summary, logs] = await Promise.all([
      getQuery(summaryQuery, params),
      allQuery(logsQuery, params)
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
