import { describe, it, expect } from "@effect/vitest";
import { compileDockerIgnore } from "../../src/Bundle/DockerIgnore.ts";

describe("compileDockerIgnore", () => {
  it("ignores nothing when patterns are empty", () => {
    const matcher = compileDockerIgnore("");
    expect(matcher("file.ts")).toBe(false);
    expect(matcher("a/b.ts")).toBe(false);
  });

  it("matches simple filenames", () => {
    const matcher = compileDockerIgnore("node_modules\n*.log");
    expect(matcher("node_modules/foo")).toBe(true);
    expect(matcher("a.log")).toBe(true);
    expect(matcher("a.ts")).toBe(false);
  });

  it("matches double-star recursively", () => {
    const matcher = compileDockerIgnore("**/dist");
    expect(matcher("dist/x")).toBe(true);
    expect(matcher("a/dist/x")).toBe(true);
    expect(matcher("a/b/dist")).toBe(true);
  });

  it("supports negation with !", () => {
    const matcher = compileDockerIgnore("*.log\n!important.log");
    expect(matcher("a.log")).toBe(true);
    expect(matcher("important.log")).toBe(false);
  });

  it("strips leading slash", () => {
    const matcher = compileDockerIgnore("/dist");
    expect(matcher("dist/x")).toBe(true);
    expect(matcher("a/dist/x")).toBe(false);
  });

  it("ignores comments and blank lines", () => {
    const matcher = compileDockerIgnore("# comment\n\nnode_modules\n");
    expect(matcher("node_modules/foo")).toBe(true);
    expect(matcher("a.ts")).toBe(false);
  });
});
