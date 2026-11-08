import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { releaseContext } from "./sdk-release.mjs";
import { prepareSDK } from "./prepare-sdk-release.mjs";

test("stable and beta versions are isolated", () => {
  assert.equal(releaseContext("main", "1.1.0").channel, "stable");
  assert.deepEqual(releaseContext("beta", "1.1.0-beta.2"), { channel: "beta", branch: "beta", version: "1.1.0-beta.2", python_version: "1.1.0b2" });
  for (const [branch, version] of [["main", "1.1.0-beta.1"], ["beta", "1.1.0"], ["feature", "1.1.0"]]) assert.throws(() => releaseContext(branch, version));
});

test("generated SDK workflows run on beta and publish npm prereleases safely", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-release-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const workflows = path.join(dir, ".github", "workflows");
  fs.mkdirSync(workflows, { recursive: true });
  fs.writeFileSync(path.join(workflows, "publish.yml"), YAML.stringify({ on: { push: { branches: ["main"] }, release: { types: ["created"] } }, jobs: { publish: { steps: [{ run: "npm publish" }] } } }));
  prepareSDK(dir, releaseContext("beta", "1.1.0-beta.1"));
  const workflow = YAML.parse(fs.readFileSync(path.join(workflows, "publish.yml"), "utf8"));
  assert.deepEqual(workflow.on.push.branches, ["main", "beta"]);
  assert.deepEqual(workflow.on.release.types, ["published"]);
  assert.equal(workflow.jobs.publish.steps[0].name, "Check release channel");
  assert.match(workflow.jobs.publish.steps[1].run, /--tag.*prerelease.*beta.*latest/);
  assert.match(fs.readFileSync(path.join(dir, "README.md"), "utf8"), /GET operations only/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "sdk-release.json"), "utf8")).query_operations, false);
});

test("every generator uses the shared channel and keeps SDK output isolated", () => {
  const workflow = YAML.parse(fs.readFileSync(".github/workflows/generate-sdks.yml", "utf8"));
  assert.deepEqual(workflow.on.push.branches, ["main", "beta"]);
  const jobs = Object.entries(workflow.jobs).filter(([key]) => key.startsWith("generate-"));
  assert.equal(jobs.length, 11);
  for (const [name, job] of jobs) {
    assert.equal(job.needs, "release-context", name);
    const generator = job.steps.find(step => step.with?.generator);
    assert.equal(generator.with["openapi-file"], "openapi-3.0.yaml", name);
    assert.equal(generator.with["generator-tag"], "v7.27.0", name);
    const preparation = job.steps.filter(step => step.name === "Prepare SDK release");
    assert.equal(preparation.length, 1, name);
    assert.match(preparation[0].env.SDK_VERSION, /needs.release-context.outputs.version/, name);
    const push = job.steps.find(step => step.with?.["target-branch"]);
    assert.equal(push.with["target-branch"], "${{ needs.release-context.outputs.branch }}", name);
    assert.equal(push.with["create-target-branch-if-needed"], true, name);
  }
});
