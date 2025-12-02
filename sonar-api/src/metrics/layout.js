const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

/**
 * Ejecuta gocity-analyzer y obtiene métricas mediante Streaming (STDOUT).
 */
async function getLayoutMetrics(repoPath) {
  console.log(`--- Calculando City Layout (Stream Go) en: ${repoPath} ---`);

  if (!fs.existsSync(path.join(repoPath, "go.mod"))) {
    console.warn("Advertencia: No se encontró go.mod. Saltando.");
    return { layout: [], cohesion: [] };
  }

  const analyzerSourceDir = path.resolve(__dirname, "../../gocity_analyzer");
  if (!fs.existsSync(path.join(analyzerSourceDir, "go.mod"))) {
    throw new Error(`No se encontró el analizador en: ${analyzerSourceDir}`);
  }

  return new Promise((resolve, reject) => {
    const results = { layout: [], cohesion: [] };

    const proc = spawn("go", ["run", ".", repoPath, "STDOUT"], {
      cwd: analyzerSourceDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const rl = readline.createInterface({
      input: proc.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      const l = line.trim();
      if (!l) return;

      // Dividir por espacios en blanco (múltiples espacios se tratan como uno)
      const parts = l.split(/\s+/);

      // Validación rápida: necesitamos al menos 11 columnas según tu .out
      // Path, Type, RootW, RootD, ChildW, ChildD, ChildX, ChildY, Lines, Methods, Attrs
      if (parts.length < 11) return;

      const type = parts[1];

      // --- CORRECCIÓN AQUÍ ---
      // Antes descartabas STRUCT. Ahora lo permitimos.
      if (type !== "FILE" && type !== "PACKAGE" && type !== "STRUCT") return;

      const filePath = parts[0];

      try {
        // Indices basados en tu archivo conc.out:
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
      } catch (e) {
        // Ignorar errores de parsing en líneas individuales
      }
    });

    proc.stderr.on("data", (data) => {
      // console.error(`Go Log: ${data}`);
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

function parseMetric(val) {
  if (!val || val === "N/A") return 0; // Cambiado null a 0 para evitar problemas en DB numéricos
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

module.exports = { getLayoutMetrics };
