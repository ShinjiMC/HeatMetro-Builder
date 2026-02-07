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

// --- NUEVO: Función para detectar versión de Java del pom.xml ---
function detectJavaVersion(repoPath) {
  try {
    const pomPath = path.join(repoPath, "pom.xml");
    if (!fs.existsSync(pomPath)) return 17; // Default a 17 si no hay pom

    const content = fs.readFileSync(pomPath, "utf8");

    // Buscamos patrones: <java.version>1.8</java.version> o <source>1.8</source>
    const regex = /<(?:java\.version|maven\.compiler\.source|source)>(.*?)<\//;
    const match = content.match(regex);

    if (match && match[1]) {
      const versionStr = match[1].trim();
      // Si detectamos 1.8, 1.7, 1.6, 8, 7, etc. -> Es Legacy (Java 8)
      if (
        versionStr.startsWith("1.8") ||
        versionStr === "8" ||
        versionStr.startsWith("1.7") ||
        versionStr === "7" ||
        versionStr.startsWith("1.6") ||
        versionStr === "6"
      ) {
        return 8;
      }
    }
    return 17; // Para todo lo demás, Java 17
  } catch (e) {
    console.warn("⚠️ Error detectando versión de Java, usando default 17.");
    return 17;
  }
}

function generateJavaCoverage(repoPath) {
  console.log("--- Procesando Java (Build & Coverage) ---");

  const hasPom = fs.existsSync(path.join(repoPath, "pom.xml"));
  const hasGradle =
    fs.existsSync(path.join(repoPath, "build.gradle")) ||
    fs.existsSync(path.join(repoPath, "build.gradle.kts"));
  if (hasPom) {
    console.log("📦 Proyecto Maven detectado.");

    // 1. DETECCIÓN INTELIGENTE DE JAVA
    const targetVersion = detectJavaVersion(repoPath);
    let javaHomeEnv =
      process.env.JAVA_HOME_17 || "/usr/lib/jvm/java-17-openjdk-amd64";

    if (targetVersion === 8) {
      console.log("👴 Proyecto Legacy detectado. Cambiando entorno a JAVA 8.");
      javaHomeEnv = process.env.JAVA_HOME_8 || "/opt/java/openjdk8";
    } else {
      console.log("☕ Proyecto Moderno detectado. Usando entorno JAVA 17.");
    }

    const envJava = {
      ...process.env,
      JAVA_HOME: javaHomeEnv,
      PATH: `${javaHomeEnv}/bin:${process.env.PATH}`,
    };

    const jacocoVersion = "0.8.11";
    const jacocoReport = `org.jacoco:jacoco-maven-plugin:${jacocoVersion}:report`;

    // Override del compilador: Usamos uno moderno (3.13.0) para asegurar que compile bien
    // independientemente de lo viejo que sea el pom.xml
    const compilerPlugin =
      "org.apache.maven.plugins:maven-compiler-plugin:3.13.0";

    // 1. Compilación (OVERRIDE)
    try {
      console.log(`   👉 1. Compilando proyecto...`);
      execSync(
        `mvn clean resources:resources ${compilerPlugin}:compile resources:testResources ${compilerPlugin}:testCompile -DskipTests -Djacoco.skip=true -Dmaven.compiler.proc=none -Drat.skip=true -Denforcer.skip=true`,
        {
          cwd: repoPath,
          stdio: "inherit",
          env: envJava,
        }
      );
      // execSync(
      //   `mvn clean resources:resources ${compilerPlugin}:compile resources:testResources ${compilerPlugin}:testCompile -DskipTests -Djacoco.skip=true -Dmaven.compiler.proc=none`,
      //   {
      //     cwd: repoPath,
      //     stdio: "inherit",
      //     env: envJava,
      //   }
      // );
    } catch (e) {
      console.error("❌ Error compilando.");
      return;
    }

    // 2. Tests
    try {
      console.log("   👉 2. Preparando Agente JaCoCo...");
      const targetDir = path.join(repoPath, "target");
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      try {
        execSync(
          `mvn org.apache.maven.plugins:maven-dependency-plugin:3.6.0:copy -Dartifact=org.jacoco:org.jacoco.agent:${jacocoVersion}:jar:runtime -DoutputDirectory=${targetDir}`,
          {
            cwd: repoPath,
            stdio: "inherit",
            env: envJava,
          }
        );
      } catch (err) {
        throw new Error("Fallo al descargar el agente de JaCoCo.");
      }

      const agentFilename = `org.jacoco.agent-${jacocoVersion}-runtime.jar`;
      const agentPath = path.join(targetDir, agentFilename);
      const destFile = path.join(repoPath, "target/jacoco.exec");

      if (!fs.existsSync(agentPath))
        throw new Error(`Agente no encontrado: ${agentPath}`);
      const jacocoAgentArg = `-javaagent:${agentPath}=destfile=${destFile} -Djava.awt.headless=true`;

      console.log("   👉 Ejecutando Tests (Standard mvn test)...");

      // CAMBIO CRÍTICO:
      // Volvemos a 'mvn test' simple.
      // Al estar en Java 8, el plugin antiguo del proyecto (Surefire 2.19.1) funcionará bien
      // y será compatible con sus tests antiguos (JUnit 5 Milestone 4).
      // Mantenemos '-Dmaven.compiler.proc=none' por si Maven decide recompilar algo.
      execSync(
        `mvn test -Dmaven.test.failure.ignore=true -DfailIfNoTests=false -Djacoco.skip=true -Dmaven.compiler.proc=none -Drat.skip=true -Denforcer.skip=true -DargLine="${jacocoAgentArg}" -fn`,
        {
          cwd: repoPath,
          stdio: "inherit",
          env: envJava,
        }
      );
      // execSync(
      //   `mvn test -Dmaven.test.failure.ignore=true -DfailIfNoTests=false -Djacoco.skip=true -Dmaven.compiler.proc=none -DargLine="${jacocoAgentArg}" -fn`,
      //   {
      //     cwd: repoPath,
      //     stdio: "inherit",
      //     env: envJava,
      //   }
      // );
    } catch (e) {
      console.warn("   ⚠️ Alerta en tests:", e.message);
    }

    // 3. Generación del Reporte
    try {
      console.log("   👉 3. Generando Reporte XML...");

      const envReport = { ...envJava };
      delete envReport["JAVA_TOOL_OPTIONS"];

      execSync(`mvn ${jacocoReport} -DfailIfNoTests=false -fn`, {
        cwd: repoPath,
        stdio: "inherit",
        env: envReport,
      });

      if (fs.existsSync(path.join(repoPath, "target/site/jacoco/jacoco.xml"))) {
        console.log("   ✅ Reporte XML generado exitosamente.");
      } else {
        console.warn("   ⚠️ No se generó el XML.");
      }
    } catch (e) {
      console.warn("   ⚠️ Fallo al generar reporte final.");
    }
  } else if (hasGradle) {
    // ... (Bloque Gradle sin cambios) ...
    console.log("🐘 Detectado proyecto GRADLE.");
    const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
    const cmd = fs.existsSync(path.join(repoPath, gradlew))
      ? gradlew
      : "gradle";

    try {
      console.log("   👉 Ejecutando Assemble...");
      execSync(`${cmd} clean assemble`, { cwd: repoPath, stdio: "inherit" });
      console.log("   👉 Intentando reporte de tests...");
      try {
        execSync(`${cmd} jacocoTestReport`, {
          cwd: repoPath,
          stdio: "inherit",
        });
      } catch (e) {
        console.warn("   ⚠️ No se pudo generar reporte JaCoCo en Gradle.");
      }
    } catch (e) {
      console.error("❌ Error compilando con Gradle.");
    }
  } else {
    console.warn(
      "⚠️ No se encontró pom.xml ni build.gradle. No se puede compilar Java."
    );
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
  externalPropertiesPath,
  type = "GO"
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
    if (type === "GO") {
      generateGoCoverage(repoPath);
    } else if (type === "JAVA") {
      generateJavaCoverage(repoPath);
    }

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

function getSonarExclusions(propertiesPath) {
  try {
    if (!fs.existsSync(propertiesPath)) return [];

    const content = fs.readFileSync(propertiesPath, "utf8");
    // Buscamos la línea sonar.exclusions=...
    const match = content.match(/^\s*sonar\.exclusions\s*=\s*(.+)$/m);

    if (!match) return [];

    // Separamos por comas y limpiamos espacios
    return match[1].split(",").map((s) => s.trim());
  } catch (e) {
    console.warn("⚠️ No se pudieron leer las exclusiones del properties.");
    return [];
  }
}

module.exports = { processSonarAnalysis, getSonarExclusions };
