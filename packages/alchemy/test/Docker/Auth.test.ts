import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { DockerConfigPath, resolveAuth } from "../../src/Docker/Auth.ts";

const FsAndPath = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const PlatformLayer = Layer.mergeAll(
  FsAndPath,
  BunChildProcessSpawner.layer.pipe(Layer.provide(FsAndPath)),
);

describe("resolveAuth", () => {
  it.effect("returns explicit credentials when provided", () =>
    Effect.gen(function* () {
      const result = yield* resolveAuth("ghcr.io", {
        username: "explicit-user",
        password: "explicit-pass",
      }).pipe(Effect.provideService(DockerConfigPath, "/nonexistent"));
      expect(result).toEqual({
        username: "explicit-user",
        password: "explicit-pass",
        serveraddress: "ghcr.io",
      });
    }).pipe(Effect.provide(PlatformLayer)),
  );

  it.effect("reads inline auths.<registry>.auth from config", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectory({
        prefix: "alchemy-auth-test-",
      });
      try {
        const configPath = path.join(dir, "config.json");
        yield* fs.writeFileString(
          configPath,
          JSON.stringify({
            auths: { "ghcr.io": { auth: "Z2hjcl91c2VyOmdoY3JfcGFzcw==" } },
          }),
        );
        const result = yield* resolveAuth("ghcr.io", undefined).pipe(
          Effect.provideService(DockerConfigPath, configPath),
        );
        expect(result).toEqual({
          username: "ghcr_user",
          password: "ghcr_pass",
          serveraddress: "ghcr.io",
        });
      } finally {
        yield* fs
          .remove(dir, { recursive: true })
          .pipe(Effect.catch(() => Effect.void));
      }
    }).pipe(Effect.provide(PlatformLayer)),
  );

  it.effect("invokes credential helper from credsStore", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectory({
        prefix: "alchemy-auth-helper-",
      });
      try {
        const helperSrc = path.join(
          process.cwd(),
          "packages/alchemy/test/Docker/fixtures/mock-credential-helper.sh",
        );
        const helperDst = path.join(dir, "docker-credential-alchemy-test");
        yield* fs.copy(helperSrc, helperDst);
        yield* fs.chmod(helperDst, 0o755);

        const configPath = path.join(dir, "config.json");
        yield* fs.writeFileString(
          configPath,
          JSON.stringify({ credsStore: "alchemy-test" }),
        );

        const originalPath = process.env.PATH ?? "";
        process.env.PATH = `${dir}:${originalPath}`;
        try {
          const result = yield* resolveAuth("ghcr.io", undefined).pipe(
            Effect.provideService(DockerConfigPath, configPath),
          );
          expect(result).toEqual({
            username: "mock-user",
            password: "mock-secret",
            serveraddress: "ghcr.io",
          });
        } finally {
          process.env.PATH = originalPath;
        }
      } finally {
        yield* fs
          .remove(dir, { recursive: true })
          .pipe(Effect.catch(() => Effect.void));
      }
    }).pipe(Effect.provide(PlatformLayer)),
  );

  it.effect("credHelpers per-registry override beats credsStore", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectory({
        prefix: "alchemy-auth-helper2-",
      });
      try {
        const helperSrc = path.join(
          process.cwd(),
          "packages/alchemy/test/Docker/fixtures/mock-credential-helper.sh",
        );
        const helperDst = path.join(dir, "docker-credential-alchemy-test");
        yield* fs.copy(helperSrc, helperDst);
        yield* fs.chmod(helperDst, 0o755);

        const configPath = path.join(dir, "config.json");
        yield* fs.writeFileString(
          configPath,
          JSON.stringify({
            credsStore: "nonexistent-store",
            credHelpers: { "ghcr.io": "alchemy-test" },
          }),
        );

        const originalPath = process.env.PATH ?? "";
        process.env.PATH = `${dir}:${originalPath}`;
        try {
          const result = yield* resolveAuth("ghcr.io", undefined).pipe(
            Effect.provideService(DockerConfigPath, configPath),
          );
          expect(result?.username).toBe("mock-user");
        } finally {
          process.env.PATH = originalPath;
        }
      } finally {
        yield* fs
          .remove(dir, { recursive: true })
          .pipe(Effect.catch(() => Effect.void));
      }
    }).pipe(Effect.provide(PlatformLayer)),
  );
});
