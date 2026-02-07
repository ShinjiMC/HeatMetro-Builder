const fs = require("fs");
const path = require("path");
const glob = require("glob"); // Usamos glob para facilitar la búsqueda recursiva

/**
 * Calcula métricas de acoplamiento (Fan-In/Fan-Out) para proyectos Java.
 * Retorna un array de objetos listo para la base de datos.
 */
async function getCouplingMetrics(projectPath, exclusions = []) {
  console.log(`--- Calculando Coupling Java (Regex) en: ${projectPath} ---`);

  // --- VARIABLES DE ESTADO ---
  // Mapa para contar imports específicos (Fan-In explícito)
  const globalImportCounts = new Map();
  // Mapa para contar imports de paquete wildcard (Fan-In implícito)
  const packageImportCounts = new Map();
  // Registro temporal de archivos para la segunda pasada
  const fileRegistry = [];

  // --- FASE 1: Escaneo y Construcción del Grafo ---

  // Usamos glob para encontrar todos los .java ignorando basura
  const files = glob.sync("**/*.java", {
    cwd: projectPath,
    ignore: exclusions,
  });

  for (const file of files) {
    const fullPath = path.join(projectPath, file);
    let content = "";
    try {
      content = fs.readFileSync(fullPath, "utf8");
    } catch (e) {
      continue;
    }

    // 1. Limpieza básica
    const cleanCode = content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");

    // 2. Identificar Identidad (Paquete + Clase)
    const packageMatch = cleanCode.match(/^\s*package\s+([\w\.]+)\s*;/m);
    const packageName = packageMatch ? packageMatch[1] : "";
    const className = path.basename(file, ".java");
    const myFullName = packageName ? `${packageName}.${className}` : className;

    // 3. Extraer Imports (Fan-Out)
    const imports = [];
    const importRegex = /^\s*import\s+(?:static\s+)?([\w\.\*]+)\s*;/gm;
    let match;
    while ((match = importRegex.exec(cleanCode)) !== null) {
      imports.push(match[1]);
    }

    // 4. Registrar Votos (Fan-In)
    imports.forEach((imp) => {
      if (!imp.endsWith("*")) {
        // Import explícito: Alguien usa "com.example.User"
        globalImportCounts.set(imp, (globalImportCounts.get(imp) || 0) + 1);
      } else {
        // Import wildcard: Alguien usa "com.example.*"
        const pkg = imp.slice(0, -2);
        packageImportCounts.set(pkg, (packageImportCounts.get(pkg) || 0) + 1);
      }
    });

    // Guardar para Fase 2
    fileRegistry.push({
      relativePath: file.split(path.sep).join("/"), // Normalizar path
      fullName: myFullName,
      packageName: packageName,
      fanOut: imports.length,
    });
  }

  // --- FASE 2: Cálculo Final y Retorno ---

  const results = fileRegistry.map((file) => {
    // Calcular Fan-In
    let fanIn = globalImportCounts.get(file.fullName) || 0;

    // Sumar votos de paquete (aproximación)
    if (file.packageName) {
      fanIn += packageImportCounts.get(file.packageName) || 0;
    }

    return {
      file_path: file.relativePath,
      num_dependency: fanIn, // Fan-In (Quién depende de mí)
      num_imports: file.fanOut, // Fan-Out (De quién dependo)
    };
  });

  console.log(`Coupling calculado para ${results.length} archivos.`);
  return results;
}

module.exports = { getCouplingMetrics };
