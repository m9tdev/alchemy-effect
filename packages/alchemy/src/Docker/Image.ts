import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as crypto from "node:crypto";
import * as Bundle from "../Bundle/Bundle.ts";
import {
  buildAppDockerfile,
  dockerBuild,
  materializeDockerfile,
  pushImage,
  runDockerCommand,
  writeContextFiles,
} from "../Bundle/Docker.ts";
import { isResolved } from "../Diff.ts";
import type { Input } from "../Input.ts";
import { createPhysicalName } from "../PhysicalName.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { inspect, type InspectedImage } from "./Inspect.ts";
import type { Providers } from "./Providers.ts";
import { isStderrMatch } from "./util.ts";

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

const computeRepository = (id: string, props: ImageBuildProps) =>
  Effect.gen(function* () {
    if (props.repository) return props.repository;
    return yield* createPhysicalName({ id, maxLength: 60, lowercase: true });
  });

const NO_SUCH_IMAGE =
  /no such image|image is being used|image not known|unrecognized image (id|name)/i;

const bundleAppImage = Effect.fnUntraced(function* ({
  id,
  props,
}: {
  id: string;
  props: ImageBuildProps;
}) {
  const fs = yield* FileSystem.FileSystem;

  const runtime = props.runtime ?? "bun";
  const repository = yield* computeRepository(id, props);

  // 1. Bundle entrypoint via the shared Rolldown helper.
  const bundleOutput = yield* Bundle.build(
    {
      input: props.main,
      cwd: process.cwd(),
      external: [...(props.external ?? [])],
      platform: "node",
      resolve: {
        conditionNames:
          runtime === "bun"
            ? ["bun", "import", "module", "default"]
            : ["node", "import", "module", "default"],
      },
      treeshake: true,
    },
    {
      format: "esm",
      sourcemap: false,
      minify: true,
      entryFileNames: "index.mjs",
    },
  );

  // 2. Build the Dockerfile content from shared helper.
  const dockerfile = buildAppDockerfile({
    runtime,
    external: props.external ?? [],
    autoInstallExternals: props.autoInstallExternals ?? true,
    base: props.dockerfile,
    entryFile: "index.mjs",
  });

  // 3. Compute content-addressable tag.
  const tag =
    props.tag ??
    (yield* Effect.sync(() =>
      crypto
        .createHash("sha256")
        .update(bundleOutput.hash)
        .update(dockerfile)
        .digest("hex")
        .slice(0, 16),
    ));

  const imageRef = `${repository}:${tag}`;

  // 4. Materialize context dir.
  const root = yield* fs.makeTempDirectory({
    prefix: `alchemy-docker-${id}-`,
  });

  const buildAndInspect = Effect.gen(function* () {
    yield* materializeDockerfile(dockerfile, root);
    yield* writeContextFiles(
      root,
      bundleOutput.files.map((f) => ({
        path: f.path,
        content:
          typeof f.content === "string"
            ? new TextEncoder().encode(f.content)
            : f.content,
      })),
    );

    // 5. docker build
    yield* dockerBuild({
      tag: imageRef,
      context: root,
      platform: props.platform,
      buildArgs: props.buildArgs as Record<string, string> | undefined,
    });

    // 6. Optional registry push.
    if (props.registry) {
      const username = props.registry.username as string | undefined;
      const password = props.registry.password as string | undefined;
      if (!username || !password) {
        return yield* Effect.fail(
          new Error(
            `Docker.Image: registry push requires both username and password (id="${id}")`,
          ),
        );
      }
      const server = props.registry.url as string;
      const pushed = `${server}/${imageRef}`;
      yield* runDockerCommand(["tag", imageRef, pushed]);
      yield* pushImage(pushed, { username, password, server });
    }

    // 7. Inspect for image id.
    const inspected = yield* inspect<{ Id: string }>("image", imageRef);
    if (!inspected) {
      return yield* Effect.fail(
        new Error(`Docker.Image: image ${imageRef} not found after build`),
      );
    }
    return inspected;
  });

  const inspected = yield* buildAndInspect.pipe(
    Effect.ensuring(
      fs.remove(root, { recursive: true }).pipe(Effect.catch(() => Effect.void)),
    ),
  );

  return {
    mode: "build" as const,
    imageRef,
    imageId: inspected.Id,
    bundleHash: bundleOutput.hash,
    dockerfile,
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

          // Both build: replace on repository change, replace on explicit
          // tag change, otherwise rely on the engine's input-prop change
          // detection. Source-content changes are picked up via prop edits
          // (e.g. updating `tag` or `external`); the content-addressable
          // imageRef means a re-bundle with unchanged source is a no-op at
          // the docker layer.
          if (isBuildProps(news) && isBuildProps(olds)) {
            if ((news.repository ?? "") !== (olds.repository ?? "")) {
              return { action: "replace" } as const;
            }
            if ((news.tag ?? "") !== (olds.tag ?? "")) {
              return { action: "replace" } as const;
            }
            return undefined;
          }

          return undefined;
        }),
        create: Effect.fn(function* ({ id, news }) {
          if (!news) {
            return yield* Effect.fail(
              new Error("Docker.Image: missing required props"),
            );
          }
          if (isReferenceProps(news)) {
            return yield* ensureReference(news);
          }
          return yield* bundleAppImage({ id, props: news });
        }),
        update: Effect.fn(function* ({ id, news, output }) {
          if (!news) {
            return yield* Effect.fail(
              new Error("Docker.Image: update called with undefined news"),
            );
          }
          if (isReferenceProps(news)) {
            return yield* ensureReference(news);
          }
          // Mode A update: re-run the bundle/build pipeline. If the source
          // and dockerfile are unchanged, the computed imageRef matches the
          // existing one, docker reuses cached layers, and the result is a
          // structural no-op (same imageRef, same imageId).
          return yield* bundleAppImage({ id, props: news });
        }),
        delete: Effect.fn(function* ({ olds, output }) {
          // Mode A only: remove the image we built. Mode B: pulled reference
          // images are shared with the rest of the daemon and not owned by
          // alchemy, so delete is a no-op.
          if (olds && isBuildProps(olds)) {
            yield* runDockerCommand(["image", "rm", output.imageRef]).pipe(
              Effect.catchTag("DockerCommandError", (e) =>
                isStderrMatch(e, NO_SUCH_IMAGE)
                  ? Effect.void
                  : Effect.fail(e),
              ),
            );
          }
        }),
      };
    }),
  );
