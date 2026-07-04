import type { FastifyInstance } from 'fastify';
import * as usersRepository from './users.repository';

export async function userRoutes(app: FastifyInstance) {
  app.get('/users', async () => {
    return usersRepository.listUsers();
  });
}
