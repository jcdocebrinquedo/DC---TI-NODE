'use strict';

const { validationError } = require('../utils/app-error');

/**
 * Valida o nome de computador conforme padrões NetBIOS e DNS do Windows.
 * Mantém paridade com a validação nativa do Rust em hostname.rs.
 * 
 * Regras:
 * - Não vazio
 * - Máx 15 caracteres (NetBIOS)
 * - Não inicia nem termina com hífen (-)
 * - Apenas caracteres alfanuméricos ASCII e hífen
 * - Não composto exclusivamente por números
 * 
 * @param {string} rawName
 * @returns {string} Nome validado e normalizado em maiúsculo
 */
function validateHostname(rawName) {
  if (typeof rawName !== 'string') {
    throw validationError('O nome do computador deve ser um texto válido.');
  }

  const trimmed = rawName.trim().toUpperCase();

  if (!trimmed) {
    throw validationError('O nome do computador não pode ser vazio.');
  }

  if (trimmed.length > 15) {
    throw validationError(
      `O nome '${trimmed}' possui ${trimmed.length} caracteres (máximo permitido pelo NetBIOS: 15).`
    );
  }

  if (trimmed.startsWith('-') || trimmed.endsWith('-')) {
    throw validationError("O nome do computador não pode iniciar ou terminar com hífen ('-').");
  }

  if (!/^[A-Z0-9-]+$/.test(trimmed)) {
    throw validationError(
      "O nome do computador deve conter apenas letras (A-Z), números (0-9) e hífen ('-')."
    );
  }

  if (/^\d+$/.test(trimmed)) {
    throw validationError('O nome do computador não pode ser composto exclusivamente por números.');
  }

  return trimmed;
}

module.exports = { validateHostname };

