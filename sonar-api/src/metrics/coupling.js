const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { minimatch } = require("minimatch");

async function getCouplingMetrics(repoPath, exclusions = []) {
  console.log(`--- Calculando Coupling (Stream) en: ${repoPath} ---`);
  try {
    const fanInCounts = await streamFanIn(repoPath, exclusions);
    const totalPackages = Object.keys(fanInCounts).length;
    console.log(`Fan-In calculado para ${totalPackages} paquetes.`);
    if (totalPackages === 0) {
      console.warn(
        "ADVERTENCIA: No se encontraron paquetes en la Fase 1. Verifica el stderr de arriba."
      );
    }
    const results = await streamFanOut(repoPath, fanInCounts, exclusions);
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
function streamFanIn(repoPath, exclusions) {
  return new Promise((resolve, reject) => {
    const counts = {};
    const template = '{{range .Imports}}{{.}}{{"\\n"}}{{end}}';
    const proc = spawn("go", ["list", "-f", template, "./..."], {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const rl = readline.createInterface({
      input: proc.stdout,
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => {
      const pkg = line.trim();
      if (!pkg) return;
      if (exclusions && exclusions.length > 0) {
        const isExcluded = exclusions.some((pattern) =>
          minimatch(pkg, pattern, { dot: true, matchBase: true })
        );
        if (isExcluded) return;
      }
      counts[pkg] = (counts[pkg] || 0) + 1;
    });
    proc.stderr.on("data", (data) => {
      const output = data.toString().trim();
      if (output && !output.includes("go: downloading")) {
        console.error(`[go list Fan-In Error]: ${output}`);
      }
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        console.warn(`go list (Fan-In) terminó con código de error ${code}`);
      }
      resolve(counts);
    });
    proc.on("error", (err) => reject(err));
  });
}

function streamFanOut(repoPath, fanInCounts, exclusions) {
  return new Promise((resolve, reject) => {
    const results = [];
    const template =
      '{{.Dir}}:{{.ImportPath}}:{{join .GoFiles ","}},{{join .TestGoFiles ","}},{{join .XTestGoFiles ","}}';
    const proc = spawn("go", ["list", "-f", template, "./..."], {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const rl = readline.createInterface({
      input: proc.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      const l = line.trim();
      if (!l) return;
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
        let relativePath = "";
        try {
          relativePath = path.relative(repoPath, fullPath).replace(/\\/g, "/");
        } catch (e) {
          relativePath = fullPath;
        }
        if (exclusions && exclusions.length > 0) {
          const isExcluded = exclusions.some((pattern) =>
            minimatch(relativePath, pattern, { dot: true, matchBase: true })
          );
          if (isExcluded) continue;
        }
        const fileFanOut = countImportsInFile(fullPath);
        results.push({
          file_path: relativePath,
          num_dependency: pkgFanIn,
          num_imports: fileFanOut,
        });
      }
    });
    proc.stderr.on("data", (data) => {
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
