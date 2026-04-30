import * as Effect from "effect/Effect";
import { runDockerCommand } from "../Bundle/Docker.ts";
import { isResolved } from "../Diff.ts";
import type { Input } from "../Input.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { inspect, type InspectedImage } from "./Inspect.ts";
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

export const isReferenceProps = (p: ImageProps): p is ImageReferenceProps =>
  "image" in p;
export const isBuildProps = (p: ImageProps): p is ImageBuildProps =>
  "main" in p;

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

const ensureReference = Effect.fn(function* (props: ImageReferenceProps) {
  const imageRef = props.image;
  const pull = props.pull ?? "missing";

  const existing = yield* inspect<InspectedImage>("image", imageRef);

  if (pull === "always") {
    yield* runDockerCommand(["pull", imageRef]);
  } else if (pull === "missing" && !existing) {
    yield* runDockerCommand(["pull", imageRef]);
  } else if (pull === "never" && !existing) {
    return yield* Effect.fail(
      new Error(
        `Docker.Image: pull="never" but image "${imageRef}" not present locally`,
      ),
    );
  }

  // Reuse `existing` when we didn't pull; only re-inspect after a pull.
  const resolved =
    pull === "always" || (pull === "missing" && !existing)
      ? yield* inspect<InspectedImage>("image", imageRef)
      : existing;

  if (!resolved) {
    return yield* Effect.fail(
      new Error(`Docker.Image: image "${imageRef}" not found after pull`),
    );
  }

  return {
    mode: "reference" as const,
    imageRef,
    imageId: resolved.Id,
  };
});

export const ImageProvider = () =>
  Provider.effect(
    Image,
    Effect.gen(function* () {
      return {
        stables: ["mode", "imageRef"],
        diff: Effect.fn(function* ({ news, olds }) {
          if (!news || !isResolved(news)) return undefined;
          if (!olds) return undefined;

          const newIsRef = isReferenceProps(news);
          const oldIsRef = isReferenceProps(olds);

          // Switching modes always requires replacement.
          if (newIsRef !== oldIsRef) {
            return { action: "replace" } as const;
          }

          // Both reference: replace when the image ref differs.
          if (newIsRef && oldIsRef) {
            if (news.image !== olds.image) {
              return { action: "replace" } as const;
            }
            // pull: "always" honors the moving tag — re-run create on every
            // diff so imageId refreshes if the registry pushed a new digest
            // under this tag.
            if ((news.pull ?? "missing") === "always") {
              return { action: "update" } as const;
            }
            return undefined;
          }

          // Both build: Phase 5 will fill in real diff logic.
          return undefined;
        }),
        create: Effect.fn(function* ({ news }) {
          if (!news) {
            return yield* Effect.fail(
              new Error("Docker.Image: missing required props"),
            );
          }
          if (isReferenceProps(news)) {
            return yield* ensureReference(news);
          }
          return yield* Effect.fail(
            new Error("Docker.Image: Mode A (build) not yet implemented"),
          );
        }),
        update: Effect.fn(function* ({ news }) {
          if (!news) {
            return yield* Effect.fail(
              new Error("Docker.Image: update called with undefined news"),
            );
          }
          if (isReferenceProps(news)) {
            return yield* ensureReference(news);
          }
          // Mode A update — Phase 5 fills in.
          return yield* Effect.fail(
            new Error(
              "Docker.Image: build mode (Mode A) update not yet implemented",
            ),
          );
        }),
        delete: Effect.fn(function* () {
          // Mode B: pulled reference images are shared with the rest of the
          // daemon and not owned by alchemy, so delete is a no-op. Mode A
          // (build) will own and clean up its own tags in Phase 5.
          return;
        }),
      };
    }),
  );
