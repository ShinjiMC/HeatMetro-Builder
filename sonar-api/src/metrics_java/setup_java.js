// src/metrics/setup_java.js
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");

// --- CONSTANTES DE HERRAMIENTAS ---
// Definimos versiones "Safe" para usar si el proyecto no trae su propio wrapper
const TOOLS_DIR = path.join(os.homedir(), ".tools"); // Aquí guardaremos maven y gradle

const MAVEN_VERSION = "3.9.6";
const MAVEN_URL = `https://archive.apache.org/dist/maven/maven-3/${MAVEN_VERSION}/binaries/apache-maven-${MAVEN_VERSION}-bin.tar.gz`;

const GRADLE_VERSION = "8.5"; // Versión moderna segura por defecto
const GRADLE_URL = `https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`;

// --- UTILIDADES BÁSICAS ---

function runCommand(cmd, options = {}) {
  try {
    const result = execSync(cmd, {
      encoding: "utf8",
      stdio: "pipe",
      ...options,
    });
    return result ? result.trim() : "";
  } catch (error) {
    throw new Error(`Falló: "${cmd}". ${error.stderr || error.message}`);
  }
}

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasJavaFiles(dir) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    return false;
  }

  for (const file of files) {
    const fullPath = path.join(dir, file);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (e) {
      continue;
    }

    if (stat.isDirectory()) {
      if (
        file.startsWith(".") ||
        ["vendor", "node_modules", "target", "build"].includes(file)
      )
        continue;
      if (hasJavaFiles(fullPath)) return true;
    } else if (file.endsWith(".java")) return true;
  }
  return false;
}

