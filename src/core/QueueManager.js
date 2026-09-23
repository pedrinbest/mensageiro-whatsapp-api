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
        filas.set(instanceId, new Queue(`envio:${instanceId}`, { connection }));
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
function iniciarWorker(instanceId, { maxPorJanela = 1, janelaMs = 3000 } = {}) {
    if (workers.has(instanceId)) {
        return workers.get(instanceId);
    }

    const worker = new Worker(
        `envio:${instanceId}`,
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
            limiter: { max: maxPorJanela, duration: janelaMs },
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

module.exports = { enfileirarEnvio, iniciarWorker, pararWorker, getFila };
