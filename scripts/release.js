#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const NON_NPM_MESSAGE =
  "当前目录未检测到可用的 npm 项目，压缩发版 / 留痕发版 仅适用于基于 package.json 的 Node 项目。";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      fail(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${key}`);
    }

    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

function run(command, args, options = {}) {
  const shell = process.platform === "win32" && command === "npm";
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    ...(shell ? { shell: true } : {}),
  });

  if (result.error) {
    fail(`Command failed to start: ${command} ${args.join(" ")}\n${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    const details = stderr || stdout || `exit code ${result.status}`;
    fail(`${options.label || `${command} ${args.join(" ")}`} failed: ${details}`);
  }

  return (result.stdout || "").trim();
}

function runAllowFailure(command, args, options = {}) {
  const shell = process.platform === "win32" && command === "npm";
  return spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    ...(shell ? { shell: true } : {}),
  });
}

function readPackageJson(cwd) {
  const packagePath = path.join(cwd, "package.json");
  if (!fs.existsSync(packagePath)) {
    fail(NON_NPM_MESSAGE);
  }

  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    fail(NON_NPM_MESSAGE);
  }
}

function ensureNpmAvailable(cwd) {
  const result = runAllowFailure("npm", ["--version"], { cwd });
  if (result.error || result.status !== 0) {
    fail(NON_NPM_MESSAGE);
  }
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    fail(`Unsupported version format in package.json: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function bumpVersion(version, level) {
  const parsed = parseVersion(version);
  if (level === "patch") {
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
  if (level === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  if (level === "major") {
    return `${parsed.major + 1}.0.0`;
  }

  fail(`Unsupported release level: ${level}`);
}

function ensureGitRepo(cwd) {
  run("git", ["rev-parse", "--show-toplevel"], { cwd, label: "git repo check" });
}

function ensureCleanTree(cwd) {
  const status = run("git", ["status", "--porcelain"], { cwd });
  if (status) {
    fail("工作区不干净，请先提交、暂存或清理本地改动后再发版。");
  }
}

function getCurrentBranch(cwd) {
  const branch = run("git", ["branch", "--show-current"], { cwd });
  if (!branch) {
    fail("无法识别当前分支，发版已中止。");
  }
  return branch;
}

function getUpstream(cwd) {
  const result = runAllowFailure(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { cwd },
  );

  if (result.error || result.status !== 0) {
    fail("当前分支未设置 upstream，无法执行发版。请先设置上游分支。");
  }

  const upstream = (result.stdout || "").trim();
  if (!upstream.includes("/")) {
    fail("无法解析当前分支的 upstream，发版已中止。");
  }

  const slashIndex = upstream.indexOf("/");
  return {
    full: upstream,
    remote: upstream.slice(0, slashIndex),
    branch: upstream.slice(slashIndex + 1),
  };
}

function ensureSyncedWithUpstream(cwd) {
  const ahead = Number(run("git", ["rev-list", "--count", "@{upstream}..HEAD"], { cwd }));
  const behind = Number(run("git", ["rev-list", "--count", "HEAD..@{upstream}"], { cwd }));
  return { ahead, behind };
}

function ensureNoTagConflict(cwd, remote, tagName) {
  const local = runAllowFailure("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tagName}`], {
    cwd,
  });
  if (local.status === 0) {
    fail(`本地已存在 tag ${tagName}，发版已中止。`);
  }

  const remoteTag = run("git", ["ls-remote", "--tags", remote, `refs/tags/${tagName}`], {
    cwd,
    label: "remote tag check",
  });
  if (remoteTag) {
    fail(`远端已存在 tag ${tagName}，发版已中止。`);
  }
}

function readVersionFromPackage(cwd) {
  const pkg = readPackageJson(cwd);
  if (!pkg.version) {
    fail("package.json 缺少 version 字段，无法发版。");
  }
  return pkg.version;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const mode = args.mode;
  const level = args.level;
  const description = args.description;

  if (!mode || !["compress", "track"].includes(mode)) {
    fail("Missing or invalid --mode. Use compress or track.");
  }
  if (!level || !["patch", "minor", "major"].includes(level)) {
    fail("Missing or invalid --level. Use patch, minor, or major.");
  }
  if (!description) {
    fail("Missing --description.");
  }

  readPackageJson(cwd);
  ensureNpmAvailable(cwd);
  ensureGitRepo(cwd);
  ensureCleanTree(cwd);

  const branch = getCurrentBranch(cwd);
  const upstream = getUpstream(cwd);

  run("git", ["fetch", upstream.remote, "--tags"], {
    cwd,
    label: `git fetch ${upstream.remote} --tags`,
  });

  const sync = ensureSyncedWithUpstream(cwd);
  if (sync.behind > 0) {
    fail(`当前分支落后 upstream ${sync.behind} 个提交，请先同步后再发版。`);
  }
  if (mode === "compress" && sync.ahead < 1) {
    fail("压缩发版要求当前分支至少领先 upstream 1 个提交。");
  }

  const currentVersion = readVersionFromPackage(cwd);
  const nextVersion = bumpVersion(currentVersion, level);
  const tagName = `v${nextVersion}`;
  ensureNoTagConflict(cwd, upstream.remote, tagName);

  if (mode === "compress") {
    run("git", ["reset", "--soft", "@{upstream}"], {
      cwd,
      label: "git reset --soft @{upstream}",
    });
    run("npm", ["version", level, "--no-git-tag-version"], {
      cwd,
      label: `npm version ${level} --no-git-tag-version`,
    });
    run("git", ["add", "."], { cwd, label: "git add ." });
    run("git", ["commit", "-m", `Release v${nextVersion}: ${description}`], {
      cwd,
      label: "git commit",
    });
    run("git", ["tag", "-a", tagName, "-m", `Release ${tagName}: ${description}`], { cwd, label: `git tag -a ${tagName}` });
  } else {
    run("npm", ["version", level, "-m", `Release v%s: ${description}`], {
      cwd,
      label: `npm version ${level}`,
    });
  }

  const tagType = run("git", ["cat-file", "-t", tagName], { cwd });
  if (tagType !== "tag") {
    fail(`Tag verification failed: ${tagName} is ${tagType}, expected tag.`);
  }

  run("git", ["push", upstream.remote, branch, "--follow-tags"], {
    cwd,
    label: `git push ${upstream.remote} ${branch} --follow-tags`,
  });

  const releaseCommit = run("git", ["rev-parse", "HEAD"], { cwd });
  const finalVersion = readVersionFromPackage(cwd);

  console.log(`MODE=${mode}`);
  console.log(`LEVEL=${level}`);
  console.log(`VERSION=${finalVersion}`);
  console.log(`REMOTE=${upstream.remote}`);
  console.log(`BRANCH=${branch}`);
  console.log(`COMMIT=${releaseCommit}`);
  console.log(`TAG=v${finalVersion}`);
  console.log(`TAG_TYPE=${tagType}`);
  console.log(`TAG_PUSHED_VERIFIED=true`);
}

main();
