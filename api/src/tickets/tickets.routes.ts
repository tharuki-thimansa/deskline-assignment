import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors';
import { toCommentDto } from '../mappers';
import * as ticketsRepository from './tickets.repository';
import * as commentsRepository from '../comments/comments.repository';
import {
  createTicketSchema,
  listTicketsQuerySchema,
  ticketIdParamsSchema,
  updateStatusSchema,
} from './tickets.schema';

export async function ticketRoutes(app: FastifyInstance) {
  app.get('/tickets', async (request) => {
    const filters = listTicketsQuerySchema.parse(request.query);
    return ticketsRepository.listTickets(filters);
  });

  app.get('/tickets/:id', async (request) => {
    const { id } = ticketIdParamsSchema.parse(request.params);
    const ticket = await ticketsRepository.getTicketById(id);
    if (!ticket) {
      throw new AppError(404, `Ticket ${id} not found`);
    }
    const comments = await commentsRepository.listForTicket(id);
    return { ...ticket, comments: comments.map(toCommentDto) };
  });

  app.post('/tickets', async (request, reply) => {
    const input = createTicketSchema.parse(request.body);
    const ticket = await ticketsRepository.createTicket(input);
    return reply.code(201).send(ticket);
  });

  app.patch('/tickets/:id/status', async (request) => {
    const { id } = ticketIdParamsSchema.parse(request.params);
    const { status } = updateStatusSchema.parse(request.body);
    const existing = await ticketsRepository.getTicketById(id);
    if (!existing) {
      throw new AppError(404, `Ticket ${id} not found`);
    }
    await ticketsRepository.updateStatus(id, status);
    return ticketsRepository.getTicketById(id);
  });
}
