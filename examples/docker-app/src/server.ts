const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const sql = new Bun.SQL(databaseUrl);
const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") {
      return new Response("ok");
    }

    if (url.pathname === "/version") {
      const [{ version }] = await sql`select version()`;
      return Response.json({ version });
    }

    if (url.pathname === "/") {
      return new Response("hello from docker-app\n");
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`listening on :${server.port}`);
