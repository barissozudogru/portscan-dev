// A plain listener with default signal handling: it dies when SIGTERM
// arrives, which is the common case a kill is expected to succeed on.
import http from "node:http";

const port = Number(process.argv[2]);
http.createServer((req, res) => res.end("ok")).listen(port);
