const { execSync } = require("child_process");

function getGitInfo(projectPath) {
  try {
    const options = { cwd: projectPath, encoding: "utf8" };
    const sha = execSync("git rev-parse HEAD", options).trim();
    const author = execSync("git log -1 --pretty=format:'%an'", options).trim();
    const date = execSync("git log -1 --format=%cd --date=iso", options).trim();
    const message = execSync("git log -1 --pretty=format:'%s'", options).trim();
    return { sha, author, date, message };
  } catch (error) {
    console.error("Error obteniendo datos de git:", error.message);
    return {
      sha: `unknown-${Date.now()}`,
      author: "Unknown",
      date: new Date().toISOString(),
      message: "No git info available",
    };
  }
}

function checkoutRepo(repoPath, sha) {
  try {
    console.log(`Checking out commit ${sha} en ${repoPath}...`);
    // Forzamos el checkout al SHA específico
    execSync(`git checkout -f ${sha}`, { cwd: repoPath, stdio: "ignore" });
    return true;
  } catch (error) {
    console.error("Error haciendo checkout:", error.message);
    throw new Error(`No se pudo hacer checkout al commit ${sha}`);
  }
}

function hasCodeChanges(repoPath, sha) {
  try {
    console.log(`Verificando extensiones de archivos en commit ${sha}...`);
    const cmd = `git show --name-only --format="" ${sha}`;
    const output = execSync(cmd, { cwd: repoPath, encoding: "utf8" });
    const changedFiles = output
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const codeExtensions = [
      ".go",
      ".ts",
      ".js",
      ".java",
      ".py",
      ".rb",
      ".cpp",
      ".c",
      ".cs",
    ];
    const hasCode = changedFiles.some((file) =>
      codeExtensions.some((ext) => file.endsWith(ext))
    );

    if (hasCode) {
      console.log("Se detectaron cambios en código.");
    } else {
      console.log("Solo cambios irrelevantes (docs, assets, etc).");
    }

    return hasCode;
  } catch (error) {
    console.warn(
      "Error verificando cambios (posiblemente primer commit). Asumiendo TRUE."
    );
    return true;
  }
}

module.exports = { getGitInfo, checkoutRepo, hasCodeChanges };
