// Ignores SIGTERM and keeps a listening socket open, the way a graceful
// shutdown handler that never finishes does. A kill against this process must
// not be reported as successful while the port is still bound.
import http from "node:http";

process.on("SIGTERM", () => {});

const port = Number(process.argv[2]);
http.createServer((req, res) => res.end("still here")).listen(port);
