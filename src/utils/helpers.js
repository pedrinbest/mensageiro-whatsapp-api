const crypto = require('crypto');

function normalizarNumero(valor) {
    return String(valor || '').replace(/\D/g, '');
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

module.exports = { normalizarNumero, gerarApiKey, gerarWebhookSecret, aguardar };
