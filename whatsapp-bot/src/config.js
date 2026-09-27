// Única fuente de configuración: ningún otro archivo lee process.env
// (salvo proxy.js, que usa las variables estándar HTTPS_PROXY / NO_PROXY).
export function loadConfig(env = process.env) {
  const phoneNumber = (env.PHONE_NUMBER || '').replace(/\D/g, '');
  if (phoneNumber && !/^\d{8,15}$/.test(phoneNumber)) {
    throw new Error('PHONE_NUMBER inválido: usa código de país y sin + (ej. 5491122334455).');
  }
  return Object.freeze({
    phoneNumber,
    authDir: env.AUTH_DIR || './auth',
    logLevel: env.LOG_LEVEL || 'warn',
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    // Cuenta de X para !twitter. Solo se usa para el primer inicio de sesión; después
    // alcanza con la sesión guardada en authDir. Nunca se muestra en los registros.
    x: Object.freeze({
      username: env.X_USERNAME || '',
      password: env.X_PASSWORD || '',
      email: env.X_EMAIL || '',
    }),
    // Fijo en el código a propósito: todos los comandos empiezan con "!".
    prefix: '!',
  });
}
