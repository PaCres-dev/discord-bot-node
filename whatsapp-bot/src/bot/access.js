// Política de acceso ÚNICA para todos los comandos: solo mis propios mensajes
// y solo en el chat "Mensaje a mí mismo". El router la aplica antes de cualquier comando.
export function isAllowed(incoming) {
  return incoming.fromMe === true && incoming.isSelfChat === true;
}
