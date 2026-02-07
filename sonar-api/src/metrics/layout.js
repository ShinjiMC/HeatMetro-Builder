const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const os = require("os");
const { minimatch } = require("minimatch");

function runCommand(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe" }).trim();
  } catch (e) {
    return "";
  }
}

/**
 * Helper para obtener la versión definida en el go.mod del proyecto
 */
function getProjectGoVersion(repoPath) {
  try {
    const goModPath = path.join(repoPath, "go.mod");
    if (!fs.existsSync(goModPath)) return null;
    const content = fs.readFileSync(goModPath, "utf8");
    const match = content.match(/^go\s+(\d+(\.\d+)?(\.\d+)?)/m);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

/**
 * Cambia la versión de Go usando 'g' y actualiza las variables de entorno de Node
 * replicando la lógica de setup_go.js
 */
function switchGlobalGo(version) {
  console.log(`[Go Switch] Cambiando entorno global a Go ${version}...`);

  // 1. Verificar si está instalada, si no, instalar
  const installedVersions = runCommand("g ls");
  if (!installedVersions.includes(version)) {
    console.log(`[Go Switch] Instalando Go ${version}...`);
    try {
      execSync(`g install ${version}`, { stdio: "inherit" });
    } catch (e) {
      console.error(`[Go Switch] Error instalando ${version}: ${e.message}`);
      throw e;
    }
  }
  try {
    execSync(`g use ${version}`, { stdio: "inherit" });
  } catch (e) {
    console.error(`[Go Switch] Error en 'g use': ${e.message}`);
    throw e;
  }
  const homeDir = os.homedir();
  const gHome = path.join(homeDir, ".g");
  const goRoot = path.join(gHome, "go");
  const goBin = path.join(goRoot, "bin");
  const goPath = process.env.GOPATH || path.join(homeDir, "go");
  const goPathBin = path.join(goPath, "bin");
  process.env.GOROOT = goRoot;
  process.env.GOPATH = goPath;
  process.env.PATH = `${goBin}${path.delimiter}${goPathBin}${path.delimiter}${process.env.PATH}`;
  try {
    const currentVersion = execSync("go version").toString().trim();
    console.log(
      `[Go Switch] Éxito. Entorno actualizado. Versión activa: ${currentVersion}`
    );
  } catch (e) {
    console.warn(
      `[Go Switch] Advertencia: No se pudo verificar la versión: ${e.message}`
    );
  }
}

/**
 * Ejecuta gocity-analyzer y obtiene métricas mediante Streaming (STDOUT).
 */
async function getLayoutMetrics(repoPath, exclusions = []) {
  console.log(`--- Calculando City Layout (Stream Go) en: ${repoPath} ---`);
  if (!fs.existsSync(path.join(repoPath, "go.mod"))) {
    console.warn("Advertencia: No se encontró go.mod. Saltando.");
    return { layout: [], cohesion: [] };
  }

  const analyzerSourceDir = path.resolve(__dirname, "../../gocity_analyzer");
  if (!fs.existsSync(path.join(analyzerSourceDir, "go.mod"))) {
    throw new Error(`No se encontró el analizador en: ${analyzerSourceDir}`);
  }

  const originalVersion = getProjectGoVersion(repoPath);
  const targetVersion = "1.22.1";

  try {
    switchGlobalGo(targetVersion);
    return await runAnalyzerProcess(repoPath, analyzerSourceDir, exclusions);
  } catch (e) {
    console.error("No se pudo cambiar la versión de Go. Abortando Layout.");
    return { layout: [], cohesion: [] };
  } finally {
    console.log(`[Layout] Restaurando entorno a Go ${originalVersion}...`);
    try {
      switchGlobalGo(originalVersion);
    } catch (e) {
      console.error(
        `[Layout] Error restaurando versión original: ${e.message}`
      );
    }
  }
}

function parseMetric(val) {
  if (!val || val === "N/A") return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function runAnalyzerProcess(repoPath, analyzerSourceDir, exclusions) {
  return new Promise((resolve, reject) => {
    const results = { layout: [], cohesion: [] };
    const exclusionArg = exclusions.join(",") || "";

    const proc = spawn("go", ["run", ".", repoPath, "STDOUT", exclusionArg], {
      cwd: analyzerSourceDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GODEBUG: "cgocheck=0" },
    });

    const rl = readline.createInterface({
      input: proc.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      const l = line.trim();
      if (!l) return;
      const parts = l.split(/\s+/);
      if (parts.length < 11) return;
      const type = parts[1];
      if (type !== "FILE" && type !== "PACKAGE" && type !== "STRUCT") return;
      const filePath = parts[0];
      if (exclusions && exclusions.length > 0) {
        const isExcluded = exclusions.some((pattern) =>
          minimatch(filePath, pattern, { dot: true, matchBase: true })
        );
        if (isExcluded) return;
      }
      try {
        // 0:Path, 1:Type, 2:RootW, 3:RootD, 4:ChildW, 5:ChildD, 6:ChildX, 7:ChildY, 8:Lines, 9:Methods, 10:Attrs
        const loc = parseInt(parts[8], 10) || 0;
        const methods = parseInt(parts[9], 10) || 0;
        const attrs = parseInt(parts[10], 10) || 0;
        results.cohesion.push({
          file_path: filePath,
          type: type,
          loc: loc,
          method_count: methods,
          attr_count: attrs,
        });
        results.layout.push({
          path: filePath,
          type: type,
          root_w: parseMetric(parts[2]),
          root_d: parseMetric(parts[3]),
          child_w: parseMetric(parts[4]),
          child_d: parseMetric(parts[5]),
          child_x: parseMetric(parts[6]),
          child_y: parseMetric(parts[7]),
        });
      } catch (e) {}
    });

    proc.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes("go: downloading")) {
        console.error(`Go Log: ${msg}`);
      }
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        console.warn(
          `El analizador Go terminó con código ${code}. Resultados: ${results.layout.length}`
        );
      } else {
        console.log(`Layout calculado: ${results.layout.length} elementos.`);
      }
      resolve(results);
    });
    proc.on("error", (err) => reject(err));
  });
}

module.exports = { getLayoutMetrics };
