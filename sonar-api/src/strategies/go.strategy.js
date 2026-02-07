// src/strategies/go.strategy.js

// 1. Importamos tus funciones existentes de métricas para GO
const { setupGoEnvironment } = require("../metrics/setup_go");
const { getHalsteadMetrics } = require("../metrics/halstead");
const { getCouplingMetrics } = require("../metrics/coupling");
const { getLayoutMetrics } = require("../metrics/layout");
const { getChurnMetrics } = require("../metrics/churn");

// 2. Exportamos un objeto con una interfaz ESTÁNDAR
module.exports = {
  // Prepara el entorno (instalar dependencias, compilar si es necesario)
  setupEnvironment: async (projectPath) => {
    return await setupGoEnvironment(projectPath);
  },

  // Calcula Halstead
  getHalsteadMetrics: async (projectPath, exclusions) => {
    return await getHalsteadMetrics(projectPath, exclusions);
  },

  // Calcula Coupling (Fan-in/Fan-out)
  getCouplingMetrics: async (projectPath, exclusions) => {
    return await getCouplingMetrics(projectPath, exclusions);
  },

  // Calcula Churn (Frecuencia de cambios)
  getChurnMetrics: async (projectPath, exclusions) => {
    return await getChurnMetrics(projectPath, exclusions);
  },

  // Calcula el Layout (Estructura visual de la ciudad)
  getLayoutMetrics: async (projectPath, exclusions) => {
    return await getLayoutMetrics(projectPath, exclusions);
  },
};
