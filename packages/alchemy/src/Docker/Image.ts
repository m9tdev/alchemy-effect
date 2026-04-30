import * as Effect from "effect/Effect";
import type { Input } from "../Input.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Providers } from "./Providers.ts";

export type ImageBuildProps = {
  readonly main: string;
  readonly runtime?: "bun" | "node";
  readonly external?: ReadonlyArray<string>;
  readonly autoInstallExternals?: boolean;
  readonly dockerfile?: string;
  readonly platform?: string;
  readonly repository?: string;
  readonly tag?: string;
  readonly buildArgs?: Record<string, Input<string>>;
  readonly registry?: {
    readonly url: Input<string>;
    readonly username?: Input<string>;
    readonly password?: Input<string>;
  };
};

export type ImageReferenceProps = {
  readonly image: string;
  readonly pull?: "always" | "missing" | "never";
};

export type ImageProps = ImageBuildProps | ImageReferenceProps;

export interface Image extends Resource<
  "Docker.Image",
  ImageProps,
  {
    imageRef: string;
    imageId: string;
    mode: "build" | "reference";
    bundleHash?: string;
    dockerfile?: string;
  },
  never,
  Providers
> {}

export const Image = Resource<Image>("Docker.Image");

export const ImageProvider = () =>
  Provider.effect(
    Image,
    Effect.gen(function* () {
      return {
        diff: Effect.fn(function* () {
          return undefined;
        }),
        create: Effect.fn(function* () {
          return yield* Effect.die("Docker.Image create not yet implemented");
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
