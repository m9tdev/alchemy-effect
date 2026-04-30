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
  readonly host?: number;
  readonly container: number;
  readonly protocol?: "tcp" | "udp";
};

export type VolumeMount =
  | {
      readonly source: Input<Volume>;
      readonly target: string;
      readonly readonly?: boolean;
    }
  | {
      readonly hostPath: string;
      readonly target: string;
      readonly readonly?: boolean;
    };

export type Healthcheck = {
  readonly test: ReadonlyArray<string>;
  readonly interval?: Duration.Duration;
  readonly timeout?: Duration.Duration;
  readonly retries?: number;
  readonly startPeriod?: Duration.Duration;
};

export type ContainerProps = {
  readonly image: Input<Image>;
  readonly network: Input<Network>;
  readonly name?: string;
  readonly ports?: ReadonlyArray<PortMapping>;
  readonly env?: Record<string, Input<string>>;
  readonly volumes?: ReadonlyArray<VolumeMount>;
  readonly command?: ReadonlyArray<string>;
  readonly entrypoint?: ReadonlyArray<string>;
  readonly restart?: "no" | "on-failure" | "always" | "unless-stopped";
  readonly healthcheck?: Healthcheck;
  readonly labels?: Record<string, Input<string>>;
  readonly user?: string;
  readonly workingDir?: string;
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
    // Re-use if labels match our project; this also covers idempotent retries.
    if (
      existing.Config.Labels?.["alchemy.id"] === id &&
      existing.Config.Image === imageRef
    ) {
      return yield* hydrateOutput(existing, network);
    }
    // Stale container with same name from a previous deploy — remove first.
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
          if (oldName !== newName) return { action: "replace" } as const;
          // image, network, ports, env, volumes, command, entrypoint,
          // healthcheck, user, workingDir, labels all replace.
          // `labels` and `env` are key-order-insensitive: compare via
          // recordKey so reordering keys in source doesn't trigger replace.
          if (recordKey(news.labels) !== recordKey(olds.labels)) {
            return { action: "replace" } as const;
          }
          if (recordKey(news.env) !== recordKey(olds.env)) {
            return { action: "replace" } as const;
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
              return { action: "replace" } as const;
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
