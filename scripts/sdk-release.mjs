import fs from "node:fs";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

export function releaseContext(branch, version) {
  if (!["main", "beta"].includes(branch)) throw new Error("SDK releases must use main or beta");
  const match = /^(\d+\.\d+\.\d+)(?:-beta\.(\d+))?$/.exec(version);
  if (!match) throw new Error(`Unsupported SDK version: ${version}`);
  const beta = branch === "beta";
  if (beta !== Boolean(match[2])) throw new Error("Branch and SDK prerelease version disagree");
  return { channel: beta ? "beta" : "stable", branch, version,
    python_version: beta ? `${match[1]}b${match[2]}` : version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const spec = YAML.parse(fs.readFileSync("openapi-3.0.yaml", "utf8"));
  const context = releaseContext(process.env.GITHUB_REF_NAME, spec.info.version);
  const output = Object.entries(context).map(([key, value]) => `${key}=${value}`).join("\n")+"\n";
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
  else process.stdout.write(output);
}
