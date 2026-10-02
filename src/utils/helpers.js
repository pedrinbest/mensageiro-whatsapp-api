const crypto = require('crypto');

function normalizarNumero(valor) {
    return String(valor || '').replace(/\D/g, '');
}

function extrairNumero(jid) {
    if (!jid) return '';
    return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
}

function gerarApiKey() {
    return crypto.randomBytes(32).toString('hex');
}

function gerarWebhookSecret() {
    return crypto.randomBytes(24).toString('hex');
}

async function extrairNumeroReal(message) {
    if (!message) return '';

    try {
        if (typeof message.getContact === 'function') {
            const contact = await message.getContact();
            if (contact) {
                if (contact.number) {
                    return normalizarNumero(contact.number);
                }
                if (contact.id?.user && !contact.id._serialized?.endsWith('@lid')) {
                    return normalizarNumero(contact.id.user);
                }
            }
        }
    } catch (_) {}

    const jid = message.author || message.from || message.to || '';
    return extrairNumero(jid);
}

function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { normalizarNumero, extrairNumero, extrairNumeroReal, gerarApiKey, gerarWebhookSecret, aguardar };

