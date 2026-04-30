import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { runDockerCommand } from "../Bundle/Docker.ts";
import { isResolved } from "../Diff.ts";
import type { Input } from "../Input.ts";
import { createPhysicalName } from "../PhysicalName.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Image } from "./Image.ts";
import { inspect, type InspectedContainer } from "./Inspect.ts";
import { dockerLabels } from "./Labels.ts";
import type { Network } from "./Network.ts";
import type { Providers } from "./Providers.ts";
import { isStderrMatch, recordKey } from "./util.ts";
import type { Volume } from "./Volume.ts";

export type PortMapping = {
  /**
   * Host port to bind to. Omit for a random ephemeral port assigned by Docker.
   */
  readonly host?: number;
  /**
   * Container port to expose.
   */
  readonly container: number;
  /**
   * Wire protocol.
   * @default "tcp"
   */
  readonly protocol?: "tcp" | "udp";
};

export type VolumeMount =
  | {
      /** Named `Docker.Volume` to mount. */
      readonly source: Input<Volume>;
      /** Mount path inside the container. */
      readonly target: string;
      /** Mount read-only. @default false */
      readonly readonly?: boolean;
    }
  | {
      /** Absolute path on the host to bind-mount. */
      readonly hostPath: string;
      /** Mount path inside the container. */
      readonly target: string;
      /** Mount read-only. @default false */
      readonly readonly?: boolean;
    };

export type Healthcheck = {
  /**
   * Docker healthcheck command. The first element is a sentinel:
   * - `["CMD-SHELL", "<shell command>"]` — run via `/bin/sh -c`
   * - `["CMD", "<bin>", "<arg>", ...]` — exec form
   * - `["NONE"]` — disable any healthcheck inherited from the image
   */
  readonly test: ReadonlyArray<string>;
  /** Interval between checks. */
  readonly interval?: Duration.Duration;
  /** Per-check timeout. */
  readonly timeout?: Duration.Duration;
  /** Failure count required to mark the container unhealthy. */
  readonly retries?: number;
  /** Initial grace period during which failures don't count. */
  readonly startPeriod?: Duration.Duration;
};

export type ContainerProps = {
  /**
   * Docker image to run.
   */
  readonly image: Input<Image>;
  /**
   * Network the container attaches to.
   */
  readonly network: Input<Network>;
  /**
   * Explicit container name.
   * @default a deterministic per-stack name derived from the app, stage, and logical id
   */
  readonly name?: string;
  /**
   * Host/container port mappings.
   */
  readonly ports?: ReadonlyArray<PortMapping>;
  /**
   * Environment variables passed to the container.
   */
  readonly env?: Record<string, Input<string>>;
  /**
   * Volume mounts (named volumes or host bind mounts).
   */
  readonly volumes?: ReadonlyArray<VolumeMount>;
  /**
   * Overrides the image's default command (CMD).
   */
  readonly command?: ReadonlyArray<string>;
  /**
   * Overrides the image's ENTRYPOINT.
   */
  readonly entrypoint?: ReadonlyArray<string>;
  /**
   * Restart policy. Mutates in place — does not require replacement.
   * @default "unless-stopped"
   */
  readonly restart?: "no" | "on-failure" | "always" | "unless-stopped";
  /**
   * Docker healthcheck override. Forwarded to `docker run --health-*`.
   */
  readonly healthcheck?: Healthcheck;
  /**
   * Extra labels merged with the internal alchemy ownership labels.
   */
  readonly labels?: Record<string, Input<string>>;
  /**
   * `--user` flag for `docker run`.
   */
  readonly user?: string;
  /**
   * `--workdir` flag for `docker run`.
   */
  readonly workingDir?: string;
  /**
   * Wait for the healthcheck to report `healthy` before considering the create
   * complete.
   * @default true if `healthcheck` is set, else false
   */
  readonly waitForHealthy?: boolean;
};

