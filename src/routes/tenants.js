const { z } = require('zod');
const prisma = require('../db/prisma');
const { gerarApiKey } = require('../utils/helpers');

const criarTenantSchema = z.object({ nome: z.string().min(1).max(255) });

/**
 * Rota protegida por uma chave mestra (ADMIN_KEY no .env), separada da
 * autenticacao normal por tenant. Use apenas internamente / via CLI.
 */
async function routes(fastify) {
    fastify.post('/admin/tenants', async (req, reply) => {
        const chaveAdmin = req.headers['x-admin-key'];

        if (!chaveAdmin || chaveAdmin !== process.env.ADMIN_KEY) {
            return reply.code(401).send({ erro: 'Chave administrativa invalida.' });
        }

        const parse = criarTenantSchema.safeParse(req.body);

        if (!parse.success) {
            return reply.code(400).send({ erro: parse.error.flatten() });
        }

        const tenant = await prisma.tenant.create({
            data: { nome: parse.data.nome, apiKey: gerarApiKey() },
        });

        return reply.code(201).send({ tenantId: tenant.id, apiKey: tenant.apiKey });
    });
}

module.exports = routes;
