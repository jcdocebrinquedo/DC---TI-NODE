'use strict';

/**
 * Utilitários de data/hora EXCLUSIVAMENTE locais.
 * Regra global do projeto: proibido UTC (toISOString, Date.UTC, getUTC*).
 */

const pad = (n, size = 2) => String(n).padStart(size, '0');

/** dd/MM/yyyy HH:mm:ss (horário local) */
function formatLocalDateTime(date = new Date()) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** yyyyMMdd_HHmmss (horário local) — usado em nomes de arquivo/protocolos */
function localTimestampSlug(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** yyyy-MM-ddTHH:mm:ss SEM sufixo 'Z' (ISO local, ordenável) */
function localIsoString(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

module.exports = { formatLocalDateTime, localTimestampSlug, localIsoString };

