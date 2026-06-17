import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3000);

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      service: "canix402",
      status: "ok"
    })
  );
});

server.listen(port, () => {
  // Initial scaffold logger. Replace with structured logging in Part 2+.
  console.log(`canix402 API listening on port ${port}`);
});
