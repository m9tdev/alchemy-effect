const port = Number(process.env.PORT ?? 3000);
const server = Bun.serve({
  port,
  fetch() {
    return new Response("ok");
  },
});
console.log(`listening on :${server.port}`);
