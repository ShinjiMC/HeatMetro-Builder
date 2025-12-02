// server.js
const express = require("express");
const cors = require("cors");
const multer = require("multer"); // Para subir el archivo properties
const fs = require("fs");
const path = require("path");

// Servicios
const { runFullAnalysis } = require("./src/services/analysis.runner");
const {
  processAndSaveMetrics,
  isCommitAnalyzed,
} = require("./src/services/storage.service");
const { checkoutRepo, hasCodeChanges } = require("./src/services/git.service");
const {
  initDb,
  closeDb,
  getDb,
  validateDbFile,
  DB_FILE,
} = require("./src/services/database");

// Configuración
const app = express();
const PORT = 3001;
const BASE_CLONES_PATH =
  process.env.CLONES_PATH || path.join(__dirname, "../gh");

app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

initDb();

app.get("/download-db", (req, res) => {
  const dbPath = path.resolve(DB_FILE);
  if (fs.existsSync(dbPath)) {
    console.log("Descargando base de datos...");
    try {
      getDb().pragma("wal_checkpoint(RESTART)");
    } catch (e) {
      console.warn(
        "No se pudo hacer checkpoint antes de descargar:",
        e.message
      );
    }
    res.download(dbPath, "repositories.db");
  } else {
    res.status(404).send("Base de datos no encontrada.");
  }
});

app.post("/import-db", upload.single("databaseFile"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se subió ningún archivo." });
  }
  const tempPath = path.resolve(req.file.path);
  const targetPath = path.resolve(DB_FILE);
  console.log(
    `Intento de importar base de datos desde: ${req.file.originalname}`
  );
  const isValid = validateDbFile(tempPath);
  if (!isValid) {
    console.error(
      "El archivo subido no es una base de datos válida o tiene un esquema incorrecto."
    );
    fs.unlinkSync(tempPath);
    return res
      .status(400)
      .json({ error: "Archivo inválido o esquema incompatible." });
  }
  try {
    closeDb();
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    fs.copyFileSync(tempPath, targetPath);
    fs.unlinkSync(tempPath);
    const walFile = `${targetPath}-wal`;
    const shmFile = `${targetPath}-shm`;
    if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
    if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);
    console.log("Archivo de base de datos reemplazado exitosamente.");
    initDb();
    res.json({ message: "Base de datos importada y cargada correctamente." });
  } catch (error) {
    console.error("Error crítico importando DB:", error);
    try {
      initDb();
    } catch (e) {}
    res
      .status(500)
      .json({ error: "Error interno al reemplazar la base de datos." });
  }
});

app.post("/analyze", upload.single("sonarProperties"), async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { repoPath, commitData } = req.body;
    const parsedCommitData = JSON.parse(commitData); // { sha, author, date, message }
    if (!req.file) {
      sendEvent({ error: "Falta el archivo sonar-project.properties" });
      return res.end();
    }
    const sonarPropsPath = path.resolve(req.file.path);
    const repoFolderName = path.basename(repoPath);
    const fullRepoPath = path.join(BASE_CLONES_PATH, repoFolderName);
    console.log(`\n--- Nueva Petición de Análisis ---`);
    console.log(`Repo: ${repoPath}`);
    console.log(`Ruta absoluta a usar: ${fullRepoPath}`);
    console.log(`Commit: ${parsedCommitData.sha}`);
    if (!fs.existsSync(fullRepoPath)) {
      console.error(`El directorio no existe: ${fullRepoPath}`);
    }

    const alreadyAnalyzed = await isCommitAnalyzed(parsedCommitData.sha);
    if (alreadyAnalyzed) {
      console.log(
        "Commit ya analizado previamente. Retornando resultado inmediato."
      );
      sendEvent({
        status: "completed",
        message: "Recuperado de base de datos (Ya analizado).",
      });
      return res.end();
    }

    sendEvent({ status: "checkout", message: "Preparando código..." });
    checkoutRepo(fullRepoPath, parsedCommitData.sha);
    sendEvent({
      status: "validating",
      message: "Verificando cambios en código...",
    });
    const shouldAnalyze = hasCodeChanges(fullRepoPath, parsedCommitData.sha);
    if (!shouldAnalyze) {
      console.log("Saltando análisis: No hubo cambios en .go, .ts, .js, .mod");
      sendEvent({
        status: "skipped",
        message: "Análisis omitido: No hay cambios en archivos de código.",
      });
      return res.end();
    }

    const analysisResults = await runFullAnalysis(
      fullRepoPath,
      sonarPropsPath,
      (stepName) => {
        sendEvent({ status: "progress", step: stepName });
      }
    );

    sendEvent({ status: "progress", step: "saving data" });
    const gitInfo = {
      sha: parsedCommitData.sha,
      author: parsedCommitData.author,
      date: parsedCommitData.date,
      message: parsedCommitData.commit,
    };

    await processAndSaveMetrics(gitInfo, analysisResults);

    sendEvent({
      status: "completed",
      message: "Análisis finalizado y guardado.",
    });

    fs.unlinkSync(sonarPropsPath);
  } catch (error) {
    console.error("Error en endpoint /analyze:", error);
    sendEvent({ status: "error", message: error.message });
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Servidor de análisis corriendo en http://localhost:${PORT}`);
});
