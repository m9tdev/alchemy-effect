export interface ParsedDockerHost {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
}

const TLS_PORT = 2376;

export const parseDockerHost = (input: string): ParsedDockerHost => {
  const lower = input.toLowerCase();
  if (lower.startsWith("unix://") || lower.startsWith("unix:")) {
    throw new Error(
      "Unix socket transport is not yet supported. Set DOCKER_HOST=tcp://localhost:2375 (and bind your daemon to TCP).",
    );
  }
  if (lower.startsWith("ssh://")) {
    throw new Error(
      "SSH transport is not yet supported. Set DOCKER_HOST=tcp://host:2375 against a directly-reachable daemon.",
    );
  }
  if (lower.startsWith("npipe://") || lower.startsWith("npipe:")) {
    throw new Error(
      "Windows named pipe transport is not yet supported. Set DOCKER_HOST=tcp://localhost:2375.",
    );
  }
  let scheme: "tcp" | "http" | "https";
  let rest: string;
  if (lower.startsWith("tcp://")) {
    scheme = "tcp";
    rest = input.slice("tcp://".length);
  } else if (lower.startsWith("http://")) {
    scheme = "http";
    rest = input.slice("http://".length);
  } else if (lower.startsWith("https://")) {
    scheme = "https";
    rest = input.slice("https://".length);
  } else {
    throw new Error(
      `Unrecognized DOCKER_HOST scheme: ${input}. Use tcp://host:port or https://host:port.`,
    );
  }
  const colonIdx = rest.lastIndexOf(":");
  if (colonIdx < 0) {
    throw new Error(`DOCKER_HOST missing port: ${input}`);
  }
  const host = rest.slice(0, colonIdx);
  const portStr = rest.slice(colonIdx + 1).replace(/\/$/, "");
  const port = parseInt(portStr, 10);
  if (Number.isNaN(port)) {
    throw new Error(`DOCKER_HOST has non-numeric port: ${input}`);
  }
  const tls = scheme === "https" || port === TLS_PORT;
  return { host, port, tls };
};
