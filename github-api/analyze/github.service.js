import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
dotenv.config();

const GITHUB_API = "https://api.github.com/graphql";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CLONES_DIR = process.env.CLONES_DIR || "./.clones";

if (!GITHUB_TOKEN) {
  console.error("No se encontró GITHUB_TOKEN en variables de entorno.");
  process.exit(1);
}

function parseRepoUrl(repoUrl) {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) throw new Error("URL de repositorio no válida.");
  return { owner: match[1], repo: match[2] };
}

async function graphqlRequest(query, variables = {}) {
  const resp = await fetch(GITHUB_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "User-Agent": "CommitMeshBot/1.1",
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await resp.json();
  if (!resp.ok || data.errors) {
    console.error(
      "GraphQL error:",
      JSON.stringify(data.errors || data, null, 2)
    );
    throw new Error("GraphQL query failed");
  }
  return data.data;
}

export async function getRefs(repoUrl) {
  const { owner, repo } = parseRepoUrl(repoUrl);
  console.log(`Buscando todas las ramas y tags para ${owner}/${repo}...`);
  const defaultBranchQuery = `
    query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        defaultBranchRef {
          name
        }
      }
    }
  `;
  const defaultBranchData = await graphqlRequest(defaultBranchQuery, {
    owner,
    repo,
  });
  const defaultBranchName = defaultBranchData.repository.defaultBranchRef?.name;
  const branchesQuery = `
    query($owner: String!, $repo: String!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        branches: refs(
          refPrefix: "refs/heads/",
          first: 100,
          after: $cursor
        ) {
          pageInfo { hasNextPage endCursor }
          nodes {
            name
            target {
              ... on Commit {
                committedDate
              }
            }
          }
        }
      }
    }
  `;
  let branchCursor = null;
  let hasNextPageBranches = true;
  const allBranches = [];
  console.log("Buscando ramas...");
  while (hasNextPageBranches) {
    const data = await graphqlRequest(branchesQuery, {
      owner,
      repo,
      cursor: branchCursor,
    });
    const branchesData = data.repository.branches;
    branchesData.nodes.forEach((node) => {
      allBranches.push({
        name: node.name,
        date: node.target?.committedDate
          ? new Date(node.target.committedDate)
          : new Date(0),
      });
    });

    hasNextPageBranches = branchesData.pageInfo.hasNextPage;
    branchCursor = branchesData.pageInfo.endCursor;
  }
  allBranches.sort((a, b) => {
    if (a.name === defaultBranchName) return -1;
    if (b.name === defaultBranchName) return 1;
    return b.date - a.date;
  });
  const sortedBranchNames = allBranches.map((branch) => branch.name);
  const tagsQuery = `
    query($owner: String!, $repo: String!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        tags: refs(
          refPrefix: "refs/tags/",
          first: 100,
          after: $cursor,
          orderBy: { field: TAG_COMMIT_DATE, direction: DESC }
        ) {
          pageInfo { hasNextPage endCursor }
          nodes {
            name
          }
        }
      }
    }
  `;
  let tagCursor = null;
  let hasNextPageTags = true;
  const sortedTagNames = [];
  console.log("Buscando tags...");
  while (hasNextPageTags) {
    const data = await graphqlRequest(tagsQuery, {
      owner,
      repo,
      cursor: tagCursor,
    });
    const tagsData = data.repository.tags;
    tagsData.nodes.forEach((node) => {
      sortedTagNames.push(node.name);
    });
    hasNextPageTags = tagsData.pageInfo.hasNextPage;
    tagCursor = tagsData.pageInfo.endCursor;
  }
  console.log(
    `Encontrados ${sortedBranchNames.length} branches y ${sortedTagNames.length} tags.`
  );
  return { branches: sortedBranchNames, tags: sortedTagNames };
}

export async function fetchRepoCommits(repoUrl, refName) {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const qualifiedRef = refName.replace("refs/branches/", "refs/heads/");
  console.log(`Buscando commit base para: ${qualifiedRef}...`);

  const rootQuery = `
  query($owner: String!, $repo: String!, $ref: String!) {
    repository(owner: $owner, name: $repo) {
      ref(qualifiedName: $ref) {
        target {
          ... on Commit { oid committedDate messageHeadline }
          ... on Tag { target { ... on Commit { oid committedDate messageHeadline } } }
        }
      }
    }
  }
  `;

  const rootData = await graphqlRequest(rootQuery, {
    owner,
    repo,
    ref: qualifiedRef,
  });

  const rootTarget =
    rootData.repository?.ref?.target?.target ||
    rootData.repository?.ref?.target;

  if (!rootTarget?.oid) {
    throw new Error(`No se pudo encontrar la referencia: ${qualifiedRef}`);
  }

  const rootCommitSha = rootTarget.oid;
  const rootMessage = rootTarget.messageHeadline || qualifiedRef;

  const commitsQuery = `
  query($owner: String!, $repo: String!, $sha: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      object(expression: $sha) {
        ... on Commit {
          history(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { 
              oid 
              committedDate 
              messageHeadline 
              author { name } 
            }
          }
        }
      }
    }
  }
  `;

  let hasNextPage = true;
  let endCursor = null;
  const allCommits = [];
  const MAX_COMMITS = 250;

  console.log(
    `Extrayendo historial de ${qualifiedRef} (Límite: ${MAX_COMMITS})...`
  );

  while (hasNextPage && allCommits.length < MAX_COMMITS) {
    const data = await graphqlRequest(commitsQuery, {
      owner,
      repo,
      sha: rootCommitSha,
      cursor: endCursor,
    });

    const history = data.repository?.object?.history;
    const nodes = history?.nodes || [];

    for (const node of nodes) {
      if (allCommits.length >= MAX_COMMITS) break;
      allCommits.push(node);
    }

    if (allCommits.length >= MAX_COMMITS) {
      hasNextPage = false;
    } else {
      hasNextPage = history?.pageInfo?.hasNextPage;
      endCursor = history?.pageInfo?.endCursor;
    }

    console.log(`${allCommits.length} commits acumulados...`);
  }
  const results = allCommits.map((c) => ({
    sha: c.oid,
    date: c.committedDate,
    commit: c.messageHeadline || null,
    author: c.author?.name || "Unknown",
  }));
  if (results.length > 0) {
    results[0].commit = rootMessage;
  }

  //save in json results in this path .
  fs.writeFileSync(
    path.join(".", `${owner}_${repo}_commits.json`),
    JSON.stringify(results, null, 2)
  );

  return results;
}

export async function cloneAndSyncRepo(repoUrl, commits = []) {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const repoDir = path.join(CLONES_DIR, `${owner}_${repo}`);
  const git = simpleGit();
  const validGitUrl = `https://github.com/${owner}/${repo}.git`;
  if (!fs.existsSync(CLONES_DIR)) fs.mkdirSync(CLONES_DIR);
  try {
    if (!fs.existsSync(repoDir)) {
      console.log(`[Background] Clonando repo base (Shallow): ${validGitUrl}`);
      await git.clone(validGitUrl, repoDir, ["--depth", "1"]);
    } else {
      console.log(`[Background] Repo detectado en ${repoDir}`);
    }
    if (commits.length > 0) {
      console.log(
        `[Background] Descargando ${commits.length} commits específicos...`
      );
      const shas = commits.map((c) => c.sha);
      await git.cwd(repoDir).raw(["fetch", "origin", ...shas]);
      console.log(
        `[Background] Sincronización completada para ${owner}/${repo}`
      );
    } else {
      console.log(`[Background] No se recibieron commits para sincronizar.`);
    }
    return repoDir;
  } catch (err) {
    console.error("Error clonando/sincronizando:", err.message);
    return null;
  }
}
