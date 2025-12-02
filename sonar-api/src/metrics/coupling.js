const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

/**
 * Calcula métricas de Acoplamiento (Coupling) usando Streams.
 * Incluye corrección de escaping para templates de Go y logging de errores.
 */
async function getCouplingMetrics(repoPath) {
  console.log(`--- Calculando Coupling (Stream) en: ${repoPath} ---`);

  try {
    // FASE 1: Calcular Fan-In
    const fanInCounts = await streamFanIn(repoPath);
    const totalPackages = Object.keys(fanInCounts).length;

    console.log(`Fan-In calculado para ${totalPackages} paquetes.`);

    if (totalPackages === 0) {
      console.warn(
        "ADVERTENCIA: No se encontraron paquetes en la Fase 1. Verifica el stderr de arriba."
      );
    }

    // FASE 2: Calcular Fan-Out
    const results = await streamFanOut(repoPath, fanInCounts);
    console.log(`Coupling calculado para ${results.length} archivos.`);

    return results;
  } catch (error) {
    console.error("Error fatal calculando Coupling:", error.message);
    return [];
  }
}

/**
 * FASE 1: Stream de Imports para Fan-In
 */
function streamFanIn(repoPath) {
  return new Promise((resolve, reject) => {
    const counts = {};

    // CORRECCIÓN IMPORTANTE: Usamos "{{\"\\n\"}}" (doble barra)
    // para que JS pase el literal \n a Go, y no un salto de línea real.
    const template = '{{range .Imports}}{{.}}{{"\\n"}}{{end}}';

    const proc = spawn("go", ["list", "-f", template, "./..."], {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "pipe"], // Habilitamos stderr (pipe)
    });

    const rl = readline.createInterface({
      input: proc.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      const pkg = line.trim();
      if (!pkg) return;
      // Filtrar vendor
      if (pkg.includes("/vendor/") || pkg.startsWith("vendor/")) return;
      counts[pkg] = (counts[pkg] || 0) + 1;
    });

    // --- NUEVO: Captura de errores de Go ---
    proc.stderr.on("data", (data) => {
      // Imprimimos el error tal cual nos lo da Go para depurar
      console.error(`[go list Fan-In Error]: ${data.toString().trim()}`);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        console.warn(`go list (Fan-In) terminó con código de error ${code}`);
        // No rechazamos la promesa para permitir que el proceso continúe
        // aunque sea con datos parciales, pero el log de arriba explicará el porqué.
      }
      resolve(counts);
    });

    proc.on("error", (err) => reject(err));
  });
}

/**
 * FASE 2: Stream de Directorios para Fan-Out y Ensamble
 */
function streamFanOut(repoPath, fanInCounts) {
  return new Promise((resolve, reject) => {
    const results = [];

    // Template: Dir : ImportPath : ListaArchivos
    const template =
      '{{.Dir}}:{{.ImportPath}}:{{join .GoFiles ","}},{{join .TestGoFiles ","}},{{join .XTestGoFiles ","}}';

    const proc = spawn("go", ["list", "-f", template, "./..."], {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "pipe"], // Habilitamos stderr
    });

    const rl = readline.createInterface({
      input: proc.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      const l = line.trim();
      if (!l) return;

      if (l.includes("/vendor/") || l.startsWith("vendor/")) return;

      // Parseo robusto
      const lastColon = l.lastIndexOf(":");
      const secondLastColon = l.lastIndexOf(":", lastColon - 1);

      if (lastColon === -1 || secondLastColon === -1) return;

      const absDir = l.substring(0, secondLastColon);
      const importPath = l.substring(secondLastColon + 1, lastColon);
      const rawFilesStr = l.substring(lastColon + 1);

      if (!rawFilesStr.trim()) return;

      const pkgFanIn = fanInCounts[importPath] || 0;
      const files = rawFilesStr.split(",").filter((f) => f.trim() !== "");

      for (const file of files) {
        const fullPath = path.join(absDir, file);
        const fileFanOut = countImportsInFile(fullPath);

        // Calculamos path relativo seguro
        let relativePath = "";
        try {
          relativePath = path.relative(repoPath, fullPath).replace(/\\/g, "/");
        } catch (e) {
          relativePath = fullPath; // Fallback
        }

        results.push({
          file_path: relativePath,
          num_dependency: pkgFanIn,
          num_imports: fileFanOut,
        });
      }
    });

    // --- NUEVO: Captura de errores de Go ---
    proc.stderr.on("data", (data) => {
      // Algunos mensajes de stderr en 'go list' son advertencias no fatales
      // pero es útil verlas si el exit code es != 0
      const msg = data.toString().trim();
      if (msg) console.error(`[go list Fan-Out Log]: ${msg}`);
    });

    proc.on("close", (code) => {
      if (code !== 0)
        console.warn(`go list (Fan-Out) terminó con código ${code}`);
      resolve(results);
    });

    proc.on("error", (err) => reject(err));
  });
}

function countImportsInFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    let count = 0;
    let inImportBlock = false;

    for (const rawLine of lines) {
      const l = rawLine.trim();
      if (l.startsWith("//")) continue;

      if (l.startsWith("import (")) {
        inImportBlock = true;
        continue;
      }
      if (l === ")" && inImportBlock) {
        inImportBlock = false;
        continue;
      }
      if (inImportBlock) {
        if (l !== "" && !l.startsWith("//") && l.includes('"')) count++;
      }
      if (l.startsWith("import ") && l.includes('"') && !l.includes("(")) {
        count++;
      }
    }
    return count;
  } catch (e) {
    return 0;
  }
}

module.exports = { getCouplingMetrics };
