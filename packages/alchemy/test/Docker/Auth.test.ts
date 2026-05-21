import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { DockerConfigPath, resolveAuth } from "../../src/Docker/Auth.ts";

const PlatformLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

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
});
