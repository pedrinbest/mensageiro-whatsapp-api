const { z } = require('zod');
const prisma = require('../db/prisma');
const sessionManager = require('../core/SessionManager');
const { iniciarWorker, pararWorker } = require('../core/QueueManager');
const { autorizarInstanciaDoTenant } = require('../middleware/auth');

const criarInstanciaSchema = z.object({
    nome: z.string().min(1).max(255),
    webhookUrl: z.string().url().optional(),
});

async function routes(fastify) {
    // Cria uma instancia no banco e sobe o client (QR sera emitido via evento 'qr')
    fastify.post('/instances', async (req, reply) => {
        const parse = criarInstanciaSchema.safeParse(req.body);

        if (!parse.success) {
            return reply.code(400).send({ erro: parse.error.flatten() });
        }

        const { nome, webhookUrl } = parse.data;
        const sessionPath = `${req.tenant.id}_${Date.now()}`;

        const { gerarWebhookSecret } = require('../utils/helpers');

        const instancia = await prisma.instance.create({
            data: {
                tenantId: req.tenant.id,
                nome,
                webhookUrl,
                webhookSecret: webhookUrl ? gerarWebhookSecret() : null,
                sessionPath,
                status: 'INICIANDO',
            },
        });

        // Nao aguardamos o QR aqui - o client sobe assincronamente.
        // O consumidor deve pollar GET /instances/:id/status ou GET /instances/:id/qr
        sessionManager
            .criarInstancia(instancia.id)
            .then(() => iniciarWorker(instancia.id))
            .catch((erro) => console.error(`Erro ao iniciar instancia ${instancia.id}:`, erro));

        return reply.code(201).send({ instanceId: instancia.id, status: 'INICIANDO' });
    });

    fastify.get('/instances', async (req, reply) => {
        const instancias = await prisma.instance.findMany({
            where: { tenantId: req.tenant.id },
            orderBy: { createdAt: 'desc' },
        });

        return reply.send(
            instancias.map((i) => ({
                id: i.id,
                nome: i.nome,
                numero: i.numero,
                status: sessionManager.estaAtiva(i.id) ? sessionManager.getStatus(i.id) : i.status,
                createdAt: i.createdAt,
            }))
        );
    });

    fastify.get('/instances/:id/status', { preHandler: autorizarInstanciaDoTenant }, async (req, reply) => {
        const status = sessionManager.estaAtiva(req.params.id)
            ? sessionManager.getStatus(req.params.id)
            : req.instancia.status;

        return reply.send({ instanceId: req.params.id, status });
    });

    // Um QR so e util em base64/imagem no mundo real; aqui devolvemos a string
    // crua para o consumidor renderizar (ex: lib qrcode no frontend dele).
    let ultimoQrPorInstancia = new Map();

    sessionManager.on('qr', ({ instanceId, qr }) => {
        ultimoQrPorInstancia.set(instanceId, qr);
    });

    sessionManager.on('ready', async ({ instanceId, numero }) => {
        ultimoQrPorInstancia.delete(instanceId);
        await prisma.instance.update({
            where: { id: instanceId },
            data: { status: 'CONECTADO', numero },
        });
    });

    sessionManager.on('disconnected', async ({ instanceId }) => {
        await prisma.instance
            .update({ where: { id: instanceId }, data: { status: 'DESCONECTADO' } })
            .catch(() => {});
    });

    fastify.get('/instances/:id/qr', { preHandler: autorizarInstanciaDoTenant }, async (req, reply) => {
        const qr = ultimoQrPorInstancia.get(req.params.id);

        if (!qr) {
            return reply.code(404).send({ erro: 'QR nao disponivel (instancia ja conectada ou ainda iniciando).' });
        }

        return reply.send({ qr });
    });

    fastify.delete('/instances/:id', { preHandler: autorizarInstanciaDoTenant }, async (req, reply) => {
        await sessionManager.destruirInstancia(req.params.id);
        await pararWorker(req.params.id);
        await prisma.instance.update({
            where: { id: req.params.id },
            data: { status: 'DESCONECTADO' },
        });

        return reply.send({ status: 'DESCONECTADO' });
    });
}

module.exports = routes;
