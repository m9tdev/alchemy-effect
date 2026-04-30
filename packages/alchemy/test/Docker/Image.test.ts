import { runDockerCommand } from "@/Bundle/Docker";
import * as Docker from "@/Docker";
import { destroy, test } from "@/Test/Vitest";
import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
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
});
