import {
  cloneAndSyncRepo,
  getRefs,
  fetchRepoCommits,
} from "./github.service.js";

export async function getAvailableRefs(req, res) {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) return res.status(400).json({ error: "Falta repoUrl." });
    const refs = await getRefs(repoUrl);
    res.json(refs);
  } catch (err) {
    console.error("Error en getAvailableRefs:", err.message);
    res.status(500).json({ error: err.message });
  }
}

export async function getTagCommits(req, res) {
  try {
    const { repoUrl, selectionName } = req.body;
    if (!repoUrl || !selectionName)
      return res.status(400).json({ error: "Faltan repoUrl o selectionName." });

    const mesh = await fetchRepoCommits(repoUrl, selectionName);

    res.json(mesh);
  } catch (err) {
    console.error("Error en getTagMesh:", err.message);
    res.status(500).json({ error: err.message });
  }
}

export async function fetchCommitHistory(req, res) {
  try {
    const { repoUrl, selectionType, selectionName } = req.body;
    if (!repoUrl || !selectionType || !selectionName)
      return res
        .status(400)
        .json({ error: "Faltan repoUrl, selectionType o selectionName." });
    const fullRefName = `refs/${selectionType}/${selectionName}`;
    const commits = await fetchRepoCommits(repoUrl, fullRefName);
    cloneAndSyncRepo(repoUrl, commits).catch((err) =>
      console.error("Error en clonado background:", err.message)
    );
    res.json({ commits });
  } catch (err) {
    console.error("Error en fetchCommitHistory:", err.message);
    res.status(500).json({ error: err.message });
  }
}

export async function syncRepository(req, res) {
  try {
    const { repoUrl, commits } = req.body;
    if (!repoUrl || !commits || !Array.isArray(commits))
      return res
        .status(400)
        .json({ error: "Faltan repoUrl o la lista de commits." });
    const repoPath = await cloneAndSyncRepo(repoUrl, commits);
    if (repoPath) {
      res.json({
        status: true,
        message: "Repositorio sincronizado correctamente",
        path: repoPath,
      });
    } else {
      res.status(500).json({
        status: false,
        error: "Falló la sincronización del repositorio",
      });
    }
  } catch (err) {
    console.error("Error en syncRepository:", err.message);
    res.status(500).json({ error: err.message });
  }
}
