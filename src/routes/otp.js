const { z } = require('zod');
const { enviarOtp, verificarOtp } = require('../core/OtpService');
const { autorizarInstanciaDoTenant } = require('../middleware/auth');
const { normalizarNumero } = require('../utils/helpers');

const enviarSchema = z.object({ numero: z.string().min(8) });
const verificarSchema = z.object({ numero: z.string().min(8), codigo: z.string().min(4).max(10) });

async function routes(fastify) {
    fastify.post(
        '/instances/:id/otp/send',
        { preHandler: autorizarInstanciaDoTenant },
        async (req, reply) => {
            const parse = enviarSchema.safeParse(req.body);

            if (!parse.success) {
                return reply.code(400).send({ erro: parse.error.flatten() });
            }

            if (req.instancia.status !== 'CONECTADO') {
                return reply.code(409).send({ erro: 'Instancia nao esta conectada.' });
            }

            try {
                const { expiraEm } = await enviarOtp(req.params.id, normalizarNumero(parse.data.numero));
                return reply.code(202).send({ status: 'ENVIADO', expiraEm });
            } catch (erro) {
                return reply.code(erro.codigoHttp || 500).send({ erro: erro.message });
            }
        }
    );

    fastify.post(
        '/instances/:id/otp/verify',
        { preHandler: autorizarInstanciaDoTenant },
        async (req, reply) => {
            const parse = verificarSchema.safeParse(req.body);

            if (!parse.success) {
                return reply.code(400).send({ erro: parse.error.flatten() });
            }

            const resultado = await verificarOtp(
                req.params.id,
                normalizarNumero(parse.data.numero),
                parse.data.codigo
            );

            return reply.send(resultado);
        }
    );
}

module.exports = routes;
