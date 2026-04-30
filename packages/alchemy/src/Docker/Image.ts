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
  } else if (pull === "missing") {
    if (!existing) {
      yield* runDockerCommand(["pull", imageRef]);
    }
  } else if (pull === "never") {
    if (!existing) {
      return yield* Effect.fail(
        new Error(
          `Docker.Image: image "${imageRef}" not present locally and pull="never"; refusing to pull`,
        ),
      );
    }
  }

  const resolved = yield* inspect<InspectedImage>("image", imageRef);
  if (!resolved) {
    return yield* Effect.fail(
      new Error(
        `Docker.Image: failed to resolve image id for "${imageRef}" after pull`,
      ),
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
            // pull strategy alone doesn't trigger replace; default update
            // path is fine — but for Mode B there's nothing to actually
            // update on the local daemon (the imageId only changes when
            // image ref changes, which already replaces). Returning
            // undefined lets the engine decide.
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
        update: Effect.fn(function* () {
          return yield* Effect.die(
            "Docker.Image has no in-place update path; diff returns replace for any meaningful change",
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
