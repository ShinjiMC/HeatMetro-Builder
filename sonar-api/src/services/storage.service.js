const { getDb } = require("./database");
const { updateHierarchicalData } = require("./hierarchy");
const {
  calculateAndSaveFileCriticality,
  calculateAndSaveFolderCriticality,
} = require("./criticality.service");
const path = require("path");

async function processAndSaveMetrics(gitInfo, analysisData) {
  const db = getDb();
  const { sha, author, date, message } = gitInfo;
  console.log(`💾 START: Guardando datos para Commit: ${sha}`);

  const shaResult = db
    .prepare(
      "INSERT INTO tbl_sha (sha_text, commit_date, author_name, commit_message) VALUES (?, ?, ?, ?)"
    )
    .run(sha, date, author, message || "No message");

  const shaId = shaResult.lastInsertRowid;

  // ... (Logs de debug y preparación de mapas sin cambios) ...
  console.log("\n--- 🔍 DEBUG: Inspeccionando estructura de entrada ---");
  if (analysisData.layout && analysisData.layout.cohesion) {
    console.log(
      `DATA COHESION: ${analysisData.layout.cohesion.length} elementos.`
    );
  }
  console.log("--------------------------------------------------\n");

  const fileMap = new Map();
  const folderMetrics = new Map();
  const folderHierarchy = new Map();
  const sonarFolderMap = new Map();
  const fileNclocMap = new Map();
  const fileLinesToCoverMap = new Map();

  const getFileEntry = (filePath) => {
    if (!filePath || filePath === "undefined" || filePath === "null")
      return null;
    if (!fileMap.has(filePath)) {
      fileMap.set(filePath, {
        churn: {},
        halstead: {},
        coupling: {},
        cohesion: { loc: 0, method_count: 0, attr_count: 0 },
        sonar: { coverage: 0, issues: 0, issues_url: null, sonar_url: null },
        complexity: 0,
        layout: null,
      });
    }
    return fileMap.get(filePath);
  };

  // --- POBLAR MAPAS (Sin cambios) ---
  if (Array.isArray(analysisData.halstead)) {
    analysisData.halstead.forEach((h) => {
      const e = getFileEntry(h.file_path || h.file);
      if (e) e.halstead = h;
    });
  }
  if (Array.isArray(analysisData.churn)) {
    analysisData.churn.forEach((c) => {
      const e = getFileEntry(c.file_path || c.file);
      if (e) e.churn = c;
    });
  }
  if (Array.isArray(analysisData.coupling)) {
    analysisData.coupling.forEach((c) => {
      const e = getFileEntry(c.file_path || c.file);
      if (e) e.coupling = c;
    });
  }
  if (analysisData.layout) {
    if (Array.isArray(analysisData.layout.cohesion)) {
      analysisData.layout.cohesion.forEach((c) => {
        const e = getFileEntry(c.file_path);
        if (e) {
          e.cohesion = {
            loc: c.loc || 0,
            method_count: c.method_count || 0,
            attr_count: c.attr_count || 0,
          };
          // Aseguramos guardar el tipo (PACKAGE, STRUCT, FILE)
          if (c.type) {
            if (!e.layout) e.layout = {};
            e.layout.type = c.type;
          }
        }
      });
    }
    if (Array.isArray(analysisData.layout.layout)) {
      analysisData.layout.layout.forEach((l) => {
        if (l.path) {
          const e = getFileEntry(l.path);
          if (e) e.layout = l;
        }
      });
    }
  }

  const sonarFiles = analysisData.sonar.filesData || analysisData.sonar.files;
  if (sonarFiles && Array.isArray(sonarFiles)) {
    sonarFiles.forEach((s) => {
      const path = s.filePath || s.path;
      const entry = getFileEntry(path);
      if (s.ncloc) fileNclocMap.set(path, s.ncloc);
      if (s.lines_to_cover !== undefined)
        fileLinesToCoverMap.set(path, s.lines_to_cover);
      if (entry) {
        entry.sonar = {
          coverage:
            s.coverage?.percentage ??
            (s.coverage !== undefined ? s.coverage : 0),
          issues: s.lint?.numIssues ?? (s.issues || 0),
          complexity: s.complexity || 0,
          sonar_url: s.coverage?.url || s.url,
          issues_url: s.lint?.url || s.issues_url,
        };
        if (s.complexity) entry.complexity = s.complexity;
      }
    });
  }

  if (
    analysisData.sonar.foldersData &&
    Array.isArray(analysisData.sonar.foldersData)
  ) {
    analysisData.sonar.foldersData.forEach((f) =>
      sonarFolderMap.set(f.folderPath, f)
    );
  }

  console.log(`📊 Total entradas en memoria: ${fileMap.size}`);

  // --- PREPARED STATEMENTS (Sin cambios) ---
  const insertChurn = db.prepare(
    `INSERT INTO tbl_churn (sha_id, file_path, added, deleted, total, frequency, authors) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertHalstead = db.prepare(
    `INSERT INTO tbl_halstead (sha_id, file_path, volume, difficulty, effort, bugs) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertCoupling = db.prepare(
    `INSERT INTO tbl_coupling (sha_id, file_path, num_dependency, num_imports) VALUES (?, ?, ?, ?)`
  );
  const insertCoverage = db.prepare(
    `INSERT INTO tbl_coverage_summary (sha_id, file_path, percentage, sonar_url) VALUES (?, ?, ?, ?)`
  );
  const insertLint = db.prepare(
    `INSERT INTO tbl_lint_summary (sha_id, file_path, num_issues, issues_url) VALUES (?, ?, ?, ?)`
  );
  const insertComplexity = db.prepare(
    `INSERT INTO tbl_complexity (sha_id, file_path, value) VALUES (?, ?, ?)`
  );
  const insertCohesion = db.prepare(
    `INSERT INTO tbl_cohesion (sha_id, file_path, loc, func_count, method_count) VALUES (?, ?, ?, ?, ?)`
  );
  const insertLayout = db.prepare(
    `INSERT INTO tbl_city_layout (sha_id, path, type, root_w, root_d, child_w, child_d, child_x, child_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    for (const [filePath, metrics] of fileMap.entries()) {
      if (!filePath) continue;

      const type = metrics.layout ? metrics.layout.type : "FILE";
      // MODIFICACIÓN: Eliminamos el 'continue' si es PACKAGE para que procese layout/cohesion
      // if (type === "PACKAGE") continue;

      try {
        const isStruct = type === "STRUCT";
        const isPackage = type === "PACKAGE";
        const isFile = !isStruct && !isPackage;

        // 1. Tablas específicas de ARCHIVOS (evitamos insertar ceros para paquetes)
        if (isFile) {
          insertChurn.run(
            shaId,
            filePath,
            metrics.churn.added || 0,
            metrics.churn.deleted || 0,
            metrics.churn.total || 0,
            metrics.churn.frequency || 0,
            metrics.churn.authors || 0
          );
          insertHalstead.run(
            shaId,
            filePath,
            metrics.halstead.volume || 0,
            metrics.halstead.difficulty || 0,
            metrics.halstead.effort || 0,
            metrics.halstead.bugs || 0
          );
          insertCoupling.run(
            shaId,
            filePath,
            metrics.coupling.num_dependency || 0,
            metrics.coupling.num_imports || 0
          );
          insertCoverage.run(
            shaId,
            filePath,
            metrics.sonar.coverage,
            metrics.sonar.sonar_url
          );
          insertLint.run(
            shaId,
            filePath,
            metrics.sonar.issues,
            metrics.sonar.issues_url
          );
          insertComplexity.run(shaId, filePath, metrics.complexity);
        }

        // 2. Cohesion y Layout: SE INSERTAN PARA TODOS (Package, Struct, File)
        const realLoc =
          metrics.cohesion.loc > 0
            ? metrics.cohesion.loc
            : metrics.churn.total || 0;

        insertCohesion.run(
          shaId,
          filePath,
          realLoc,
          metrics.cohesion.attr_count || 0,
          metrics.cohesion.method_count || 0
        );

        if (metrics.layout) {
          insertLayout.run(
            shaId,
            filePath,
            metrics.layout.type || "FILE",
            metrics.layout.root_w || 0,
            metrics.layout.root_d || 0,
            metrics.layout.child_w || 0,
            metrics.layout.child_d || 0,
            metrics.layout.child_x || 0,
            metrics.layout.child_y || 0
          );
        }

        // 3. Manejo de Folder Metrics

        if (isPackage) {
          // MODIFICACIÓN: Si es paquete, insertamos sus métricas estructurales DIRECTAS en folderMetrics.
          // Normalizamos path para que coincida con lo que genera hierarchy.js
          const normalizedPath = filePath.replace(/\\/g, "/");

          // Obtenemos lo que ya exista (acumulado por hierarchy de hijos) o creamos nuevo
          const stats = folderMetrics.get(normalizedPath) || {
            total_issues: 0,
            total_complexity: 0,
            total_churn: 0,
            total_coupling_deps: 0,
            total_frequency: 0,
            total_authors: 0,
            total_halstead_volume: 0,
            total_halstead_difficulty: 0,
            total_halstead_effort: 0,
            total_halstead_bugs: 0,
            // Estos serán sobrescritos:
            total_loc: 0,
            total_func_count: 0,
            total_method_count: 0,
          };

          // ASIGNACIÓN DIRECTA (No acumulada)
          stats.total_loc = realLoc;
          stats.total_func_count = metrics.cohesion.attr_count || 0;
          stats.total_method_count = metrics.cohesion.method_count || 0;

          // También asignamos complejidad si el paquete la trae directa
          if (metrics.complexity > 0) {
            stats.total_complexity = metrics.complexity;
          }

          folderMetrics.set(normalizedPath, stats);
        }

        if (isFile) {
          // UPDATE HIERARCHY: Acumula métricas "suaves" (Churn, Issues, etc.)
          // Ya no acumulará LOC/Methods/Funcs porque lo quitamos en hierarchy.js
          const hierarchyInput = {
            total_issues: metrics.sonar.issues,
            total_complexity: metrics.complexity,
            total_churn: metrics.churn.total,
            total_coupling_deps: metrics.coupling.num_dependency || 0,
            total_loc: realLoc,
            total_frequency: metrics.churn.frequency,
            total_authors: metrics.churn.authors,
            total_halstead_volume: metrics.halstead.volume,
            total_halstead_difficulty: metrics.halstead.difficulty,
            total_halstead_effort: metrics.halstead.effort,
            total_halstead_bugs: metrics.halstead.bugs,
            total_func_count: metrics.cohesion.attr_count || 0,
            total_method_count: metrics.cohesion.method_count || 0,
            accumulated_coverage: 0,
            file_count: 1,
          };
          updateHierarchicalData(
            filePath,
            hierarchyInput,
            folderMetrics,
            folderHierarchy
          );
        }
      } catch (err) {
        console.error(`❌ Error insertando '${filePath}': ${err.message}`);
        throw err;
      }
    }
  });
  tx();
  console.log(`✅ Archivos procesados e insertados.`);

  // --- INSERT FOLDERS (Sin cambios en la lógica de inserción) ---
  const insertFolder = db.prepare(
    `INSERT INTO tbl_folder_metrics (sha_id, folder_path, total_issues, total_complexity, total_churn, total_coupling_deps, total_loc, total_func_count, total_method_count, total_frequency, total_authors, total_halstead_volume, total_halstead_difficulty, total_halstead_effort, total_halstead_bugs, avg_coverage, sonar_url, issues_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertHierarchy = db.prepare(
    `INSERT INTO tbl_folder_hierarchy (sha_id, folder_path, children) VALUES (?, ?, ?)`
  );

  const folderTx = db.transaction(() => {
    for (const [folderPath, stats] of folderMetrics.entries()) {
      let finalAvgCoverage = 0;
      let sonarUrl = null;
      let issuesUrl = null;

      const normalizedPath = folderPath.replace(/\\/g, "/");
      if (sonarFolderMap.has(normalizedPath)) {
        const sonarData = sonarFolderMap.get(normalizedPath);
        if (sonarData.metrics && sonarData.metrics.avg_coverage !== undefined) {
          finalAvgCoverage = sonarData.metrics.avg_coverage;
        }
        if (sonarData.urls) {
          sonarUrl = sonarData.urls.sonar_url || null;
          issuesUrl = sonarData.urls.issues_url || null;
        }
      }

      insertFolder.run(
        shaId,
        folderPath,
        stats.total_issues || 0,
        stats.total_complexity || 0,
        stats.total_churn || 0,
        stats.total_coupling_deps || 0,
        stats.total_loc || 0,
        stats.total_func_count || 0,
        stats.total_method_count || 0,
        stats.total_frequency || 0,
        stats.total_authors || 0,
        stats.total_halstead_volume || 0,
        stats.total_halstead_difficulty || 0,
        stats.total_halstead_effort || 0,
        stats.total_halstead_bugs || 0,
        finalAvgCoverage,
        sonarUrl,
        issuesUrl
      );

      const childrenSet = folderHierarchy.get(folderPath);
      insertHierarchy.run(
        shaId,
        folderPath,
        JSON.stringify(childrenSet ? Array.from(childrenSet) : [])
      );
    }
  });
  folderTx();
  console.log(`✅ Carpetas insertadas.`);

  calculateAndSaveFileCriticality(shaId, fileNclocMap);
  calculateAndSaveFolderCriticality(shaId, fileLinesToCoverMap);
  console.log("🏁 FIN.");
}

function isCommitAnalyzed(sha) {
  return new Promise((resolve, reject) => {
    try {
      const db = getDb();
      const query = "SELECT sha_id FROM tbl_sha WHERE sha_text = ?";
      const row = db.prepare(query).get(sha);
      resolve(!!row);
    } catch (err) {
      console.error("Error verificando commit:", err);
      reject(err);
    }
  });
}

module.exports = { processAndSaveMetrics, isCommitAnalyzed };
