const { z } = require('zod');
const prisma = require('../db/prisma');
const sessionManager = require('../core/SessionManager');
const { iniciarWorker, pararFila } = require('../core/QueueManager');
const { autorizarInstanciaDoTenant } = require('../middleware/auth');

const criarInstanciaSchema = z.object({
    nome: z.string().min(1).max(255),
    webhookUrl: z.string().url().optional(),
});

// ──────────────────────────────────────────────────────────────────────────────
// Listeners registrados UMA UNICA VEZ no escopo do modulo.
// Registrar dentro de routes() causaria listeners duplicados a cada
// fastify.register(), pois a funcao e chamada multiplas vezes.
// ──────────────────────────────────────────────────────────────────────────────

// Map em escopo de modulo: persiste enquanto o processo estiver no ar.
const ultimoQrPorInstancia = new Map();

sessionManager.on('qr', ({ instanceId, qr }) => {
    ultimoQrPorInstancia.set(instanceId, qr);
});

sessionManager.on('ready', async ({ instanceId, numero }) => {
    ultimoQrPorInstancia.delete(instanceId);
    await prisma.instance.update({
        where: { id: instanceId },
        data: { status: 'CONECTADO', numero },
    }).catch((err) => console.error(`Erro ao atualizar status CONECTADO (${instanceId}):`, err.message));
});

sessionManager.on('disconnected', async ({ instanceId }) => {
    await prisma.instance
        .update({ where: { id: instanceId }, data: { status: 'DESCONECTADO' } })
        .catch(() => {});
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
    fastify.get('/instances/:id/qr', { preHandler: autorizarInstanciaDoTenant }, async (req, reply) => {
        const qr = ultimoQrPorInstancia.get(req.params.id);

        if (!qr) {
            return reply.code(404).send({ erro: 'QR nao disponivel (instancia ja conectada ou ainda iniciando).' });
        }

        return reply.send({ qr });
    });

    fastify.put('/instances/:id', { preHandler: autorizarInstanciaDoTenant }, async (req, reply) => {
        const { webhookUrl, nome } = req.body || {};
        const data = {};
        if (webhookUrl !== undefined) data.webhookUrl = webhookUrl;
        if (nome !== undefined) data.nome = nome;

        const instancia = await prisma.instance.update({
            where: { id: req.params.id },
            data,
        });

        return reply.send(instancia);
    });

    fastify.delete('/instances/:id', { preHandler: autorizarInstanciaDoTenant }, async (req, reply) => {
        const instanceId = req.params.id;

        try {
            // 1. Encerra a sessão WhatsApp
            await sessionManager.destruirInstancia(instanceId).catch((err) => {
                console.warn(`[Aviso] Falha ao destruir sessão WhatsApp (${instanceId}):`, err.message);
            });

            // 2. Para e remove a fila BullMQ da instância
            await pararFila(instanceId).catch((err) => {
                console.warn(`[Aviso] Falha ao parar fila BullMQ (${instanceId}):`, err.message);
            });

            // 3. Remove dados temporários da memória
            ultimoQrPorInstancia.delete(instanceId);

            // 4 & 5. Remove registros dependentes e a instância de forma atômica
            await prisma.$transaction([
                prisma.message.deleteMany({ where: { instanceId } }),
                prisma.otpCode.deleteMany({ where: { instanceId } }),
                prisma.conversationState.deleteMany({ where: { instanceId } }),
                prisma.instance.delete({ where: { id: instanceId } }),
            ]);

            return reply.send({
                sucesso: true,
                status: 'DELETADO',
                id: instanceId,
                mensagem: 'Instância e registros vinculados excluídos com sucesso.',
            });
        } catch (erro) {
            console.error(`Erro ao deletar instancia ${instanceId}:`, erro);
            return reply.code(500).send({
                sucesso: false,
                erro: 'Falha ao excluir a instância no banco de dados.',
                detalhes: erro.message,
            });
        }
    });
}

module.exports = routes;
