const prisma = require('../db/prisma');
const { enfileirarEnvio } = require('./QueueManager');

const EXPIRACAO_MINUTOS = 5;
const MAX_TENTATIVAS = 5;
const MAX_ENVIOS_POR_JANELA = 3;
const JANELA_ANTI_ABUSO_MINUTOS = 10;

function gerarCodigo() {
    return String(Math.floor(100000 + Math.random() * 900000)); // 6 digitos
}

/**
 * Gera, persiste e enfileira o envio de um OTP.
 * Aplica rate-limit por (instanceId, numero) para evitar abuso
 * (ex: alguem gerando 50 codigos pro mesmo telefone).
 */
async function enviarOtp(instanceId, numero) {
    const desde = new Date(Date.now() - JANELA_ANTI_ABUSO_MINUTOS * 60 * 1000);

    const enviosRecentes = await prisma.otpCode.count({
        where: { instanceId, numero, createdAt: { gte: desde } },
    });

    if (enviosRecentes >= MAX_ENVIOS_POR_JANELA) {
        const erro = new Error('Limite de envios de OTP atingido. Tente novamente mais tarde.');
        erro.codigoHttp = 429;
        throw erro;
    }

    const codigo = gerarCodigo();
    const expiraEm = new Date(Date.now() + EXPIRACAO_MINUTOS * 60 * 1000);

    await prisma.otpCode.create({
        data: { instanceId, numero, codigo, expiraEm },
    });

    await enfileirarEnvio(instanceId, {
        numero,
        tipo: 'OTP',
        mensagem: `Seu codigo de verificacao e: ${codigo}\nValido por ${EXPIRACAO_MINUTOS} minutos. Nao compartilhe com ninguem.`,
    });

    return { expiraEm };
}

/**
 * Valida um codigo informado. Marca como usado ao acertar; incrementa
 * tentativas ao errar e bloqueia apos MAX_TENTATIVAS.
 */
async function verificarOtp(instanceId, numero, codigoInformado) {
    const registro = await prisma.otpCode.findFirst({
        where: { instanceId, numero, usado: false },
        orderBy: { createdAt: 'desc' },
    });

    if (!registro) {
        return { valido: false, motivo: 'NENHUM_CODIGO_PENDENTE' };
    }

    if (registro.expiraEm < new Date()) {
        return { valido: false, motivo: 'EXPIRADO' };
    }

    if (registro.tentativas >= MAX_TENTATIVAS) {
        return { valido: false, motivo: 'MAX_TENTATIVAS_EXCEDIDO' };
    }

    if (registro.codigo !== String(codigoInformado)) {
        await prisma.otpCode.update({
            where: { id: registro.id },
            data: { tentativas: { increment: 1 } },
        });
        return { valido: false, motivo: 'CODIGO_INCORRETO' };
    }

    await prisma.otpCode.update({
        where: { id: registro.id },
        data: { usado: true },
    });

    return { valido: true };
}

module.exports = { enviarOtp, verificarOtp };
