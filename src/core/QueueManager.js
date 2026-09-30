const { Queue, Worker } = require('bullmq');
const sessionManager = require('./SessionManager');
const prisma = require('../db/prisma');

const connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
};

const filas = new Map();   // instanceId -> Queue
const workers = new Map(); // instanceId -> Worker

function getFila(instanceId) {
    if (!filas.has(instanceId)) {
        filas.set(instanceId, new Queue(`envio_${instanceId}`, { connection }));
    }
    return filas.get(instanceId);
}

/**
 * Enfileira um envio para UMA instancia especifica. Nunca existe fila global:
 * isso evita que um numero lento ou banido atrase o backlog de outro.
 */
async function enfileirarEnvio(instanceId, { numero, mensagem, tipo = 'TEXTO', delayMs = 0 }) {
    const fila = getFila(instanceId);

    return fila.add(
        'enviar-mensagem',
        { instanceId, numero, mensagem, tipo },
        {
            delay: delayMs,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 100,
            removeOnFail: 500,
        }
    );
}

/**
 * Sobe um Worker dedicado para a instancia, com rate limit proprio.
 * Chame apos a instancia ficar CONECTADO.
 */
function iniciarWorker(instanceId, { maxPorJanela = 2, janelaMs = 1000 } = {}) {
    if (workers.has(instanceId)) {
        return workers.get(instanceId);
    }

    const maxEnvios = Number(process.env.RATE_LIMIT_MAX || maxPorJanela);
    const duracaoEnvio = Number(process.env.RATE_LIMIT_DURATION_MS || janelaMs);

    const worker = new Worker(
        `envio_${instanceId}`,
        async (job) => {
            const { numero, mensagem, tipo } = job.data;
            const client = sessionManager.getClient(instanceId);

            const chatId = await client.getNumberId(numero);

            if (!chatId) {
                await registrarMensagem(instanceId, {
                    numeroDestino: numero,
                    tipo,
                    conteudo: mensagem,
                    status: 'FALHA',
                    erro: 'Numero invalido ou sem WhatsApp',
                });
                throw new Error(`Numero invalido: ${numero}`);
            }

            const enviado = await client.sendMessage(chatId._serialized, mensagem);

            await registrarMensagem(instanceId, {
                numeroDestino: numero,
                tipo,
                conteudo: mensagem,
                status: 'ENVIADA',
                externalId: enviado.id._serialized,
            });

            return { externalId: enviado.id._serialized };
        },
        {
            connection,
            limiter: { max: maxEnvios, duration: duracaoEnvio },
        }
    );

    worker.on('failed', (job, err) => {
        console.error(`[fila:${instanceId}] job ${job?.id} falhou:`, err.message);
    });

    workers.set(instanceId, worker);
    return worker;
}

async function pararWorker(instanceId) {
    const worker = workers.get(instanceId);
    if (worker) {
        await worker.close();
        workers.delete(instanceId);
    }
}

async function pararFila(instanceId) {
    await pararWorker(instanceId).catch(() => {});
    const fila = filas.get(instanceId);
    if (fila) {
        await fila.close().catch(() => {});
        filas.delete(instanceId);
    }
}

async function registrarMensagem(instanceId, dados) {
    try {
        await prisma.message.create({
            data: {
                instanceId,
                direcao: 'ENVIADA',
                ...dados,
            },
        });
    } catch (error) {
        console.error('Erro ao registrar mensagem:', error.message);
    }
}

module.exports = { enfileirarEnvio, iniciarWorker, pararWorker, pararFila, getFila };

