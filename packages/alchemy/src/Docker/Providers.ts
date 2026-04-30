import * as Layer from "effect/Layer";
import * as Provider from "../Provider.ts";
import { Container, ContainerProvider } from "./Container.ts";
import { Image, ImageProvider } from "./Image.ts";
import { Network, NetworkProvider } from "./Network.ts";
import { Volume, VolumeProvider } from "./Volume.ts";

export class Providers extends Provider.ProviderCollection<Providers>()(
  "Docker",
) {}

export const providers = () =>
  Layer.effect(
    Providers,
    Provider.collection([Container, Image, Network, Volume]),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        ContainerProvider(),
        ImageProvider(),
        NetworkProvider(),
        VolumeProvider(),
      ),
    ),
  );