export interface Container extends Resource<
  "Docker.Container",
  ContainerProps,
  {
    containerId: string;
    containerName: string;
    imageRef: string;
    network: { name: string; id: string };
    ports: ReadonlyArray<{ host: number; container: number; protocol: string }>;
    state: "created" | "running" | "exited" | "paused" | "dead";
    ipAddress: string;
    startedAt?: string;
  },
  never,
  Providers
> {}

/**
 * A running Docker container, attached to a `Docker.Network` and optionally
 * mounting one or more `Docker.Volume`s.
 *
 * Containers are created idempotently: a container with the same name and
 * matching ownership labels is adopted; otherwise it's recreated. Most prop
 * changes trigger replacement; only `restart` policy mutates in place.
 *
 * @section Running a Container
 * @example Postgres with a named volume
 * ```typescript
 * const network = yield* Docker.Network("net", {});
 * const pgData = yield* Docker.Volume("pg-data", {});
 * const pgImage = yield* Docker.Image("pg", { image: "postgres:16-alpine" });
 * const pg = yield* Docker.Container("postgres", {
 *   image: pgImage,
 *   network,
 *   env: { POSTGRES_PASSWORD: "secret", POSTGRES_DB: "app" },
 *   volumes: [{ source: pgData, target: "/var/lib/postgresql/data" }],
 * });
 * ```
 *
 * @section Healthchecks
 * @example Wait for postgres to be ready before continuing
 * ```typescript
 * const pg = yield* Docker.Container("postgres", {
 *   image: pgImage,
 *   network,
 *   env: { POSTGRES_PASSWORD: "secret" },
 *   healthcheck: {
 *     test: ["CMD-SHELL", "pg_isready -U postgres"],
 *     interval: Duration.seconds(2),
 *     timeout: Duration.seconds(2),
 *     retries: 30,
 *   },
 *   waitForHealthy: true,
 * });
 * ```
 *
 * @section Inter-container Linking
 * Containers on the same network can address each other by container name —
 * Docker provides built-in DNS. Pass the dependency's `containerName` (or
 * a fixed `name` set on the dependency) as an env var.
 *
 * @example App container talking to postgres
 * ```typescript
 * const app = yield* Docker.Container("app", {
 *   image: appImage,
 *   network,
 *   env: { DATABASE_URL: `postgres://postgres:secret@${pg.containerName}/app` },
 * });
 * ```
 */
export const Container = Resource<Container>("Docker.Container");

const NO_SUCH_CONTAINER = /no such container/i;

const computeName = (id: string, props: ContainerProps) =>
  Effect.gen(function* () {
    if (props.name) return props.name;
    return yield* createPhysicalName({
      id,
      maxLength: 63,
      lowercase: true,
    });
  });

