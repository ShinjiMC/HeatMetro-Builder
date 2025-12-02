const { getProjectMetrics } = require("./sonar.client");
const SONAR_HOST = "https://sonarcloud.io";

const getVal = (measures, key) => {
  const m = measures.find((x) => x.metric === key);
  if (!m || m.value === undefined || m.value === null) return null;
  const val = parseFloat(m.value);
  return isNaN(val) ? null : val;
};

function buildSonarCodeUrl(componentKey, config) {
  const params = `id=${config.projectKey}&branch=${encodeURIComponent(
    config.branch
  )}`;
  const fullKey = componentKey.startsWith(config.projectKey)
    ? componentKey
    : `${config.projectKey}:${componentKey}`;
  return `${SONAR_HOST}/code?${params}&selected=${encodeURIComponent(fullKey)}`;
}

function buildSonarIssuesUrl(componentKey, isFolder, config) {
  const params = `id=${config.projectKey}&branch=${encodeURIComponent(
    config.branch
  )}`;
  if (isFolder) {
    let folderPath = componentKey;
    if (folderPath === "/")
      return `${SONAR_HOST}/project/issues?${params}&resolved=false`;
    if (folderPath.startsWith(`${config.projectKey}:`))
      folderPath = folderPath.replace(`${config.projectKey}:`, "");
    return `${SONAR_HOST}/project/issues?${params}&resolved=false&directories=${encodeURIComponent(
      folderPath
    )}`;
  } else {
    const fullKey = componentKey.startsWith(config.projectKey)
      ? componentKey
      : `${config.projectKey}:${componentKey}`;
    return `${SONAR_HOST}/code?${params}&selected=${encodeURIComponent(
      fullKey
    )}`;
  }
}

async function extractSonarMetrics(config) {
  console.log(`--- Extrayendo métricas para rama: ${config.branch} ---`);
  const rawComponents = await getProjectMetrics(config);
  const filesData = [];
  const foldersData = [];

  rawComponents.forEach((comp) => {
    const isRoot = comp.qualifier === "TRK";
    const path = isRoot ? "/" : comp.path;
    const key = comp.key;
    const ms = comp.measures || [];

    // Valores Crudos
    const rawCoverage = getVal(ms, "coverage");
    // Default a 0 si no hay datos
    const complexity = getVal(ms, "complexity") || 0;
    const violations = getVal(ms, "violations") || 0;
    const ncloc = getVal(ms, "ncloc") || 0;
    const linesToCover = getVal(ms, "lines_to_cover") || 0;

    if (comp.qualifier === "FIL") {
      // Lógica de Coverage para Archivos
      let finalCoverage = 0; // Por defecto 0 (penalización)

      // Detectar Tests
      const isTestFile =
        path.endsWith("_test.go") ||
        path.endsWith(".test.js") ||
        path.endsWith(".spec.js") ||
        path.endsWith(".test.ts") ||
        path.endsWith(".spec.ts");

      if (isTestFile) {
        finalCoverage = -1;
      } else {
        if (rawCoverage !== null) {
          finalCoverage = rawCoverage;
        }
      }

      filesData.push({
        filePath: path,
        complexity: complexity,
        ncloc: ncloc,
        lines_to_cover: linesToCover,
        coverage: {
          percentage: finalCoverage,
          url: buildSonarCodeUrl(key, config),
        },
        lint: {
          numIssues: violations,
          url: buildSonarIssuesUrl(key, false, config),
        },
      });
    } else if (comp.qualifier === "DIR" || isRoot) {
      foldersData.push({
        folderPath: path,
        metrics: {
          total_complexity: complexity,
          total_issues: violations,
          avg_coverage: rawCoverage !== null ? rawCoverage : 0,
        },
        urls: {
          sonar_url: buildSonarCodeUrl(key, config),
          issues_url: buildSonarIssuesUrl(isRoot ? "/" : path, true, config),
        },
      });
    }
  });

  return { filesData, foldersData };
}

module.exports = { extractSonarMetrics };
