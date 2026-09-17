// One process hosting two listening ports, the way a dev server serves the
// app on one port and an API, HMR, or debug endpoint on another. A kill
// against either port ends the process and frees both.
import http from "node:http";

const [portA, portB] = process.argv.slice(2).map(Number);
const handler = (req, res) => res.end("ok");
http.createServer(handler).listen(portA);
http.createServer(handler).listen(portB);
