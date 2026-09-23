const { z } = require('zod');
const { enfileirarEnvio } = require('../core/QueueManager');
const { autorizarInstanciaDoTenant } = require('../middleware/auth');
const { normalizarNumero } = require('../utils/helpers');

const enviarMensagemSchema = z.object({
    numero: z.string().min(8),
    mensagem: z.string().min(1),
    tipo: z.enum(['TEXTO', 'NOTIFICACAO', 'TEMPLATE']).optional(),
    delayMs: z.number().int().min(0).optional(),
});

async function routes(fastify) {
    fastify.post(
        '/instances/:id/messages',
        { preHandler: autorizarInstanciaDoTenant },
        async (req, reply) => {
            const parse = enviarMensagemSchema.safeParse(req.body);

            if (!parse.success) {
                return reply.code(400).send({ erro: parse.error.flatten() });
            }

            if (req.instancia.status !== 'CONECTADO') {
                return reply.code(409).send({ erro: 'Instancia nao esta conectada.' });
            }

            const { numero, mensagem, tipo, delayMs } = parse.data;

            const job = await enfileirarEnvio(req.params.id, {
                numero: normalizarNumero(numero),
                mensagem,
                tipo: tipo || 'TEXTO',
                delayMs: delayMs || 0,
            });

            return reply.code(202).send({ jobId: job.id, status: 'ENFILEIRADO' });
        }
    );

    // Envio em lote - reaproveita a mesma fila, cada item vira um job proprio
    const enviarLoteSchema = z.object({
        mensagemTemplate: z.string().min(1), // pode usar {nome}
        delayMs: z.number().int().min(0).default(3000),
        contatos: z
            .array(
                z.object({
                    numero: z.string().min(8),
                    nome: z.string().optional().default(''),
                })
            )
            .min(1),
    });

    fastify.post(
        '/instances/:id/messages/batch',
        { preHandler: autorizarInstanciaDoTenant },
        async (req, reply) => {
            const parse = enviarLoteSchema.safeParse(req.body);

            if (!parse.success) {
                return reply.code(400).send({ erro: parse.error.flatten() });
            }

            if (req.instancia.status !== 'CONECTADO') {
                return reply.code(409).send({ erro: 'Instancia nao esta conectada.' });
            }

            const { mensagemTemplate, delayMs, contatos } = parse.data;
            const jobs = [];

            for (let i = 0; i < contatos.length; i++) {
                const contato = contatos[i];
                const mensagem = mensagemTemplate.replaceAll('{nome}', contato.nome || '');

                const job = await enfileirarEnvio(req.params.id, {
                    numero: normalizarNumero(contato.numero),
                    mensagem,
                    tipo: 'NOTIFICACAO',
                    delayMs: i * delayMs, // escalona os envios respeitando o delay
                });

                jobs.push(job.id);
            }

            return reply.code(202).send({ status: 'ENFILEIRADO', total: jobs.length, jobIds: jobs });
        }
    );
}

module.exports = routes;
