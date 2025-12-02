const axios = require("axios");

const SONAR_HOST = "https://sonarcloud.io";
const METRICS = [
  "complexity",
  "violations",
  "coverage",
  "ncloc",
  "lines_to_cover",
].join(",");

/**
 * Obtiene el último análisis.
 * @param {Object} config - { projectKey, branch, token }
 */
async function getLastAnalysis(config) {
  const authConfig = { auth: { username: config.token, password: "" } };
  const params = { project: config.projectKey, ps: 1 };
  if (config.branch) params.branch = config.branch;

  try {
    const response = await axios.get(
      `${SONAR_HOST}/api/project_analyses/search`,
      {
        ...authConfig,
        params,
      }
    );
    const analyses = response.data.analyses;
    if (!analyses || analyses.length === 0) return null;
    const last = analyses[0];
    return { sha: last.revision || `analysis-${last.key}`, date: last.date };
  } catch (error) {
    if (error.response && error.response.status === 404) return null;
    console.error("Error API Sonar (Análisis):", error.message);
    throw error;
  }
}

/**
 * Obtiene las métricas del proyecto (Incluyendo la raíz).
 * @param {Object} config - { projectKey, branch, token }
 */
async function getProjectMetrics(config) {
  const authConfig = { auth: { username: config.token, password: "" } };
  const params = {
    component: config.projectKey,
    metricKeys: METRICS,
    qualifiers: "FIL,DIR,TRK",
    ps: 500,
    p: 1,
    strategy: "all",
  };
  if (config.branch) params.branch = config.branch;

  try {
    const response = await axios.get(
      `${SONAR_HOST}/api/measures/component_tree`,
      {
        ...authConfig,
        params,
      }
    );
    const baseComponent = response.data.baseComponent;
    const components = response.data.components || [];
    return baseComponent ? [baseComponent, ...components] : components;
  } catch (error) {
    console.error("Error API Sonar (Métricas):", error.message);
    throw error;
  }
}

/**
 * Verifica si una rama existe en SonarCloud
 */
async function checkBranchExists(config) {
  const authConfig = { auth: { username: config.token, password: "" } };
  try {
    const response = await axios.get(
      `${SONAR_HOST}/api/project_branches/list`,
      {
        ...authConfig,
        params: { project: config.projectKey },
      }
    );
    const branches = response.data.branches || [];
    return branches.some((b) => b.name === config.branch);
  } catch (error) {
    if (error.response && error.response.status === 404) return false;
    return false;
  }
}

module.exports = { getLastAnalysis, getProjectMetrics, checkBranchExists };
