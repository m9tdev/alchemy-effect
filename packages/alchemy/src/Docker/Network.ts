import * as Effect from "effect/Effect";
import type { Input } from "../Input.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Providers } from "./Providers.ts";

export interface NetworkProps {
  readonly name?: string;
  readonly driver?: "bridge" | "host" | "overlay" | "macvlan" | "none";
  readonly internal?: boolean;
  readonly attachable?: boolean;
  readonly labels?: Record<string, Input<string>>;
}

export interface Network extends Resource<
  "Docker.Network",
  NetworkProps,
  {
    networkId: string;
    networkName: string;
    driver: string;
    scope: string;
  },
  never,
  Providers
> {}

export const Network = Resource<Network>("Docker.Network");

export const NetworkProvider = () =>
  Provider.effect(
    Network,
    Effect.gen(function* () {
      return {
        diff: Effect.fn(function* () {
          return undefined;
        }),
        create: Effect.fn(function* () {
          return yield* Effect.die("Docker.Network create not yet implemented");
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
