import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import { errorHandler } from './errors';
import { ticketRoutes } from './tickets/tickets.routes';
import { userRoutes } from './users/users.routes';

export function buildServer(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });
  app.setErrorHandler(errorHandler);
  app.register(ticketRoutes);
  app.register(userRoutes);
  return app;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const app = buildServer();
  const port = Number(process.env.PORT ?? 3000);
  app.listen({ port, host: '0.0.0.0' }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
