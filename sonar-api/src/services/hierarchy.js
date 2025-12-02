// src/services/hierarchy.js
const path = require("path");

function updateHierarchicalData(
  filePath,
  fileMetrics,
  folderMetrics,
  folderHierarchy
) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  let currentPath = path.dirname(normalizedPath);
  let childName = path.basename(normalizedPath);

  if (currentPath === "" || currentPath === null) return;

  // Función auxiliar para inicializar objeto de estadísticas
  const getInitStats = () => ({
    total_issues: 0,
    total_complexity: 0,
    total_churn: 0,
    total_coupling_deps: 0,
    total_loc: 0,
    total_func_count: 0,
    total_method_count: 0,
    total_frequency: 0,
    total_authors: 0,
    total_halstead_volume: 0,
    total_halstead_difficulty: 0,
    total_halstead_effort: 0,
    total_halstead_bugs: 0,
  });

  // Bucle para subir por los directorios padres
  while (currentPath !== "." && currentPath !== "/") {
    const stats = folderMetrics.get(currentPath) || getInitStats();

    // Acumular métricas (Churn, Issues, Halstead, etc.)
    stats.total_issues += fileMetrics.total_issues || 0;
    stats.total_complexity += fileMetrics.total_complexity || 0;
    stats.total_churn += fileMetrics.total_churn || 0;
    stats.total_coupling_deps += fileMetrics.total_coupling_deps || 0;

    // --- MODIFICACIÓN: NO SUMAR ESTRUCTURA (Se tomará directo del Package Layout) ---
    // stats.total_loc += fileMetrics.total_loc || 0;
    // stats.total_func_count += fileMetrics.total_func_count || 0;
    // stats.total_method_count += fileMetrics.total_method_count || 0;
    // -------------------------------------------------------------------------------

    stats.total_frequency += fileMetrics.total_frequency || 0;
    stats.total_authors += fileMetrics.total_authors || 0;
    stats.total_halstead_volume += fileMetrics.total_halstead_volume || 0;
    stats.total_halstead_difficulty +=
      fileMetrics.total_halstead_difficulty || 0;
    stats.total_halstead_effort += fileMetrics.total_halstead_effort || 0;
    stats.total_halstead_bugs += fileMetrics.total_halstead_bugs || 0;

    folderMetrics.set(currentPath, stats);

    // Guardar relación padre-hijo
    const children = folderHierarchy.get(currentPath) || new Set();
    children.add(childName);
    folderHierarchy.set(currentPath, children);

    childName = path.basename(currentPath);
    currentPath = path.dirname(currentPath);
  }

  // Manejo del Root
  if (currentPath === ".") currentPath = "/";

  const stats = folderMetrics.get(currentPath) || getInitStats();

  stats.total_issues += fileMetrics.total_issues || 0;
  stats.total_complexity += fileMetrics.total_complexity || 0;
  stats.total_churn += fileMetrics.total_churn || 0;
  stats.total_coupling_deps += fileMetrics.total_coupling_deps || 0;

  // --- MODIFICACIÓN ROOT: TAMPOCO SUMAMOS AQUÍ ---
  // stats.total_loc += fileMetrics.total_loc || 0;
  // stats.total_func_count += fileMetrics.total_func_count || 0;
  // stats.total_method_count += fileMetrics.total_method_count || 0;
  // -----------------------------------------------

  stats.total_frequency += fileMetrics.total_frequency || 0;
  stats.total_authors += fileMetrics.total_authors || 0;
  stats.total_halstead_volume += fileMetrics.total_halstead_volume || 0;
  stats.total_halstead_difficulty += fileMetrics.total_halstead_difficulty || 0;
  stats.total_halstead_effort += fileMetrics.total_halstead_effort || 0;
  stats.total_halstead_bugs += fileMetrics.total_halstead_bugs || 0;

  folderMetrics.set(currentPath, stats);

  const rootChildren = folderHierarchy.get(currentPath) || new Set();
  rootChildren.add(childName);
  folderHierarchy.set(currentPath, rootChildren);
}

module.exports = { updateHierarchicalData };