/** @internal Exported for unit testing only. */
export const buildRunArgs = ({
  name,
  imageRef,
  networkName,
  labels,
  props,
}: {
  name: string;
  imageRef: string;
  networkName: string;
  labels: Record<string, string>;
  props: ContainerProps;
}): string[] => {
  const args: string[] = [
    "run",
    "-d",
    "--name",
    name,
    "--network",
    networkName,
    "--restart",
    props.restart ?? "unless-stopped",
  ];
  for (const [k, v] of Object.entries(labels)) {
    args.push("--label", `${k}=${v}`);
  }
  for (const [k, v] of Object.entries(props.env ?? {})) {
    args.push("-e", `${k}=${v as string}`);
  }
  for (const m of props.ports ?? []) {
    const proto = m.protocol ?? "tcp";
    if (m.host !== undefined) {
      args.push("-p", `${m.host}:${m.container}/${proto}`);
    } else {
      args.push("-p", `${m.container}/${proto}`);
    }
  }
  for (const v of props.volumes ?? []) {
    if ("source" in v) {
      const src = (v.source as Volume).volumeName as unknown as string;
      const ro = v.readonly ? ":ro" : "";
      args.push("-v", `${src}:${v.target}${ro}`);
    } else {
      const ro = v.readonly ? ":ro" : "";
      args.push("-v", `${v.hostPath}:${v.target}${ro}`);
    }
  }
  if (props.user) args.push("--user", props.user);
  if (props.workingDir) args.push("--workdir", props.workingDir);
  if (props.entrypoint) {
    args.push("--entrypoint", props.entrypoint[0]!);
    // Remaining entrypoint args go after the image; pre-pended to command below.
  }
  if (props.healthcheck) {
    const test = props.healthcheck.test;
    if (test[0] === "NONE") {
      // Docker sentinel meaning "no healthcheck" — disable rather than emit
      // a literal "NONE" command. Skip the rest of the healthcheck flags.
      args.push("--no-healthcheck");
    } else {
      // The CLI's --health-cmd is always a shell command (CMD-SHELL semantics),
      // so strip the Docker disambiguation sentinel before joining.
      const cmd =
        test[0] === "CMD" || test[0] === "CMD-SHELL"
          ? test.slice(1).join(" ")
          : test.join(" ");
      args.push("--health-cmd", cmd);
      if (props.healthcheck.interval)
        args.push(
          "--health-interval",
          `${Duration.toMillis(props.healthcheck.interval)}ms`,
        );
      if (props.healthcheck.timeout)
        args.push(
          "--health-timeout",
          `${Duration.toMillis(props.healthcheck.timeout)}ms`,
        );
      if (props.healthcheck.retries !== undefined)
        args.push("--health-retries", String(props.healthcheck.retries));
      if (props.healthcheck.startPeriod)
        args.push(
          "--health-start-period",
          `${Duration.toMillis(props.healthcheck.startPeriod)}ms`,
        );
    }
  }
  args.push(imageRef);
  if (props.entrypoint && props.entrypoint.length > 1) {
    args.push(...props.entrypoint.slice(1));
  }
  if (props.command) args.push(...props.command);
  return args;
};

