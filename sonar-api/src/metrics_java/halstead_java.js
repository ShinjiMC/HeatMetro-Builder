const fs = require("fs");
const path = require("path");
const glob = require("glob");

// --- 1. LÓGICA MATEMÁTICA DE HALSTEAD ---

const JAVA_KEYWORDS = new Set([
  "abstract",
  "assert",
  "boolean",
  "break",
  "byte",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "double",
  "else",
  "enum",
  "extends",
  "final",
  "finally",
  "float",
  "for",
  "goto",
  "if",
  "implements",
  "import",
  "instanceof",
  "int",
  "interface",
  "long",
  "native",
  "new",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "short",
  "static",
  "strictfp",
  "super",
  "switch",
  "synchronized",
  "this",
  "throw",
  "throws",
  "transient",
  "try",
  "void",
  "volatile",
  "while",
  "true",
  "false",
  "null",
]);

function calculateHalstead(content) {
  // Limpieza
  let cleanCode = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");

  // Literales
  const stringLiterals = (cleanCode.match(/"(?:[^"\\]|\\.)*"/g) || []).length;
  const charLiterals = (cleanCode.match(/'(?:[^'\\]|\\.)*'/g) || []).length;
  cleanCode = cleanCode
    .replace(/"(?:[^"\\]|\\.)*"/g, "")
    .replace(/'(?:[^'\\]|\\.)*'/g, "");
  // Tokenización
  const tokens =
    cleanCode.match(
      /[a-zA-Z_$][a-zA-Z0-9_$]*|\d+(\.\d+)?|[+\-*/%=!&|^~<>?:]+|[(){}\[\],.;]/g
    ) || [];

  const operators = [];
  const operands = [];

  tokens.forEach((token) => {
    if (JAVA_KEYWORDS.has(token)) {
      operators.push(token);
    } else if (/^[a-zA-Z_$]/.test(token)) {
      operands.push(token);
    } else if (/^\d/.test(token)) {
      operands.push(token);
    } else {
      operators.push(token);
    }
  });

  const totalOperandsCount = operands.length + stringLiterals + charLiterals;
  const uniqueOperandsSet = new Set(operands);
  if (stringLiterals > 0) uniqueOperandsSet.add("__STR__");
  if (charLiterals > 0) uniqueOperandsSet.add("__CHAR__");

  const n1 = new Set(operators).size;
  const n2 = uniqueOperandsSet.size;
  const N1 = operators.length;
  const N2 = totalOperandsCount;

  if (n1 === 0 || n2 === 0) {
    return { volume: 0, difficulty: 0, effort: 0, bugs: 0 };
  }

  const n = n1 + n2;
  const N = N1 + N2;
  const volume = N * Math.log2(n);
  const difficulty = (n1 / 2) * (N2 / n2);
  const effort = difficulty * volume;
  const bugs = volume / 3000;
  return {
    volume: Number(volume.toFixed(2)),
    difficulty: Number(difficulty.toFixed(2)),
    effort: Number(effort.toFixed(2)),
    bugs: Number(bugs.toFixed(2)),
  };
}

// --- 2. HELPERS DE FORMATO ---

function pad(str, len) {
  str = String(str);
  if (str.length >= len) return str.substring(0, len - 1) + " ";
  return str + " ".repeat(len - str.length);
}

function formatFloat(num) {
  return typeof num === "number" ? num.toFixed(2) : "0.00";
}

// --- 3. MAIN LOOP ---
async function getHalsteadMetrics(rootPath, exclusions = []) {
  console.log(`--- Calculando Halstead Java (Regex) en: ${rootPath} ---`);

  const files = glob.sync("**/*.java", {
    cwd: rootPath,
    ignore: exclusions,
  });

  const results = [];
  for (const file of files) {
    const fullPath = path.join(rootPath, file);
    try {
      const content = fs.readFileSync(fullPath, "utf8");
      const metrics = calculateHalstead(content);

      // Normalizar path relativo con "/"
      const relativePath = file.split(path.sep).join("/");

      results.push({
        file_path: relativePath,
        volume: metrics.volume,
        difficulty: metrics.difficulty,
        effort: metrics.effort,
        bugs: metrics.bugs,
      });
    } catch (e) {
      console.warn(`Error leyendo archivo para Halstead: ${file}`, e.message);
    }
  }
  console.log(`✅ Halstead calculado para ${results.length} archivos.`);
  return results;
}
module.exports = { getHalsteadMetrics };
