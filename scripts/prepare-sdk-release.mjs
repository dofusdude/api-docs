import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { releaseContext } from "./sdk-release.mjs";

export function prepareSDK(directory, context) {
  const workflows = path.join(directory, ".github", "workflows");
  if (fs.existsSync(workflows)) for (const name of fs.readdirSync(workflows)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const filename = path.join(workflows, name);
    const workflow = YAML.parse(fs.readFileSync(filename, "utf8"));
    for (const event of ["push", "pull_request"]) {
      if (workflow.on?.[event]?.branches) workflow.on[event].branches = ["main", "beta"];
    }
    if (workflow.on?.release) workflow.on.release.types = ["published"];
    for (const job of Object.values(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith("actions/setup-python@")) {
          step.uses = "actions/setup-python@v5";
          step.with ??= {};
          step.with["python-version"] = "3.12";
        }
      }
      if (job.strategy?.matrix?.["node-version"]) {
        for (const step of job.steps ?? []) {
          if (step.uses?.startsWith("actions/setup-node@")) {
            step.with ??= {};
            step.with["node-version"] = "${{ matrix.node-version }}";
          }
        }
      }
      for (const step of [...(job.steps ?? [])]) {
        if (step.run?.trim() === "npm publish") {
          const index = job.steps.indexOf(step);
          job.steps.splice(index, 0, {
            name: "Check release channel",
            env: { RELEASE_PRERELEASE: "${{ github.event.release.prerelease }}" },
            run: `node -e 'const beta = require("./package.json").version.includes("-"); if (beta !== (process.env.RELEASE_PRERELEASE === "true")) throw Error("Package version and GitHub release channel disagree")'`
          });
          step.run = 'npm publish --tag "${{ github.event.release.prerelease && \'beta\' || \'latest\' }}"';
        }
      }
    }
    fs.writeFileSync(filename, YAML.stringify(workflow));
  }
  const metadata = { version: context.version, channel: context.channel, api_major_version: 1, query_operations: false };
  fs.writeFileSync(path.join(directory, "sdk-release.json"), JSON.stringify(metadata, null, 2)+"\n");
  if (context.channel === "beta") {
    const readme = path.join(directory, "README.md");
    const notice = `> Beta SDK ${context.version}. This SDK provides GET operations only. HTTP QUERY is available in the API and full OpenAPI 3.2 documentation, but is not included in this generated SDK.\n\n`;
    const body = fs.existsSync(readme) ? fs.readFileSync(readme, "utf8") : "";
    fs.writeFileSync(readme, notice+body);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2];
  if (!directory || !fs.statSync(directory).isDirectory()) throw new Error("SDK output directory required");
  prepareSDK(directory, releaseContext(process.env.SDK_BRANCH, process.env.SDK_VERSION));
}
