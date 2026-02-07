const { minimatch } = require("minimatch");
const { spawn, execSync } = require("child_process");
const readline = require("readline");

async function getChurnMetrics(repoPath, exclusions = []) {
  console.log(`--- Calculando Churn Java (Stream Puro) en: ${repoPath} ---`);

  const metricsMap = new Map();

  try {
    const lastCommit = getLastCommitInfo(repoPath);

    if (!lastCommit) {
      console.warn("No se encontraron commits en el repositorio.");
      return [];
    }
    const totalCommits = getTotalCommitCount(repoPath);
    console.log(`HEAD Commit: ${lastCommit.sha} (${lastCommit.date})`);
    console.log(`Total de Commits en historia: ${totalCommits}`);

    let sinceIsoString = null;

    // Lógica de limitación temporal (igual que en Go)
    if (totalCommits > 300) {
      const sinceDate = new Date(lastCommit.date);
      sinceDate.setMonth(sinceDate.getMonth() - 9);
      sinceIsoString = sinceDate.toISOString();
      console.log(
        `> 300 commits detectados. Limitando análisis a 9 meses (desde ${sinceIsoString})`
      );
    } else {
      console.log(`<= 300 commits detectados. Analizando TODO el historial.`);
    }

    // Paso 1: Mapear archivos Java actuales
    await streamCurrentFiles(repoPath, metricsMap, exclusions);
    console.log(`Archivos .java rastreados en HEAD: ${metricsMap.size}`);

    if (metricsMap.size === 0) return [];

    // Paso 2: Analizar historia de Git filtrando por .java
    await streamGitLog(repoPath, metricsMap, sinceIsoString, exclusions);

    const results = [];
    for (const [file, stats] of metricsMap.entries()) {
      results.push({
        file_path: file,
        added: stats.added,
        deleted: stats.deleted,
        total: stats.added + stats.deleted,
        frequency: stats.frequency,
        authors: stats.authors.size,
      });
    }
    console.log(`Churn calculado para ${results.length} archivos.`);
    return results;
  } catch (error) {
    console.error("Error en Churn Stream:", error.message);
    return [];
  }
}

/**
 * Helper para contar el total de commits.
 */
function getTotalCommitCount(repoPath) {
  try {
    const cmd = `git -C "${repoPath}" rev-list --count HEAD`;
    const output = execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseInt(output.trim(), 10) || 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Helper para obtener SHA y Fecha del último commit.
 */
function getLastCommitInfo(repoPath) {
  try {
    const cmd = `git -C "${repoPath}" log -1 --format="%H|%cI"`;
    const output = execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (!output) return null;

    const parts = output.split("|");
    return {
      sha: parts[0],
      date: parts[1],
    };
  } catch (e) {
    return null;
  }
}

/**
 * FASE 1: Stream de archivos actuales (JAVA).
 */
function streamCurrentFiles(repoPath, map, exclusions) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "git",
      ["-C", repoPath, "ls-files", "--exclude-standard", "*.java"],
      { stdio: ["ignore", "pipe", "ignore"] }
    );

    const rl = readline.createInterface({
      input: proc.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      const file = line.trim();
      if (!file) return;

      if (exclusions && exclusions.length > 0) {
        const isExcluded = exclusions.some((pattern) =>
          minimatch(file, pattern, { dot: true, matchBase: true })
        );
        if (isExcluded) return;
      }

      map.set(file, {
        added: 0,
        deleted: 0,
        frequency: 0,
        authors: new Set(),
      });
    });

    proc.on("close", (code) => resolve());
    proc.on("error", (err) => reject(err));
  });
}

/**
 * FASE 2: Stream de Historia (Log).
 * Recibe 'sinceDate' (puede ser null).
 */
function streamGitLog(repoPath, map, sinceDate, exclusions) {
  return new Promise((resolve, reject) => {
    // Construcción dinámica de argumentos
    const args = [
      "-C",
      repoPath,
      "log",
      "--numstat",
      "--pretty=format:###|%H|%ae",
    ];

    // Solo agregamos el filtro de tiempo si sinceDate existe
    if (sinceDate) {
      args.push(`--since=${sinceDate}`);
    }

    // CAMBIO: Agregamos el filtro de extensión para el log también
    args.push("--", "*.java");

    const proc = spawn("git", args, { stdio: ["ignore", "pipe", "ignore"] });

    const rl = readline.createInterface({
      input: proc.stdout,
      crlfDelay: Infinity,
    });

    let currentAuthor = null;

    rl.on("line", (line) => {
      const l = line.trim();
      if (!l) return;

      // Detección de Cabecera
      if (l.startsWith("###|")) {
        const firstPipe = 3;
        const secondPipe = l.indexOf("|", 4);
        if (secondPipe !== -1) {
          currentAuthor = l.substring(secondPipe + 1);
        }
        return;
      }

      // Detección de Numstat
      const parts = l.split(/\s+/);
      if (parts.length < 3) return;

      const file = parts[2];
      if (exclusions && exclusions.length > 0) {
        const isExcluded = exclusions.some((pattern) =>
          minimatch(file, pattern, { dot: true, matchBase: true })
        );
        if (isExcluded) return;
      }
      const stats = map.get(file);
      // Solo procesamos si el archivo está en el mapa (es un .java actual válido)
      if (!stats) return;

      const addRaw = parts[0];
      const delRaw = parts[1];

      if (addRaw !== "-") stats.added += parseInt(addRaw, 10) || 0;
      if (delRaw !== "-") stats.deleted += parseInt(delRaw, 10) || 0;

      stats.frequency++;
      if (currentAuthor) stats.authors.add(currentAuthor);
    });

    proc.on("close", (code) => resolve());
    proc.on("error", (err) => reject(err));
  });
}

module.exports = { getChurnMetrics };
