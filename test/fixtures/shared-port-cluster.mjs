// Shares one listening port between several processes: the cluster primary
// holds the shared socket and ignores SIGTERM, the workers exit on it. The
// port only frees up when every holder has been signaled.
import cluster from "node:cluster";
import http from "node:http";

cluster.schedulingPolicy = cluster.SCHED_NONE;
const port = Number(process.argv[2]);

if (cluster.isPrimary) {
  process.on("SIGTERM", () => {});
  cluster.fork();
  cluster.fork();
} else {
  process.on("SIGTERM", () => process.exit(0));
  http.createServer((req, res) => res.end("ok")).listen(port);
}
