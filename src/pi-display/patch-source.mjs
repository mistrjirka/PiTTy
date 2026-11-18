/** Patch only Pi's unbundled RPC handler, never Pi's persisted messages. */
export function patchPiRpcSource(original, helperUrl) {
  const getMessages = /case\s+"get_messages":\s*\{\s*return success\(id,\s*"get_messages",\s*\{\s*messages:\s*session\.messages\s*\}\s*\);\s*\}/g;
  const liveEvent = "output(toJsonEvent(event));";
  const matches = [...original.matchAll(getMessages)];
  if (matches.length !== 1 || original.split(liveEvent).length !== 2 || original.includes('case "get_display_messages":')) return undefined;
  const newCase = `case "get_display_messages": {\n                return success(id, "get_display_messages", { messages: __pittyDisplayMessages(session.messages) });\n            }\n            `;
  return `import { displayMessages as __pittyDisplayMessages, displayEvent as __pittyDisplayEvent } from ${JSON.stringify(helperUrl)};\n`
    + original.replace(getMessages, (old) => newCase + old).replace(liveEvent, "output(__pittyDisplayEvent(toJsonEvent(event)));");
}
