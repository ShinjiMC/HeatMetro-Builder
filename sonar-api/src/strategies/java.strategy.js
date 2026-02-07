// src/strategies/java.strategy.js
const { setupJavaEnvironment } = require("../metrics_java/setup_java");
const { getChurnMetrics } = require("../metrics_java/churn_java");
const { getLayoutMetrics } = require("../metrics_java/layout_java");
const { getHalsteadMetrics } = require("../metrics_java/halstead_java");
const { getCouplingMetrics } = require("../metrics_java/coupling_java");

module.exports = {
  setupEnvironment: async (projectPath) => {
    return await setupJavaEnvironment(projectPath);
  },

  getHalsteadMetrics: async (projectPath, exclusions) => {
    return await getHalsteadMetrics(projectPath, exclusions);
  },

  getCouplingMetrics: async (projectPath, exclusions) => {
    return await getCouplingMetrics(projectPath, exclusions);
  },

  getChurnMetrics: async (projectPath, exclusions) => {
    return await getChurnMetrics(projectPath, exclusions);
  },

  getLayoutMetrics: async (projectPath, exclusions) => {
    return await getLayoutMetrics(projectPath, exclusions);
  },
};
