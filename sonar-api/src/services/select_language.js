// Agrega esto a git.service.js
const fs = require("fs");
const path = require("path");

function detectProjectLanguage(repoPath) {
  if (
    fs.existsSync(path.join(repoPath, "pom.xml")) ||
    fs.existsSync(path.join(repoPath, "build.gradle"))
  ) {
    return "JAVA";
  }
  if (fs.existsSync(path.join(repoPath, "go.mod"))) {
    return "GO";
  }
  return "UNKNOWN";
}

module.exports = { detectProjectLanguage };
