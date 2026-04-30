import { runDockerCommand } from "@/Bundle/Docker";
import * as Docker from "@/Docker";
import { buildRunArgs } from "@/Docker/Container";
import { destroy, test } from "@/Test/Vitest";
import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { spawnSync } from "node:child_process";
import { test as vitestTest } from "vitest";

const dockerDaemonOk =
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

describe("buildRunArgs", () => {
  vitestTest("emits healthcheck with leading CMD stripped", () => {
    const args = buildRunArgs({
      name: "n",
      imageRef: "alpine:3.20",
      networkName: "net",
      labels: {},
      props: {
        image: {} as any,
        network: {} as any,
        healthcheck: { test: ["CMD", "curl", "-f", "http://x"] },
      },
    });
    const i = args.indexOf("--health-cmd");
    expect(args[i + 1]).toBe("curl -f http://x");
  });

  vitestTest("emits --no-healthcheck for NONE sentinel", () => {
    const args = buildRunArgs({
      name: "n",
      imageRef: "alpine:3.20",
      networkName: "net",
      labels: {},
      props: {
        image: {} as any,
        network: {} as any,
        healthcheck: { test: ["NONE"] },
      },
    });
    expect(args).toContain("--no-healthcheck");
    expect(args).not.toContain("--health-cmd");
  });

  vitestTest("port without host port", () => {
    const args = buildRunArgs({
      name: "n",
      imageRef: "alpine:3.20",
      networkName: "net",
      labels: {},
      props: {
        image: {} as any,
        network: {} as any,
        ports: [{ container: 8080 }],
      },
    });
    const i = args.indexOf("-p");
    expect(args[i + 1]).toBe("8080/tcp");
  });

  vitestTest("port with host port and udp protocol", () => {
    const args = buildRunArgs({
      name: "n",
      imageRef: "alpine:3.20",
      networkName: "net",
      labels: {},
      props: {
        image: {} as any,
        network: {} as any,
        ports: [{ host: 53, container: 53, protocol: "udp" }],
      },
    });
    const i = args.indexOf("-p");
    expect(args[i + 1]).toBe("53:53/udp");
  });

  vitestTest("volume mount with hostPath", () => {
    const args = buildRunArgs({
      name: "n",
      imageRef: "alpine:3.20",
      networkName: "net",
      labels: {},
      props: {
        image: {} as any,
        network: {} as any,
        volumes: [{ hostPath: "/data", target: "/app/data", readonly: true }],
      },
    });
    const i = args.indexOf("-v");
    expect(args[i + 1]).toBe("/data:/app/data:ro");
  });

  vitestTest("volume mount with Volume source", () => {
    const args = buildRunArgs({
      name: "n",
      imageRef: "alpine:3.20",
      networkName: "net",
      labels: {},
      props: {
        image: {} as any,
        network: {} as any,
        volumes: [{ source: { volumeName: "vol1" } as any, target: "/data" }],
      },
    });
    const i = args.indexOf("-v");
    expect(args[i + 1]).toBe("vol1:/data");
  });
});

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

  test(
    "changing restart policy updates in place",
    { providers: false, timeout: 120_000 },
    Effect.gen(function* () {
      yield* destroy();

      const before = yield* test.deploy(
        Effect.gen(function* () {
          const network = yield* Docker.Network("net", {});
          const image = yield* Docker.Image("alpine", {
            image: "alpine:3.20",
          });
          const container = yield* Docker.Container("c", {
            image,
            network,
            command: ["sleep", "60"],
            restart: "no",
          });
          return container;
        }),
      );

      const after = yield* test.deploy(
        Effect.gen(function* () {
          const network = yield* Docker.Network("net", {});
          const image = yield* Docker.Image("alpine", {
            image: "alpine:3.20",
          });
          const container = yield* Docker.Container("c", {
            image,
            network,
            command: ["sleep", "60"],
            restart: "always",
          });
          return container;
        }),
      );

      expect(after.containerId).toBe(before.containerId);

      yield* destroy();
    }).pipe(Effect.provide(Docker.providers())),
  );

  test(
    "changing env triggers replace",
    { providers: false, timeout: 120_000 },
    Effect.gen(function* () {
      yield* destroy();

      const before = yield* test.deploy(
        Effect.gen(function* () {
          const network = yield* Docker.Network("net", {});
          const image = yield* Docker.Image("alpine", {
            image: "alpine:3.20",
          });
          const container = yield* Docker.Container("c", {
            image,
            network,
            env: { FOO: "bar" },
            command: ["sleep", "60"],
          });
          return container;
        }),
      );

      const after = yield* test.deploy(
        Effect.gen(function* () {
          const network = yield* Docker.Network("net", {});
          const image = yield* Docker.Image("alpine", {
            image: "alpine:3.20",
          });
          const container = yield* Docker.Container("c", {
            image,
            network,
            env: { FOO: "baz" },
            command: ["sleep", "60"],
          });
          return container;
        }),
      );

      expect(after.containerId).not.toBe(before.containerId);

      yield* destroy();
    }).pipe(Effect.provide(Docker.providers())),
  );
});
