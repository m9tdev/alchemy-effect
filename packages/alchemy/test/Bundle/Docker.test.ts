import {
  DockerCommandError,
  buildAppDockerfile,
  dockerBuild,
  materializeDockerfile,
  runDockerCommand,
  writeContextFiles,
} from "@/Bundle/Docker";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import { spawnSync } from "node:child_process";

const dockerDaemonOk =
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

describe("docker context helpers", () => {
  it.effect("materializes a Dockerfile in the target directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectory({
        prefix: "alchemy-docker-ctx-",
      });
      try {
        const ctx = path.join(root, "ctx");
        const dockerfile = yield* materializeDockerfile("FROM scratch\n", ctx);
        expect(dockerfile).toBe(path.join(ctx, "Dockerfile"));
        expect(yield* fs.exists(dockerfile)).toBe(true);
        expect(yield* fs.readFileString(dockerfile)).toBe("FROM scratch\n");
      } finally {
        yield* fs
          .remove(root, { recursive: true })
          .pipe(Effect.catch(() => Effect.void));
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("writes nested context files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectory({
        prefix: "alchemy-docker-path-",
      });
      try {
        const ctx = path.join(root, "ctx");
        yield* writeContextFiles(ctx, [
          { path: "nested/hello.txt", content: "hi" },
        ]);
        expect(
          yield* fs.readFileString(path.join(ctx, "nested", "hello.txt")),
        ).toBe("hi");
      } finally {
        yield* fs
          .remove(root, { recursive: true })
          .pipe(Effect.catch(() => Effect.void));
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("runDockerCommand", () => {
  it.effect("fails with DockerCommandError for invalid docker invocation", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        runDockerCommand([
          "inspect",
          "--type=image",
          "this-image-should-not-exist-alchemy-test:xyz",
        ]),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(DockerCommandError);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("dockerBuild", () => {
  if (dockerDaemonOk) {
    it.effect("builds a minimal image with content Dockerfile", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-docker-build-",
        });
        try {
          const ctx = path.join(root, "ctx");
          const tag = "alchemy-docker-test:minimal";
          yield* materializeDockerfile(
            [
              "FROM alpine:3.19",
              "RUN echo ok > /tmp/ok.txt",
              'CMD ["cat", "/tmp/ok.txt"]',
              "",
            ].join("\n"),
            ctx,
          );
          yield* dockerBuild({
            tag,
            context: ctx,
          });
          const inspect = yield* runDockerCommand([
            "image",
            "inspect",
            tag,
            "--format",
            "{{.Id}}",
          ]);
          expect(inspect.stdout.trim().length).toBeGreaterThan(0);
          yield* runDockerCommand(["rmi", "-f", tag]).pipe(
            Effect.catch(() => Effect.void),
          );
        } finally {
          yield* fs
            .remove(root, { recursive: true })
            .pipe(Effect.catch(() => Effect.void));
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("passes --platform and --build-arg", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-docker-build-",
        });
        try {
          const ctx = path.join(root, "ctx");
          const tag = "alchemy-docker-test:args";
          yield* materializeDockerfile(
            [
              "FROM alpine:3.19",
              "ARG FOO=default",
              'RUN echo "$FOO" > /out.txt',
              "",
            ].join("\n"),
            ctx,
          );
          yield* dockerBuild({
            tag,
            context: ctx,
            platform: "linux/amd64",
            buildArgs: { FOO: "from-arg" },
          });
          const out = yield* runDockerCommand([
            "run",
            "--rm",
            tag,
            "cat",
            "/out.txt",
          ]);
          expect(out.stdout.trim()).toBe("from-arg");
          yield* runDockerCommand(["rmi", "-f", tag]).pipe(
            Effect.catch(() => Effect.void),
          );
        } finally {
          yield* fs
            .remove(root, { recursive: true })
            .pipe(Effect.catch(() => Effect.void));
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("respects multi-stage --target", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectory({
          prefix: "alchemy-docker-build-",
        });
        try {
          const ctx = path.join(root, "ctx");
          const tag = "alchemy-docker-test:target";
          yield* materializeDockerfile(
            [
              "FROM alpine:3.19 AS base",
              "RUN echo base > /stage.txt",
              "",
              "FROM alpine:3.19 AS secondary",
              "RUN echo secondary > /stage.txt",
              "",
            ].join("\n"),
            ctx,
          );
          yield* dockerBuild({
            tag,
            context: ctx,
            target: "secondary",
          });
          const out = yield* runDockerCommand([
            "run",
            "--rm",
            tag,
            "cat",
            "/stage.txt",
          ]);
          expect(out.stdout.trim()).toBe("secondary");
          yield* runDockerCommand(["rmi", "-f", tag]).pipe(
            Effect.catch(() => Effect.void),
          );
        } finally {
          yield* fs
            .remove(root, { recursive: true })
            .pipe(Effect.catch(() => Effect.void));
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    );
  } else {
    it.skip("builds a minimal image with content Dockerfile", () => {});
    it.skip("passes --platform and --build-arg", () => {});
    it.skip("respects multi-stage --target", () => {});
  }
});

describe("buildAppDockerfile", () => {
  it("emits a Bun Dockerfile with no externals by default", () => {
    const dockerfile = buildAppDockerfile({ runtime: "bun" });
    expect(dockerfile).toContain("FROM oven/bun:1");
    expect(dockerfile).toContain("WORKDIR /app");
    expect(dockerfile).toContain("COPY index.mjs /app/index.mjs");
    expect(dockerfile).toContain("COPY *.js /app/");
    expect(dockerfile).toContain('ENTRYPOINT ["bun", "/app/index.mjs"]');
    expect(dockerfile).not.toContain("RUN bun add");
    expect(dockerfile).not.toContain("RUN npm install");
  });

  it("installs externals via `bun add` when autoInstallExternals defaults to true", () => {
    const dockerfile = buildAppDockerfile({
      runtime: "bun",
      external: ["sharp", "pino"],
    });
    expect(dockerfile).toContain("RUN bun add sharp pino");
    expect(dockerfile).toContain('ENTRYPOINT ["bun", "/app/index.mjs"]');
  });

  it("does NOT emit `RUN bun add` when autoInstallExternals is false", () => {
    const dockerfile = buildAppDockerfile({
      runtime: "bun",
      external: ["sharp", "pino"],
      autoInstallExternals: false,
    });
    expect(dockerfile).not.toContain("RUN bun add");
    expect(dockerfile).not.toContain("RUN npm install");
    // Bundle copy and entrypoint still present
    expect(dockerfile).toContain("COPY index.mjs /app/index.mjs");
    expect(dockerfile).toContain('ENTRYPOINT ["bun", "/app/index.mjs"]');
  });

  it("uses `node:22-slim` and `node` entrypoint for the Node runtime", () => {
    const dockerfile = buildAppDockerfile({ runtime: "node" });
    expect(dockerfile).toContain("FROM node:22-slim");
    expect(dockerfile).not.toContain("FROM oven/bun:1");
    expect(dockerfile).toContain('ENTRYPOINT ["node", "/app/index.mjs"]');
    expect(dockerfile).not.toContain("RUN npm install");
    expect(dockerfile).not.toContain("RUN bun add");
  });

  it("respects a custom `base` override", () => {
    const dockerfile = buildAppDockerfile({
      runtime: "bun",
      base: "FROM ghcr.io/foo/bar:1.2",
    });
    expect(dockerfile).toContain("FROM ghcr.io/foo/bar:1.2");
    expect(dockerfile).not.toContain("FROM oven/bun:1");
    // Runtime-specific entrypoint is unchanged by base override
    expect(dockerfile).toContain('ENTRYPOINT ["bun", "/app/index.mjs"]');
  });

  it("uses a custom `entryFile` for both COPY and ENTRYPOINT", () => {
    const dockerfile = buildAppDockerfile({
      runtime: "bun",
      entryFile: "server.mjs",
    });
    expect(dockerfile).toContain("COPY server.mjs /app/server.mjs");
    expect(dockerfile).toContain('ENTRYPOINT ["bun", "/app/server.mjs"]');
    expect(dockerfile).not.toContain("/app/index.mjs");
  });
});
