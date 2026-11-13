import { createServer, type Server } from "node:http";
import type { ServiceHealthInterface } from "../../shared/health/interfaces/ServiceHealthInterface.js";

/** Small loopback-only operational endpoint; responses contain no service data. */
export class HealthEndpoint {
  private readonly server: Server;
  private started = false;
  private closed = false;

  constructor(private readonly options: {
    readonly port: number;
    readonly health: ServiceHealthInterface;
    readonly onError: () => void;
  }) {
    this.server = createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      const path = request.url?.split("?", 1)[0];
      if (path !== "/healthz") {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end("{\"status\":\"not_found\"}");
        return;
      }
      if (request.method !== "GET") {
        response.writeHead(405, { "Content-Type": "application/json", Allow: "GET" });
        response.end("{\"status\":\"method_not_allowed\"}");
        return;
      }
      const healthy = options.health.isHealthy();
      response.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
      response.end(healthy ? "{\"status\":\"healthy\"}" : "{\"status\":\"unhealthy\"}");
    });
    this.server.headersTimeout = 5_000;
    this.server.requestTimeout = 5_000;
    this.server.keepAliveTimeout = 5_000;
    this.server.setTimeout(5_000);
    this.server.on("error", () => {
      if (this.started && !this.closed) this.options.onError();
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onListening = (): void => {
        this.server.removeListener("error", onInitialError);
        this.started = true;
        resolve();
      };
      const onInitialError = (): void => {
        this.server.removeListener("listening", onListening);
        reject(new Error("healthcheck_listener_start_failed"));
      };
      this.server.once("listening", onListening);
      this.server.once("error", onInitialError);
      this.server.listen(this.options.port, "127.0.0.1");
    });
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    if (!this.started) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
      this.server.closeAllConnections();
    });
  }
}
