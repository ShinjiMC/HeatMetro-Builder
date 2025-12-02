const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const sonarqubeScanner = require("sonarqube-scanner");
const { extractSonarMetrics } = require("./sonar.metrics");
// Importamos la función para verificar si la rama existe
const { checkBranchExists } = require("./sonar.client");

// --- Helpers ---

function getGitSha(repoPath) {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: repoPath,
      encoding: "utf8",
    }).trim();
  } catch (e) {
    throw new Error("No se pudo obtener el SHA de git.");
  }
}

function generateGoCoverage(repoPath) {
  console.log("--- Generando reporte de cobertura Go ---");
  try {
    execSync("go test -coverprofile=coverage.out ./...", {
      cwd: repoPath,
      stdio: "inherit",
    });
    console.log("✅ Coverage generado.");
  } catch (error) {
    console.warn("⚠️ Error generando coverage. Continuando sin él.");
  }
}

// Helper para buscar la clave del proyecto en el archivo properties
function getProjectKey(propertiesPath) {
  const content = fs.readFileSync(propertiesPath, "utf8");
  const match = content.match(/^\s*sonar\.projectKey\s*=\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function setupPropertiesFile(repoPath, externalPropsPath) {
  console.log(`--- Copiando configuración a: ${repoPath} ---`);
  if (!fs.existsSync(externalPropsPath)) {
    throw new Error(`No se encontró el archivo: ${externalPropsPath}`);
  }
  const destPath = path.join(repoPath, "sonar-project.properties");
  fs.copyFileSync(externalPropsPath, destPath);
  console.log("✅ sonar-project.properties copiado.");
  return destPath;
}

async function runScanner(repoPath, token, branchName) {
  console.log(`--- Ejecutando SonarScanner ---`);
  console.log(`    Rama: ${branchName}`);

  const originalCwd = process.cwd();
  let scanFn = sonarqubeScanner.scan || sonarqubeScanner;

  try {
    process.chdir(repoPath);
    console.log(`CWD: ${process.cwd()}`);

    await new Promise((resolve, reject) => {
      const result = scanFn(
        {
          serverUrl: "https://sonarcloud.io",
          token: token,
          options: {
            "sonar.branch.name": branchName,
            "sonar.login": token,
          },
        },
        () => {
          console.log("--- Callback Scanner ---");
          resolve();
        }
      );
      if (result && typeof result.then === "function") {
        result.then(() => resolve()).catch(reject);
      }
    });
  } finally {
    process.chdir(originalCwd);
    console.log("✅ Escáner finalizado.");
  }
}

// Función de espera
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Flujo Principal: Sube código (si no existe), limpia y extrae métricas.
 */
async function processSonarAnalysis(
  repoPath,
  sonarToken,
  externalPropertiesPath
) {
  if (!externalPropertiesPath)
    throw new Error("Se requiere sonar-project.properties");

  // 1. Preparar Datos de Configuración
  const sha = getGitSha(repoPath);
  const branchName = `commit-${sha}`;
  console.log(`Commit (Branch): ${branchName}`);

  // Obtenemos ProjectKey del archivo externo antes de hacer nada
  const projectKey = getProjectKey(externalPropertiesPath);
  if (!projectKey)
    throw new Error(
      "No se encontró sonar.projectKey en el archivo de propiedades"
    );

  const config = {
    token: sonarToken,
    projectKey: projectKey,
    branch: branchName,
  };

  // 2. Verificar si la rama YA existe en SonarCloud
  console.log("Verificando existencia en SonarCloud...");
  const branchExists = await checkBranchExists(config);

  // 3. Lógica Condicional de Análisis
  if (branchExists) {
    console.log("✅ La rama YA existe en SonarCloud. Saltando análisis.");
  } else {
    console.log("⚠️ La rama NO existe. Iniciando proceso de subida...");

    // Paso A: Coverage
    generateGoCoverage(repoPath);

    // Paso B: Properties
    const tempPropsPath = setupPropertiesFile(repoPath, externalPropertiesPath);

    // Paso C: Scanner
    await runScanner(repoPath, sonarToken, branchName);

    // Paso D: Limpieza (Solo si nosotros creamos los archivos)
    console.log("--- Limpiando archivos temporales ---");
    const filesToDelete = [tempPropsPath, path.join(repoPath, "coverage.out")];
    filesToDelete.forEach((f) => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });

    const scannerWorkDir = path.join(repoPath, ".scannerwork");
    if (fs.existsSync(scannerWorkDir)) {
      try {
        fs.rmSync(scannerWorkDir, { recursive: true, force: true });
        console.log("✅ .scannerwork eliminado.");
      } catch (e) {
        console.warn("No se pudo borrar .scannerwork", e.message);
      }
    }
  }

  // 4. EXTRACCIÓN DE MÉTRICAS (Común para ambos casos)
  console.log("--- Extrayendo Métricas desde SonarCloud ---");

  // Intentamos varias veces (útil si acabamos de subir y Sonar está procesando)
  // Si la rama ya existía, debería responder rápido en el primer intento.
  const MAX_ATTEMPTS = 10;
  const DELAY = 5000; // 5 segundos

  let metrics = null;

  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    console.log(`Intento ${i}/${MAX_ATTEMPTS}... consultando API.`);

    try {
      metrics = await extractSonarMetrics(config);
      // Si devuelve archivos, es que ya tenemos datos
      if (metrics.filesData.length > 0) {
        console.log(
          `✅ Métricas obtenidas: ${metrics.filesData.length} archivos.`
        );
        break;
      } else if (branchExists && i === 1) {
        // Si la rama supuestamente existe pero devuelve 0 archivos, es raro,
        // pero permitimos el retry por si acaso.
        console.log("   Rama existe pero API devolvió 0 archivos...");
      }
    } catch (e) {
      // Si da error, seguimos intentando
    }

    // Si ya obtuvimos métricas, salimos del bucle
    if (metrics && metrics.filesData.length > 0) break;

    await wait(DELAY);
  }

  if (!metrics || metrics.filesData.length === 0) {
    console.warn(
      "⚠️ No se pudieron obtener métricas. (Puede que el análisis fallara o siga procesando)"
    );
    return { filesData: [], foldersData: [] };
  }

  return metrics;
}

module.exports = { processSonarAnalysis };
