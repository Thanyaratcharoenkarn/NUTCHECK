PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class_name TEXT DEFAULT '',
  nfc_uid TEXT,
  photo_url TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS logs (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  check_in_at TEXT NOT NULL,
  check_in_date TEXT NOT NULL,
  status TEXT NOT NULL,
  method TEXT DEFAULT 'manual',
  FOREIGN KEY (id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_nfc_uid_unique
ON students(nfc_uid)
WHERE nfc_uid IS NOT NULL AND nfc_uid != '';

CREATE INDEX IF NOT EXISTS idx_students_name
ON students(name);

CREATE INDEX IF NOT EXISTS idx_logs_check_in_date
ON logs(check_in_date);

CREATE INDEX IF NOT EXISTS idx_logs_student_date
ON logs(id, check_in_date);
