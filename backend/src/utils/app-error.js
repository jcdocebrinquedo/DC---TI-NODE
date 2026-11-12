'use strict';

/** Erro de aplicação com código padronizado e status HTTP associado. */
class AppError extends Error {
  /**
   * @param {string} code    Código estável (ex.: E_VALIDATION, E_NOT_ELEVATED)
   * @param {string} message Mensagem amigável em português
   * @param {number} [status]
   * @param {object} [details]
   */
  constructor(code, message, status, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status || statusFromCode(code);
    this.details = details;
  }
}

/** Mapeamento dos códigos do core nativo/Node para status HTTP. */
function statusFromCode(code) {
  switch (code) {
    case 'E_VALIDATION':
    case 'E_INVALID_PARAMS':
      return 422;
    case 'E_NOT_ELEVATED':
      return 403;
    case 'E_UNAUTHORIZED':
      return 401;
    case 'E_NOT_FOUND':
      return 404;
    case 'E_BUSY':
      return 409;
    case 'E_UNKNOWN_METHOD':
      return 501;
    case 'E_TIMEOUT':
      return 504;
    case 'E_CORE_UNAVAILABLE':
    case 'E_CORE_EXITED':
      return 503;
    default:
      return 500;
  }
}

/** Erro de validação com lista de campos inválidos. */
function validationError(message, fields) {
  return new AppError('E_VALIDATION', message, 422, fields ? { fields } : undefined);
}

module.exports = { AppError, statusFromCode, validationError };

