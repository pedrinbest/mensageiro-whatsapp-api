const prisma = require('../db/prisma');
const { gerarApiKey } = require('../utils/helpers');

function validarAdmin(request, reply) {
    const chaveAdmin = request.headers['x-admin-key'];
    if (!chaveAdmin || chaveAdmin !== process.env.ADMIN_KEY) {
        reply.code(401).send({ erro: 'Chave administrativa invalida.' });
        return false;
    }
    return true;
}

async function routes(fastify) {
    fastify.get('/admin/tenants', async (req, reply) => {
        if (!validarAdmin(req, reply)) return;
        const tenants = await prisma.tenant.findMany({
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { instances: true } } },
        });
        return reply.send(tenants.map(t => ({
            id: t.id,
            nome: t.nome,
            apiKey: t.apiKey,
            ativo: t.ativo,
            instances: t._count.instances,
            createdAt: t.createdAt,
        })));
    });

    fastify.post('/admin/tenants', async (req, reply) => {
        if (!validarAdmin(req, reply)) return;
        const nome = String(req.body?.nome || '').trim();
        if (!nome || nome.length > 255) {
            return reply.code(400).send({ erro: 'Informe um nome valido para o tenant.' });
        }
        const tenant = await prisma.tenant.create({
            data: { nome, apiKey: gerarApiKey() },
        });
        return reply.code(201).send({
            tenantId: tenant.id,
            nome: tenant.nome,
            apiKey: tenant.apiKey,
            ativo: tenant.ativo,
        });
    });

    fastify.patch('/admin/tenants/:id', async (req, reply) => {
        if (!validarAdmin(req, reply)) return;
        const id = req.params.id;
        const tenant = await prisma.tenant.update({
            where: { id },
            data: {
                ...(req.body?.nome !== undefined ? { nome: String(req.body.nome).trim() } : {}),
                ...(req.body?.ativo !== undefined ? { ativo: Boolean(req.body.ativo) } : {}),
            },
        }).catch(() => null);
        if (!tenant) return reply.code(404).send({ erro: 'Tenant nao encontrado.' });
        return reply.send(tenant);
    });

    fastify.post('/admin/tenants/:id/regenerate-key', async (req, reply) => {
        if (!validarAdmin(req, reply)) return;
        const tenant = await prisma.tenant.update({
            where: { id: req.params.id },
            data: { apiKey: gerarApiKey() },
        }).catch(() => null);
        if (!tenant) return reply.code(404).send({ erro: 'Tenant nao encontrado.' });
        return reply.send({ tenantId: tenant.id, apiKey: tenant.apiKey });
    });
}

module.exports = routes;
