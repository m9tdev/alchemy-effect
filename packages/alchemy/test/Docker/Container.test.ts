import { runDockerCommand } from "@/Bundle/Docker";
import * as Docker from "@/Docker";
import { destroy, test } from "@/Test/Vitest";
import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { spawnSync } from "node:child_process";

const dockerDaemonOk =
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

describe.skipIf(!dockerDaemonOk)("Docker.Container", () => {
  test(
    "runs alpine, exposes name, deletes cleanly",
    { providers: false, timeout: 120_000 },
    Effect.gen(function* () {
      yield* destroy();

      const result = yield* test.deploy(
        Effect.gen(function* () {
          const network = yield* Docker.Network("net", {});
          const image = yield* Docker.Image("alpine", {
            image: "alpine:3.20",
          });
          const container = yield* Docker.Container("c", {
            name: "alchemy-test-container",
            image,
            network,
            command: ["sleep", "60"],
            restart: "no",
          });
          return { network, container };
        }),
      );

      expect(result.container.containerName).toBe("alchemy-test-container");
      expect(result.container.state).toBe("running");

      const { stdout } = yield* runDockerCommand([
        "container",
        "inspect",
        result.container.containerId,
        "--format",
        "{{.State.Status}}",
      ]);
      expect(stdout.trim()).toBe("running");

      yield* destroy();

      const probe = yield* Effect.result(
        runDockerCommand([
          "container",
          "inspect",
          result.container.containerId,
        ]),
      );
      expect(Result.isFailure(probe)).toBe(true);
    }).pipe(Effect.provide(Docker.providers())),
  );
});
