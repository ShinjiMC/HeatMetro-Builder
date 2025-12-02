// src/services/analysis.runner.js
const { setupGoEnvironment } = require("../metrics/setup_go");
const { getHalsteadMetrics } = require("../metrics/halstead");
const { getCouplingMetrics } = require("../metrics/coupling");
const { getLayoutMetrics } = require("../metrics/layout");
const { getChurnMetrics } = require("../metrics/churn");
const { processSonarAnalysis } = require("../metrics/sonar.manager");
require("dotenv").config();

async function runFullAnalysis(projectPath, sonarPropsPath, onProgress) {
  console.log("🚀 Iniciando Análisis Completo en memoria...");
  const results = {};

  const notify = (step) => {
    if (onProgress) onProgress(step);
  };

  try {
    await setupGoEnvironment(projectPath);
    notify("halstead"); // Notificar Frontend
    console.log("Ejecutando Halstead...");
    results.halstead = await getHalsteadMetrics(projectPath);

    notify("coupling"); // Notificar Frontend
    console.log("Ejecutando Coupling...");
    results.coupling = await getCouplingMetrics(projectPath);

    notify("churn"); // Notificar Frontend
    console.log("Ejecutando Churn...");
    results.churn = await getChurnMetrics(projectPath);

    notify("layout"); // Notificar Frontend
    console.log("Ejecutando Layout...");
    results.layout = await getLayoutMetrics(projectPath);

    notify("sonar"); // Notificar Frontend
    const SONAR_TOKEN = process.env.SONAR_TOKEN;
    console.log("Ejecutando Sonar Analysis...");
    results.sonar = await processSonarAnalysis(
      projectPath,
      SONAR_TOKEN,
      sonarPropsPath
    );

    console.log("Análisis completado.");
    return results;
  } catch (error) {
    console.error("❌ Error durante el análisis:", error);
    throw error;
  }
}

module.exports = { runFullAnalysis };
