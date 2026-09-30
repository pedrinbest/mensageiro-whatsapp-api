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

function aguardar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { normalizarNumero, extrairNumero, gerarApiKey, gerarWebhookSecret, aguardar };

