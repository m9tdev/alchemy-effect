import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type { Input } from "../Input.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Image } from "./Image.ts";
import type { Network } from "./Network.ts";
import type { Providers } from "./Providers.ts";
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

export const ContainerProvider = () =>
  Provider.effect(
    Container,
    Effect.gen(function* () {
      return {
        diff: Effect.fn(function* () {
          return undefined;
        }),
        create: Effect.fn(function* () {
          return yield* Effect.die(
            "Docker.Container create not yet implemented",
          );
        }),
        update: Effect.fn(function* ({ output }) {
          return output;
        }),
        delete: Effect.fn(function* () {
          return;
        }),
      };
    }),
  );
