// src/metrics/setup_go.js
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");

function runCommand(cmd, options = {}) {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: "pipe",
      ...options,
    }).trim();
  } catch (error) {
    throw new Error(
      `Falló el comando: "${cmd}".\nStderr: ${error.stderr || error.message}`
    );
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

function hasGoFiles(dir) {
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
        file === "vendor" ||
        file === "node_modules"
      ) {
        continue;
      }
      if (hasGoFiles(fullPath)) return true;
    } else if (file.endsWith(".go")) {
      return true;
    }
  }
  return false;
}

function setupGoEnvironment(rawPath) {
  const projectPath = path.resolve(rawPath);
  console.log(`Configurando entorno Go en: ${projectPath}`);

  // 1. Validaciones básicas
  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    throw new Error(`Ruta no válida o no es un directorio: ${projectPath}`);
  }

  // 2. Validación de archivos .go
  if (!hasGoFiles(projectPath)) {
    throw new Error(`No se encontraron archivos .go en el proyecto.`);
  }

  if (!commandExists("g")) {
    throw new Error(
      "'g' no está en el PATH. Instálalo: go install github.com/voidint/g/cmd/g@latest"
    );
  }

  const goModFile = path.join(projectPath, "go.mod");
  if (!fs.existsSync(goModFile)) {
    throw new Error(`No se encontró 'go.mod' en ${projectPath}`);
  }

  // 3. Obtener versión
  const goModContent = fs.readFileSync(goModFile, "utf8");
  const versionMatch = goModContent.match(/^go\s+(\d+(\.\d+)?(\.\d+)?)/m);
  if (!versionMatch) {
    throw new Error(`No se encontró la directiva 'go' en ${goModFile}`);
  }
  const goVersion = versionMatch[1];
  console.log(`Versión requerida: ${goVersion}`);

  const installedVersions = runCommand("g ls");
  if (
    !installedVersions
      .split("\n")
      .some((v) => v.trim().replace("*", "").trim() === goVersion)
  ) {
    console.log(`Instalando Go ${goVersion}...`);
    execSync(`g install ${goVersion}`, { stdio: "inherit" });
  }

  runCommand(`g use ${goVersion}`);
  const homeDir = os.homedir();
  const gHome = path.join(homeDir, ".g");

  // 'g' crea un enlace simbólico en ~/.g/go que apunta a la versión activa
  const goRoot = path.join(gHome, "go");
  const goBin = path.join(goRoot, "bin");

  // Definimos GOPATH (por defecto ~/go)
  const goPath = process.env.GOPATH || path.join(homeDir, "go");
  const goPathBin = path.join(goPath, "bin");

  // Inyectamos las variables al proceso actual de Node
  process.env.GOROOT = goRoot;
  process.env.GOPATH = goPath;

  // Actualizamos el PATH poniendo Go al principio
  process.env.PATH = `${goBin}${path.delimiter}${goPathBin}${path.delimiter}${process.env.PATH}`;

  console.log(`GOROOT actualizado a: ${process.env.GOROOT}`);
  // const gEnvFile = path.join(os.homedir(), ".g", "env");
  // if (!fs.existsSync(gEnvFile)) {
  //   throw new Error(`Archivo ${gEnvFile} no encontrado.`);
  // }

  // const gEnvContent = fs.readFileSync(gEnvFile, "utf8");
  // const goRootMatch = gEnvContent.match(/export GOROOT=(.*)/);

  // if (goRootMatch) {
  //   let newGoRoot = goRootMatch[1].replace(/"/g, "");
  //   const homeDir = os.homedir();

  //   newGoRoot = newGoRoot
  //     .replace(/\${HOME}/g, homeDir)
  //     .replace(/\$HOME/g, homeDir);

  //   process.env.GOROOT = newGoRoot;

  //   const goBin = path.join(newGoRoot, "bin");
  //   const goPathBin = path.join(
  //     process.env.GOPATH || path.join(os.homedir(), "go"),
  //     "bin"
  //   );

  //   process.env.PATH = `${goBin}${path.delimiter}${goPathBin}${path.delimiter}${process.env.PATH}`;
  // }

  console.log("Verificando herramientas de análisis...");
  const [major, minor] = goVersion.split(".").map(Number);
  const isLegacyGo = major < 1 || (major === 1 && minor < 16);
  const tools = [
    {
      name: "halstead",
      url: "github.com/luisantonioig/halstead-metrics/cmd/halstead@latest",
    },
  ];

  tools.forEach((tool) => {
    if (!commandExists(tool.name)) {
      console.log(`Instalando ${tool.name}...`);
      try {
        let installCmd;

        if (isLegacyGo) {
          // Estrategia Legacy (Go < 1.16):
          const legacyUrl = tool.url.split("@")[0];
          console.log(
            `Detectado Go ${goVersion} (< 1.16). Usando método legacy 'go get'...`
          );
          installCmd = `go get ${legacyUrl}`;
        } else {
          installCmd = `go install ${tool.url}`;
        }
        execSync(installCmd, { stdio: "inherit" });
      } catch (e) {
        console.error(`Error instalando ${tool.name}:`, e.message);
      }
    }
  });
  console.log("Entorno Go configurado correctamente.");
  return { success: true, version: goVersion };
}

module.exports = { setupGoEnvironment };
