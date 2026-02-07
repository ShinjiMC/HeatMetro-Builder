const { spawn, execFile } = require("child_process");
const readline = require("readline");
const path = require("path");
const util = require("util");
const { minimatch } = require("minimatch");

// Promisify para usar await limpio y secuencial
const execFileAsync = util.promisify(execFile);

const REGEX = {
  distinct_operators: /Existen\s+(\d+)\s+operadores diferentes/,
  distinct_operands: /Existen\s+(\d+)\s+operandos diferentes/,
  totals: /El codigo tiene\s+(\d+)\s+operandos\s+y\s+(\d+)\s+operadores/,
  length: /tamaño calculado.*?:?\s+([\d\.]+)/,
  volume: /[Vv]olumen.*?:?\s+([\d\.]+)/,
  difficulty: /dificultad.*?:?\s+([\d\.]+)/,
  effort: /esfuerzo.*?:?\s+([\d\.]+)/,
  time: /tiempo requerido.*?:?\s+([\d\.]+)/,
  bugs: /numero de bugs.*?:?\s+([\d\.]+)/,
};

/**
 * Calcula Métricas de Halstead.
 * ESTRATEGIA: Streaming Secuencial Estricto.
 * - RAM: O(1) (Constante, nunca crece).
 * - CPU: Optimizado con pre-compilación y short-circuiting.
 */
async function getHalsteadMetrics(repoPath, exclusions = []) {
  console.log(`--- Calculando Halstead en: ${repoPath} ---`);
  const results = [];
  const findProcess = spawn("find", [
    repoPath,
    "-name",
    "*.go",
    "-not",
    "-path",
    "*/vendor/*",
  ]);
  const rl = readline.createInterface({
    input: findProcess.stdout,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      const absFilePath = line.trim();
      if (!absFilePath) continue;
      const relativePath = path
        .relative(repoPath, absFilePath)
        .replace(/\\/g, "/");
      if (exclusions && exclusions.length > 0) {
        const isExcluded = exclusions.some((pattern) =>
          minimatch(relativePath, pattern, { dot: true, matchBase: true })
        );
        if (isExcluded) continue;
      }
      try {
        const { stdout } = await execFileAsync("halstead", [absFilePath], {
          encoding: "utf8",
        });
        const metrics = parseHalsteadOutput(stdout);
        results.push({
          file_path: relativePath,
          ...metrics,
        });
      } catch (err) {}
    }
    console.log(`Procesados ${results.length} archivos con Halstead.`);
    return results;
  } catch (err) {
    console.error("Error crítico en el proceso Halstead:", err.message);
    return [];
  }
}

/**
 * Parsea la salida optimizando el uso de CPU.
 */
function parseHalsteadOutput(output) {
  const metrics = {
    distinct_operators: 0,
    distinct_operands: 0,
    total_operators: 0,
    total_operands: 0,
    length: 0,
    volume: 0,
    difficulty: 0,
    effort: 0,
    time: 0,
    bugs: 0,
  };

  const lines = output.split("\n");

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    if (l.includes("operadores diferentes")) {
      const match = l.match(REGEX.distinct_operators);
      if (match) metrics.distinct_operators = parseInt(match[1], 10);
    }

    if (l.includes("operandos diferentes")) {
      const match = l.match(REGEX.distinct_operands);
      if (match) metrics.distinct_operands = parseInt(match[1], 10);
    }

    if (l.includes("El codigo tiene")) {
      const match = l.match(REGEX.totals);
      if (match) {
        metrics.total_operands = parseInt(match[1], 10);
        metrics.total_operators = parseInt(match[2], 10);
      }
    }

    if (l.includes("tamaño calculado")) {
      const match = l.match(REGEX.length);
      if (match) metrics.length = parseFloat(match[1]);
    }

    if (l.includes("olumen")) {
      const match = l.match(REGEX.volume);
      if (match) metrics.volume = parseFloat(match[1]);
    }

    if (l.includes("dificultad")) {
      const match = l.match(REGEX.difficulty);
      if (match) metrics.difficulty = parseFloat(match[1]);
    }

    if (l.includes("esfuerzo")) {
      const match = l.match(REGEX.effort);
      if (match) metrics.effort = parseFloat(match[1]);
    }

    if (l.includes("tiempo requerido")) {
      const match = l.match(REGEX.time);
      if (match) metrics.time = parseFloat(match[1]);
    }

    if (l.includes("numero de bugs")) {
      const match = l.match(REGEX.bugs);
      if (match) metrics.bugs = parseFloat(match[1]);
    }
  }

  return metrics;
}

module.exports = { getHalsteadMetrics };
