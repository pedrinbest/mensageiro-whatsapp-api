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

async function extrairNumeroReal(message, client = null) {
    if (!message) return '';

    const jid = message.author || message.from || message.to || '';

    // 1. Se tiver o client do whatsapp-web.js, usa o método nativo de resolução de LID -> Telefone
    if (client && typeof client.getContactLidAndPhone === 'function' && jid) {
        try {
            const res = await client.getContactLidAndPhone(jid);
            if (res && res[0] && res[0].pn) {
                return normalizarNumero(res[0].pn);
            }
        } catch (_) {}
    }

    // 2. Tenta através de getContact() do whatsapp-web.js
    try {
        if (typeof message.getContact === 'function') {
            const contact = await message.getContact();
            if (contact) {
                if (contact.number) {
                    return normalizarNumero(contact.number);
                }
                if (contact.id?.user && !contact.id?._serialized?.endsWith('@lid')) {
                    return normalizarNumero(contact.id.user);
                }
            }
        }
    } catch (_) {}

    return extrairNumero(jid);
}

function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { normalizarNumero, extrairNumero, extrairNumeroReal, gerarApiKey, gerarWebhookSecret, aguardar };

