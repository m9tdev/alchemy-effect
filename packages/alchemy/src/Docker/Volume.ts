import * as Effect from "effect/Effect";
import type { Input } from "../Input.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Providers } from "./Providers.ts";

export interface VolumeProps {
  readonly name?: string;
  readonly driver?: string;
  readonly driverOpts?: Record<string, string>;
  readonly labels?: Record<string, Input<string>>;
}

export interface Volume extends Resource<
  "Docker.Volume",
  VolumeProps,
  {
    volumeName: string;
    driver: string;
    mountpoint: string;
    scope: string;
  },
  never,
  Providers
> {}

export const Volume = Resource<Volume>("Docker.Volume");

export const VolumeProvider = () =>
  Provider.effect(
    Volume,
    Effect.gen(function* () {
      return {
        diff: Effect.fn(function* () {
          return undefined;
        }),
        create: Effect.fn(function* () {
          return yield* Effect.die("Docker.Volume create not yet implemented");
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
