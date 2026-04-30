import { runDockerCommand } from "@/Bundle/Docker";
import * as Docker from "@/Docker";
import { destroy, test } from "@/Test/Vitest";
import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { spawnSync } from "node:child_process";

const dockerDaemonOk =
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

describe.skipIf(!dockerDaemonOk)("Docker.Image (mode B — reference)", () => {
  test(
    "pulls a reference image",
    { providers: false },
    Effect.gen(function* () {
      yield* destroy();

      const image = yield* test.deploy(
        Effect.gen(function* () {
          return yield* Docker.Image("alpine", {
            image: "alpine:3.20",
            pull: "missing",
          });
        }),
      );

      expect(image.mode).toBe("reference");
      expect(image.imageRef).toBe("alpine:3.20");
      expect(image.imageId).toMatch(/^sha256:/);

      const { stdout } = yield* runDockerCommand([
        "image",
        "inspect",
        image.imageRef,
        "--format",
        "{{.Id}}",
      ]);
      expect(stdout.trim()).toBe(image.imageId);

      yield* destroy();
    }).pipe(Effect.provide(Docker.providers())),
  );

  test(
    'pull: "never" fails when image is not present',
    { providers: false },
    Effect.gen(function* () {
      yield* destroy();
      // Use a tag guaranteed not to exist on any developer machine
      const result = yield* Effect.result(
        test.deploy(
          Effect.gen(function* () {
            return yield* Docker.Image("missing", {
              image: "alchemy-test-does-not-exist:9.9.9",
              pull: "never",
            });
          }),
        ),
      );
      expect(Result.isFailure(result)).toBe(true);
      yield* destroy();
    }).pipe(Effect.provide(Docker.providers())),
  );

  test(
    "changing the image ref triggers replace",
    { providers: false },
    Effect.gen(function* () {
      yield* destroy();
      const a = yield* test.deploy(
        Effect.gen(function* () {
          return yield* Docker.Image("alpine", {
            image: "alpine:3.19",
            pull: "missing",
          });
        }),
      );
      const b = yield* test.deploy(
        Effect.gen(function* () {
          return yield* Docker.Image("alpine", {
            image: "alpine:3.20",
            pull: "missing",
          });
        }),
      );
      expect(a.imageRef).toBe("alpine:3.19");
      expect(b.imageRef).toBe("alpine:3.20");
      expect(b.imageId).not.toBe(a.imageId);
      yield* destroy();
    }).pipe(Effect.provide(Docker.providers())),
  );

  test(
    'pull: "missing" is idempotent when image is present',
    { providers: false },
    Effect.gen(function* () {
      yield* destroy();
      const a = yield* test.deploy(
        Effect.gen(function* () {
          return yield* Docker.Image("alpine", {
            image: "alpine:3.20",
            pull: "missing",
          });
        }),
      );
      const b = yield* test.deploy(
        Effect.gen(function* () {
          return yield* Docker.Image("alpine", {
            image: "alpine:3.20",
            pull: "missing",
          });
        }),
      );
      // Same imageId, same imageRef; the second deploy should be a no-op.
      expect(b.imageId).toBe(a.imageId);
      expect(b.imageRef).toBe(a.imageRef);
      yield* destroy();
    }).pipe(Effect.provide(Docker.providers())),
  );
});