const hydrateOutput = (c: InspectedContainer, network: Network) =>
  Effect.sync(() => {
    const ports = Object.entries(c.NetworkSettings.Ports ?? {}).flatMap(
      ([key, bindings]) => {
        const [containerPortStr, protocol] = key.split("/");
        const containerPort = Number(containerPortStr);
        return (bindings ?? []).map((b) => ({
          container: containerPort,
          host: Number(b.HostPort),
          protocol: protocol ?? "tcp",
        }));
      },
    );
    return {
      containerId: c.Id,
      containerName: c.Name.replace(/^\//, ""),
      imageRef: c.Config.Image,
      network: {
        name: network.networkName as unknown as string,
        id: network.networkId as unknown as string,
      },
      ports,
      state: c.State.Status,
      ipAddress:
        Object.values(c.NetworkSettings.Networks)[0]?.IPAddress ?? "",
      startedAt: c.State.StartedAt,
    };
  });

const waitForState = Effect.fnUntraced(function* ({
  ref,
  wantHealthy,
}: {
  ref: string;
  wantHealthy: boolean;
}) {
  return yield* Effect.gen(function* () {
    const c = yield* inspect<InspectedContainer>("container", ref);
    if (!c)
      return yield* Effect.fail(new Error(`container ${ref} disappeared`));
    if (c.State.Status === "exited" || c.State.Status === "dead") {
      return yield* Effect.fail(
        new Error(`container ${ref} entered state ${c.State.Status}`),
      );
    }
    if (wantHealthy) {
      if (c.State.Health?.Status === "healthy") return c;
      return yield* Effect.fail(new Error("not healthy yet"));
    }
    if (c.State.Status === "running") return c;
    return yield* Effect.fail(new Error("not running yet"));
  }).pipe(
    Effect.retry({
      schedule: Schedule.spaced("500 millis").pipe(
        Schedule.both(Schedule.during("60 seconds")),
      ),
    }),
  );
});

const ensureContainer = Effect.fnUntraced(function* ({
  id,
  news,
}: {
  id: string;
  news: ContainerProps;
}) {
  const name = yield* computeName(id, news);
  const labels = {
    ...(yield* dockerLabels(id)),
    ...((news.labels ?? {}) as Record<string, string>),
  };
  const image = news.image as unknown as Image;
  const network = news.network as unknown as Network;
  const imageRef = image.imageRef as unknown as string;

  const existing = yield* inspect<InspectedContainer>("container", name);
  if (existing) {
    // Adopt only if it's actually running with our labels and image — a
    // `Created`/`exited`/`dead` container left over from a failed previous
    // attempt must be removed and recreated, not adopted.
    if (
      existing.Config.Labels?.["alchemy.id"] === id &&
      existing.Config.Image === imageRef &&
      existing.State.Running
    ) {
      return yield* hydrateOutput(existing, network);
    }
    yield* runDockerCommand(["rm", "-f", existing.Id]);
  }

  const args = buildRunArgs({
    name,
    imageRef,
    networkName: network.networkName as unknown as string,
    labels,
    props: news,
  });
  yield* runDockerCommand(args);

  const wantHealthy = news.waitForHealthy ?? Boolean(news.healthcheck);
  const ready = yield* waitForState({ ref: name, wantHealthy });
  return yield* hydrateOutput(ready, network);
});

export const ContainerProvider = () =>
  Provider.effect(
    Container,
    Effect.gen(function* () {
      return {
        stables: ["containerId", "containerName"],
        diff: Effect.fn(function* ({
          id,
          news,
          olds = {} as ContainerProps,
        }) {
          if (!isResolved(news)) return undefined;
          const oldName = yield* computeName(id, olds);
          const newName = yield* computeName(id, news);
          if (oldName !== newName) {
            return { action: "replace", deleteFirst: true } as const;
          }
          // image, network, ports, env, volumes, command, entrypoint,
          // healthcheck, user, workingDir, labels all replace.
          // `labels` and `env` are key-order-insensitive: compare via
          // recordKey so reordering keys in source doesn't trigger replace.
          if (recordKey(news.labels) !== recordKey(olds.labels)) {
            return { action: "replace", deleteFirst: true } as const;
          }
          if (recordKey(news.env) !== recordKey(olds.env)) {
            return { action: "replace", deleteFirst: true } as const;
          }
          const replaceKeys = [
            "image",
            "network",
            "ports",
            "volumes",
            "command",
            "entrypoint",
            "healthcheck",
            "user",
            "workingDir",
          ] as const;
          for (const k of replaceKeys) {
            if (
              JSON.stringify(
                (olds as Record<string, unknown>)[k] ?? null,
              ) !==
              JSON.stringify(
                (news as Record<string, unknown>)[k] ?? null,
              )
            ) {
              return { action: "replace", deleteFirst: true } as const;
            }
          }
          // restart can update in place.
          return undefined;
        }),
        create: Effect.fn(function* ({ id, news }) {
          return yield* ensureContainer({ id, news });
        }),
        update: Effect.fn(function* ({ news, olds, output }) {
          if (
            (news.restart ?? "unless-stopped") !==
            (olds.restart ?? "unless-stopped")
          ) {
            // Note: `docker container update --restart` only changes the
            // policy applied on the next daemon-managed restart; it does NOT
            // restart a running container. Do not "fix" this by adding a
            // `docker restart` call — that would terminate the user's process.
            yield* runDockerCommand([
              "container",
              "update",
              "--restart",
              news.restart ?? "unless-stopped",
              output.containerId,
            ]);
          }
          return output;
        }),
        delete: Effect.fn(function* ({ output }) {
          yield* runDockerCommand([
            "stop",
            "-t",
            "10",
            output.containerId,
          ]).pipe(
            Effect.catchTag("DockerCommandError", (e) =>
              isStderrMatch(e, NO_SUCH_CONTAINER)
                ? Effect.void
                : Effect.fail(e),
            ),
          );
          yield* runDockerCommand(["rm", "-f", output.containerId]).pipe(
            Effect.catchTag("DockerCommandError", (e) =>
              isStderrMatch(e, NO_SUCH_CONTAINER)
                ? Effect.void
                : Effect.fail(e),
            ),
          );
        }),
      };
    }),
  );
