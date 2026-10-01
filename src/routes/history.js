const prisma = require('../db/prisma');
const { autorizarInstanciaDoTenant } = require('../middleware/auth');

async function routes(fastify) {
    fastify.get('/instances/:id/messages', { preHandler: autorizarInstanciaDoTenant }, async (req, reply) => {
        const limit = Math.min(Math.max(Number(req.query?.limit || 50), 1), 200);
        const messages = await prisma.message.findMany({
            where: { instanceId: req.params.id },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
        return reply.send(messages);
    });
}
module.exports = routes;
