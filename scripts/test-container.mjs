import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const secrets = ["ci-access-token-never-real", "ci-user-never-real", "ci-password-never-real"];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30_000, ...options });
  if (result.error) throw result.error;
  return result;
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit ${result.status}: ${result.stderr.trim()}`);
  }
}

function parseImage(args) {
  let image;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--image") image = args[++index];
    else if (args[index].startsWith("--image=")) image = args[index].slice("--image=".length);
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!image) throw new Error("Usage: npm run test:container -- --image IMAGE");
  return image;
}

function assertNoSecrets(value, label) {
  for (const secret of secrets) {
    if (value.includes(secret)) throw new Error(`${label} contains a fixture secret`);
  }
}

async function imageChecks(image) {
  const inspect = run("docker", ["image", "inspect", image, "--format", "{{.Config.User}} {{json .Config.Entrypoint}} {{json .Config.Env}}"]);
  requireSuccess(inspect, "docker image inspect");
  const [user, entrypoint, ...env] = inspect.stdout.trim().split(" ");
  if (user !== "node") throw new Error(`Image user is ${user || "unset"}, expected node`);
  if (entrypoint !== '["node","src/index.js"]') throw new Error(`Unexpected image entrypoint: ${entrypoint}`);
  assertNoSecrets(env.join(" "), "Image environment");
  if (env.join(" ").includes("ACCESS_TOKEN") || env.join(" ").includes("PASSWORD")) {
    throw new Error("Image configuration declares credential environment values");
  }

  const contents = run("docker", ["run", "--rm", "--network", "none", "--entrypoint", "node", image,
    "-e", "const fs=require('node:fs'); const base='/app'; const required=['package.json','package-lock.json','src/index.js']; const forbidden=['config.json','.env','.env.local','test','docs','.git']; for(const p of required) if(!fs.existsSync(base+'/'+p)) process.exit(2); for(const p of forbidden) if(fs.existsSync(base+'/'+p)) process.exit(3); process.stdout.write(String(process.getuid()))"]);
  requireSuccess(contents, "Image content inspection");
  if (contents.stdout.trim() !== "1000") throw new Error(`Image process UID is ${contents.stdout.trim()}, expected non-root UID 1000`);

  const history = run("docker", ["history", "--no-trunc", "--format", "{{.CreatedBy}}", image]);
  requireSuccess(history, "docker history");
  assertNoSecrets(history.stdout, "Image history");
  if (/ENV\s+(?:ACCESS_TOKEN|NETATMO_USERNAME|NETATMO_PASSWORD|REFRESH_TOKEN)\b/i.test(history.stdout)) {
    throw new Error("Image history contains a credential ENV instruction");
  }
}

async function waitForDryRun(container) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const logs = run("docker", ["logs", container]);
    const output = `${logs.stdout}${logs.stderr}`;
    assertNoSecrets(output, "Container logs");
    if (output.includes('"event":"sync.mapping.dry_run"')) return;
    const state = run("docker", ["inspect", container, "--format", "{{.State.Status}} {{.State.ExitCode}}"]);
    if (state.status === 0 && state.stdout.trim().startsWith("exited ")) {
      throw new Error(`Valid fixture container exited early: ${state.stdout.trim()} ${output}`);
    }
    await delay(200);
  }
  throw new Error("Container did not complete a fixture-backed dry-run cycle within 15 seconds");
}

async function signalCheck(image, fixtureDir, signal) {
  const name = `netatmo-ci-${process.pid}-${signal.toLowerCase()}`;
  const start = run("docker", ["run", "--detach", "--name", name, "--network", "none",
    "--mount", `type=bind,src=${fixtureDir},dst=/fixtures,readonly`,
    "--env", "CONFIG_FILE=/fixtures/config.json", "--env", "DRY_RUN=true",
    "--env", `ACCESS_TOKEN=${secrets[0]}`, "--env", `NETATMO_USERNAME=${secrets[1]}`, "--env", `NETATMO_PASSWORD=${secrets[2]}`,
    "--env", "NODE_OPTIONS=--import=/fixtures/mock-http.mjs", image]);
  requireSuccess(start, `Start ${signal} fixture container`);
  try {
    await waitForDryRun(name);
    const kill = run("docker", ["kill", "--signal", signal, name]);
    requireSuccess(kill, `Send ${signal}`);
    const wait = run("docker", ["wait", name]);
    requireSuccess(wait, `Wait after ${signal}`);
    if (wait.stdout.trim() !== "0") throw new Error(`Container exited ${wait.stdout.trim()} after ${signal}`);
    const logs = run("docker", ["logs", name]);
    assertNoSecrets(`${logs.stdout}${logs.stderr}`, "Container logs");
  } finally {
    run("docker", ["rm", "--force", name]);
  }
}

async function main() {
  const image = parseImage(process.argv.slice(2));
  const root = resolve(import.meta.dirname, "..");
  const fixtureDir = await mkdtemp(join(tmpdir(), "netatmo-container-fixtures-"));
  try {
    await chmod(fixtureDir, 0o755);
    await Promise.all([
      writeFile(join(fixtureDir, "config.json"), await readFile(join(root, "test/fixtures-container/config.json"))),
      writeFile(join(fixtureDir, "mock-http.mjs"), await readFile(join(root, "test/fixtures-container/mock-http.mjs")))
    ]);

    await imageChecks(image);

    const invalid = run("docker", ["run", "--rm", "--network", "none", "--env", `ACCESS_TOKEN=${secrets[0]}`,
      "--env", `NETATMO_USERNAME=${secrets[1]}`, "--env", `NETATMO_PASSWORD=${secrets[2]}`, image]);
    if (invalid.status === 0) throw new Error("Invalid configuration unexpectedly started successfully");
    assertNoSecrets(`${invalid.stdout}${invalid.stderr}`, "Invalid-startup output");
    if (!`${invalid.stdout}${invalid.stderr}`.includes('"event":"startup_failed"')) {
      throw new Error("Invalid startup did not emit the expected fixed diagnostic");
    }

    await signalCheck(image, fixtureDir, "SIGTERM");
    await signalCheck(image, fixtureDir, "SIGINT");
    process.stdout.write(`Container smoke passed for ${image}: non-root, image contents/history, invalid config, fixture dry-run, SIGTERM and SIGINT.\n`);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
