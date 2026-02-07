// src/services/analysis.runner.js
const { detectProjectLanguage } = require("../services/select_language");
const {
  processSonarAnalysis,
  getSonarExclusions,
} = require("../metrics/sonar.manager");
require("dotenv").config();

const GoStrategy = require("../strategies/go.strategy");
const JavaStrategy = require("../strategies/java.strategy");

async function runFullAnalysis(projectPath, sonarPropsPath, onProgress) {
  console.log("🚀 Iniciando Análisis Completo en memoria...");
  const results = {};

  const notify = (step) => {
    if (onProgress) onProgress(step);
  };

  try {
    const exclusions = getSonarExclusions(sonarPropsPath);
    console.log("🛡️ Exclusiones globales detectadas:", exclusions);

    const language = detectProjectLanguage(projectPath);
    console.log(`Lenguaje detectado: ${language}`);

    let strategy;
    switch (language) {
      case "GO":
        strategy = GoStrategy;
        break;
      case "JAVA":
        strategy = JavaStrategy;
        break;
      default:
        throw new Error(`Lenguaje no soportado o desconocido: ${language}`);
    }

    await strategy.setupEnvironment(projectPath);

    notify("halstead");
    console.log(`[${language}] Ejecutando Halstead...`);
    results.halstead = await strategy.getHalsteadMetrics(
      projectPath,
      exclusions
    );

    notify("coupling");
    console.log(`[${language}] Ejecutando Coupling...`);
    results.coupling = await strategy.getCouplingMetrics(
      projectPath,
      exclusions
    );

    notify("churn");
    console.log(`[${language}] Ejecutando Churn...`);
    results.churn = await strategy.getChurnMetrics(projectPath, exclusions);

    notify("layout");
    console.log(`[${language}] Ejecutando Layout...`);
    results.layout = await strategy.getLayoutMetrics(projectPath, exclusions);

    notify("sonar"); // Notificar Frontend
    const SONAR_TOKEN = process.env.SONAR_TOKEN;
    console.log("Ejecutando Sonar Analysis...");
    results.sonar = await processSonarAnalysis(
      projectPath,
      SONAR_TOKEN,
      sonarPropsPath,
      language
    );

    console.log("Análisis completado.");
    return results;
  } catch (error) {
    console.error("❌ Error durante el análisis:", error);
    throw error;
  }
}

module.exports = { runFullAnalysis };
