// src/config/database.js
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_FILE = "repositories.db";
let db = null;

// Función para obtener la instancia actual (usada por otros servicios)
function getDb() {
  if (!db) {
    throw new Error("Base de datos no inicializada.");
  }
  return db;
}

// Cierra la conexión actual si existe
function closeDb() {
  if (db) {
    console.log("Cerrando conexión a base de datos...");
    db.close();
    db = null;
  }
}

// Inicializa (o reinicializa) la base de datos
function initDb() {
  if (db) return;
  console.log(`Abriendo base de datos: ${DB_FILE}`);
  db = new Database(DB_FILE, {});
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  setupSchema();
}

function setupSchema() {
  const schema = `
    CREATE TABLE IF NOT EXISTS tbl_sha (
      sha_id      INTEGER PRIMARY KEY AUTOINCREMENT,
      sha_text    TEXT NOT NULL,
      commit_date TEXT,
        commit_message TEXT,
      author_name TEXT,
      UNIQUE(sha_text)
    );

    CREATE TABLE IF NOT EXISTS tbl_churn (
      churn_id    INTEGER PRIMARY KEY AUTOINCREMENT,
      sha_id      INTEGER NOT NULL,
      file_path   TEXT NOT NULL,
      added       INTEGER DEFAULT 0,
      deleted     INTEGER DEFAULT 0,
      total       INTEGER DEFAULT 0,
      frequency   INTEGER DEFAULT 0,
      authors     INTEGER DEFAULT 0,
      FOREIGN KEY(sha_id) REFERENCES tbl_sha(sha_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_cohesion (
      cohesion_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      sha_id        INTEGER NOT NULL,
      file_path     TEXT NOT NULL,
      loc           INTEGER DEFAULT 0,
      func_count    INTEGER DEFAULT 0,
      method_count  INTEGER DEFAULT 0,
      FOREIGN KEY(sha_id) REFERENCES tbl_sha(sha_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_complexity (
      complexity_id INTEGER PRIMARY KEY AUTOINCREMENT,
      sha_id        INTEGER NOT NULL,
      file_path     TEXT NOT NULL,
      value         INTEGER DEFAULT 0,
      FOREIGN KEY(sha_id) REFERENCES tbl_sha(sha_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_coupling (
      coupling_id     INTEGER PRIMARY KEY AUTOINCREMENT,
      sha_id          INTEGER NOT NULL,
      file_path       TEXT NOT NULL,
      num_dependency  INTEGER DEFAULT 0,
      num_imports     INTEGER DEFAULT 0,
      FOREIGN KEY(sha_id) REFERENCES tbl_sha(sha_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_coverage_summary (
      coverage_id INTEGER PRIMARY KEY AUTOINCREMENT,
      sha_id      INTEGER NOT NULL,
      file_path   TEXT NOT NULL,
      percentage  REAL DEFAULT 0,
      sonar_url   TEXT, 
      FOREIGN KEY(sha_id) REFERENCES tbl_sha(sha_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_lint_summary (
      lint_id     INTEGER PRIMARY KEY AUTOINCREMENT,
      sha_id      INTEGER NOT NULL,
      file_path   TEXT NOT NULL,
      num_issues  INTEGER DEFAULT 0,
      issues_url  TEXT,
      FOREIGN KEY(sha_id) REFERENCES tbl_sha(sha_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_file_criticality (
      file_crit_id        INTEGER PRIMARY KEY AUTOINCREMENT,
      sha_id              INTEGER NOT NULL,
      file_path           TEXT NOT NULL,
      severity_complexity TEXT DEFAULT 'LOW',
      severity_coupling   TEXT DEFAULT 'LOW',
      severity_issues     TEXT DEFAULT 'LOW',
      severity_churn      TEXT DEFAULT 'LOW',
      severity_authors    TEXT DEFAULT 'LOW',
      severity_halstead   TEXT DEFAULT 'LOW',
      overall_severity    TEXT DEFAULT 'LOW', 
      FOREIGN KEY(sha_id) REFERENCES tbl_sha(sha_id) ON DELETE CASCADE,
      UNIQUE(sha_id, file_path)
    );

    CREATE TABLE IF NOT EXISTS tbl_halstead (
      halstead_id         INTEGER PRIMARY KEY AUTOINCREMENT,
      sha_id              INTEGER NOT NULL,
      file_path           TEXT NOT NULL,
      -- distinct_operators  INTEGER,
      -- distinct_operands   INTEGER,
      -- total_operators     INTEGER,
      -- total_operands      INTEGER,
      -- calculated_length   REAL,
      volume              REAL,
      difficulty          REAL,
      effort              REAL,
      -- time                REAL,
      bugs                REAL,
      FOREIGN KEY(sha_id) REFERENCES tbl_sha(sha_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tbl_folder_metrics (
      folder_metric_id  INTEGER PRIMARY KEY AUTOINCREMENT,
      sha_id            INTEGER NOT NULL, --check
      folder_path       TEXT NOT NULL, --check
      total_issues      INTEGER DEFAULT 0, --check
      total_complexity  INTEGER DEFAULT 0, --check
      total_churn       INTEGER DEFAULT 0, --check
      total_coupling_deps INTEGER DEFAULT 0, --check
      total_loc         INTEGER DEFAULT 0, --check
      total_func_count  INTEGER DEFAULT 0, --check
      total_method_count INTEGER DEFAULT 0, --check
      avg_coverage      REAL DEFAULT 0, --check
      total_frequency   INTEGER DEFAULT 0, --check
      total_authors     INTEGER DEFAULT 0, --check
      total_halstead_volume    REAL DEFAULT 0, --check
      total_halstead_difficulty REAL DEFAULT 0, --check
      total_halstead_effort    REAL DEFAULT 0, --check
      total_halstead_bugs      REAL DEFAULT 0, --check
      severity_complexity TEXT DEFAULT 'LOW', --check
      severity_coupling   TEXT DEFAULT 'LOW', --check
      severity_issues     TEXT DEFAULT 'LOW', --check
      severity_churn      TEXT DEFAULT 'LOW', --check
      severity_authors    TEXT DEFAULT 'LOW', --check
      severity_halstead   TEXT DEFAULT 'LOW', --check
      overall_severity    TEXT DEFAULT 'LOW', --check
      debt_cov_overall    REAL, --check
      debt_cov_complexity REAL, --check
      debt_cov_coupling   REAL, --check
      debt_cov_issues     REAL, --check
      debt_cov_churn      REAL, --check
      debt_cov_authors    REAL, --check
      debt_cov_halstead   REAL, --check
      sonar_url           TEXT, --check
      issues_url          TEXT, --check
      FOREIGN KEY(sha_id) REFERENCES tbl_sha(sha_id) ON DELETE CASCADE,
      UNIQUE(sha_id, folder_path) -- Una fila por carpeta por SHA
    );

    CREATE TABLE IF NOT EXISTS tbl_folder_hierarchy (
      hierarchy_id  INTEGER PRIMARY KEY AUTOINCREMENT,
      sha_id        INTEGER NOT NULL,
      folder_path   TEXT NOT NULL,
      children      TEXT,
      FOREIGN KEY(sha_id) REFERENCES tbl_sha(sha_id) ON DELETE CASCADE,
      UNIQUE(sha_id, folder_path)
    );

    CREATE TABLE IF NOT EXISTS tbl_city_layout (
      layout_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      sha_id      INTEGER NOT NULL,
      path        TEXT NOT NULL,    
      type        TEXT NOT NULL,    
      root_w      REAL DEFAULT 0,
      root_d      REAL DEFAULT 0,
      child_w     REAL,            
      child_d     REAL,          
      child_x     REAL,           
      child_y     REAL,         
      FOREIGN KEY(sha_id) REFERENCES tbl_sha(sha_id) ON DELETE CASCADE,
      UNIQUE(sha_id, path)
    );
  `;
  db.exec(schema);
  console.log("Base de datos y tablas creadas/verificadas.");
}

function validateDbFile(filePath) {
  let tempDb = null;
  try {
    tempDb = new Database(filePath, { readonly: true, fileMustExist: true });
    const requiredTables = [
      "tbl_sha",
      "tbl_churn",
      "tbl_cohesion",
      "tbl_complexity",
      "tbl_coupling",
      "tbl_coverage_summary",
      "tbl_lint_summary",
      "tbl_file_criticality",
      "tbl_halstead",
      "tbl_folder_metrics",
      "tbl_folder_hierarchy",
      "tbl_city_layout",
    ];
    const rows = tempDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    const existingTables = new Set(rows.map((row) => row.name));
    const missingTables = requiredTables.filter(
      (table) => !existingTables.has(table)
    );
    if (missingTables.length > 0) {
      console.error(
        `Validación fallida. El archivo .db no tiene estas tablas requeridas: ${missingTables.join(
          ", "
        )}`
      );
      return false;
    }
    console.log(
      "Validación exitosa: Todas las tablas requeridas están presentes."
    );
    return true;
  } catch (err) {
    console.error("Error crítico validando estructura de DB:", err.message);
    return false;
  } finally {
    if (tempDb) tempDb.close();
  }
}

module.exports = { getDb, initDb, closeDb, validateDbFile, DB_FILE };