function detectJavaVersion(projectPath) {
  // Intento 1: pom.xml
  const pomPath = path.join(projectPath, "pom.xml");
  if (fs.existsSync(pomPath)) {
    const content = fs.readFileSync(pomPath, "utf8");
    const match = content.match(
      /<(?:java\.version|maven\.compiler\.source|source)>(\d+(\.\d+)?)<\//
    );
    if (match) return match[1];
  }
  // Intento 2: build.gradle
  const gradlePath = path.join(projectPath, "build.gradle");
  if (fs.existsSync(gradlePath)) {
    const content = fs.readFileSync(gradlePath, "utf8");
    const match = content.match(
      /sourceCompatibility\s*=\s*['"]?(\d+(\.\d+)?)['"]?/
    );
    if (match) return match[1];
  }
  return "17"; // Default
}

// --- GESTIÓN DE HERRAMIENTAS (MAVEN / GRADLE) ---

function ensureMaven() {
  const mvnBin = path.join(TOOLS_DIR, `apache-maven-${MAVEN_VERSION}`, "bin");
  const mvnExec = path.join(mvnBin, "mvn");

  if (fs.existsSync(mvnExec)) {
    console.log("   ✅ Maven (Caché local) detectado.");
    process.env.PATH = `${mvnBin}${path.delimiter}${process.env.PATH}`;
    return;
  }

  console.log(`   ⬇️ Descargando Maven ${MAVEN_VERSION}...`);
  if (!fs.existsSync(TOOLS_DIR)) fs.mkdirSync(TOOLS_DIR, { recursive: true });

  // Descargar y descomprimir
  execSync(`curl -sL "${MAVEN_URL}" | tar -xz -C "${TOOLS_DIR}"`, {
    stdio: "ignore",
  });

  process.env.PATH = `${mvnBin}${path.delimiter}${process.env.PATH}`;
  console.log("   ✅ Maven instalado y agregado al PATH.");
}

function ensureGradle(projectPath) {
  // 1. Prioridad: Wrapper del proyecto (./gradlew)
  // Esto es lo ideal porque usa la versión EXACTA que el desarrollador definió.
  const wrapperPath = path.join(projectPath, "gradlew");
  if (fs.existsSync(wrapperPath)) {
    console.log("   🐘 Gradle Wrapper detectado. Usando versión del proyecto.");
    try {
      fs.chmodSync(wrapperPath, "755");
    } catch (e) {}
    // No necesitamos instalar nada, el wrapper se auto-instala al ejecutarse.
    return;
  }

  // 2. Fallback: Instalar Gradle genérico si no hay wrapper
  const gradleBin = path.join(TOOLS_DIR, `gradle-${GRADLE_VERSION}`, "bin");
  const gradleExec = path.join(gradleBin, "gradle");

  if (fs.existsSync(gradleExec)) {
    console.log("   ✅ Gradle (Caché local) detectado.");
    process.env.PATH = `${gradleBin}${path.delimiter}${process.env.PATH}`;
    return;
  }

  console.log(
    `   ⬇️ El proyecto no tiene wrapper. Descargando Gradle ${GRADLE_VERSION}...`
  );
  if (!fs.existsSync(TOOLS_DIR)) fs.mkdirSync(TOOLS_DIR, { recursive: true });

  // Gradle viene en ZIP, necesitamos 'unzip' o un truco con python/node si no hay unzip.
  // Asumiremos que en docker tendrás 'unzip' instalado o usamos un one-liner de node para descomprimir si quieres ser muy puro.
  // Para simplicidad aquí usaremos unzip, si falla, avisa.
  try {
    execSync(`curl -sL -o "${TOOLS_DIR}/gradle.zip" "${GRADLE_URL}"`, {
      stdio: "ignore",
    });
    execSync(`unzip -q "${TOOLS_DIR}/gradle.zip" -d "${TOOLS_DIR}"`, {
      stdio: "ignore",
    });
    fs.unlinkSync(`${TOOLS_DIR}/gradle.zip`);
  } catch (e) {
    throw new Error(
      "Fallo descargando Gradle. Asegúrate de tener 'unzip' instalado."
    );
  }

  process.env.PATH = `${gradleBin}${path.delimiter}${process.env.PATH}`;
  console.log("   ✅ Gradle instalado y agregado al PATH.");
}

// --- FUNCIÓN PRINCIPAL ---
function setupJavaEnvironment(rawPath) {
  const projectPath = path.resolve(rawPath);
  console.log(`Configurando entorno Java en: ${projectPath}`);

  if (!fs.existsSync(projectPath)) throw new Error(`Ruta inválida`);

  // --- ESTRATEGIA 1: USAR EL SISTEMA (Docker) ---
  // Como instalaste OpenJDK 17 en el Dockerfile, esto debería funcionar el 99% de las veces.
  try {
    console.log("🔍 Verificando Java del sistema...");

    // FIX 2: Quitamos {stdio: inherit} para que runCommand capture el texto
    // Usamos 2>&1 porque 'java -version' escribe en stderr
    const versionOutput = runCommand("java -version 2>&1");
    const mvnOutput = runCommand("mvn -version");

    if (versionOutput && mvnOutput) {
      console.log("✅ Java y Maven detectados en el sistema (Docker).");
      // Imprimimos la primera línea de la versión para confirmar
      console.log(`   ☕ ${versionOutput.split("\n")[0]}`);

      // Retornamos éxito y terminamos aquí. No tocamos Jabba.
      return { success: true, version: "system" };
    }
  } catch (e) {
    console.warn(
      "⚠️ Java/Maven del sistema no disponibles o fallaron. Iniciando Jabba..."
    );
  }

  // --- ESTRATEGIA 2: JABBA (Solo si falla lo de arriba) ---
  // Este código solo corre si alguien borró Java del Dockerfile

  if (!hasJavaFiles(projectPath)) throw new Error(`No hay archivos .java`);

  // 1. Instalar Jabba si falta
  if (!commandExists("jabba")) {
    console.log("⬇️ Instalando Jabba...");
    execSync(
      "curl -sL https://github.com/shyiko/jabba/raw/master/install.sh | bash",
      { stdio: "ignore" }
    );
    const jabbaBin = path.join(os.homedir(), ".jabba", "bin");
    process.env.PATH = `${jabbaBin}${path.delimiter}${process.env.PATH}`;
  }

  // 2. Intentar instalar Zulu (Muy compatible)
  console.log("⬇️ Intentando instalar JDK con Jabba (Fallback)...");
  try {
    // Usamos Zulu 11 como fallback genérico seguro
    const fallbackPkg = "zulu@1.11";
    execSync(`jabba install ${fallbackPkg}`, { stdio: "inherit" });

    const javaHome = runCommand(`jabba which ${fallbackPkg}`);
    process.env.JAVA_HOME = javaHome;
    process.env.PATH = `${path.join(javaHome, "bin")}${path.delimiter}${
      process.env.PATH
    }`;

    console.log(`   ✅ Jabba configurado con: ${fallbackPkg}`);
  } catch (e) {
    // Si esto también falla, ya no hay mucho que hacer
    throw new Error(`Jabba falló también: ${e.message}`);
  }

  return { success: true, version: "jabba-fallback" };
}

module.exports = { setupJavaEnvironment };
