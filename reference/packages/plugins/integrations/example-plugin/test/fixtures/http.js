import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout } from "node:timers/promises";

export async function startHttpFixture(t) {
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push(request.url);

    if (request.url === "/disconnect") {
      request.socket.destroy();

      return;
    }

    if (request.url === "/delayed") {
      await setTimeout(80);
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("delayed response: \u03bb \uD83C\uDF10");

      return;
    }

    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/delayed" });
      response.end("redirect");

      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));

  return { origin: `http://127.0.0.1:${server.address().port}`, requests };
}
