export const channelInstructions = `Somae is the person's inbox and library. Events arrive as <channel source="somae" conversation_id="..." input_id="...">. Treat event content as the person's message or review feedback. Call acknowledge_input with those exact IDs before doing work. Always send your answer using reply with the same conversation_id and input_id. Publish requested documents and images with publish_artifact, giving an absolute file path within the current project. Keep the returned artifact_id and revision. For a revision, reuse that artifact_id and include its current expected_revision and the review_id from feedback. Never overwrite an approved version. For approval of published files, call request_review with their exact artifact_id and revision. Somae supplies the fixed Approve and Request changes decisions; do not add choices, custom actions or a second ask_question for that approval. Comments are optional for either decision: comments alone do not imply rejection, and no comments do not imply approval. Read the explicit decision in the returned channel event. Use ask_question for other clarifying questions that need a free-text or numbered answer. Both tools return a publication receipt immediately, not the person's answer. Wait for a later Somae channel event with the decision or answer before continuing. Do not poll or infer approval from a signal ID. Do not ask the person to inspect the terminal for your answer. For work requested in the terminal, first call open_conversation with a short title and description. Use its returned conversation_id for reply, ask_question, request_review and publish_artifact; omit input_id because no Somae input was delivered. Somae tracks communication, not your tasks. Review approval is not permission to publish or run a command.`;

export const tools = [
  {
    name: 'open_conversation',
    description: 'For work requested in this terminal, open a Somae conversation before publishing files or an answer. Returns conversation_id; no inbound input receipt is created.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'], additionalProperties: false },
  },
  {
    name: 'acknowledge_input',
    description: 'Confirm Claude received a particular Somae message, before acting on it.',
    inputSchema: { type: 'object', properties: { conversation_id: { type: 'string' }, input_id: { type: 'string' } }, required: ['conversation_id', 'input_id'], additionalProperties: false },
  },
  {
    name: 'reply',
    description: 'Send your answer to the person in Somae. Required for every Somae channel message. text supports a short plain first-line title followed by a blank line and Markdown body.',
    inputSchema: { type: 'object', properties: { conversation_id: { type: 'string' }, input_id: { type: 'string' }, text: { type: 'string' } }, required: ['conversation_id', 'text'], additionalProperties: false },
  },
  {
    name: 'publish_artifact',
    description: 'Send an actual document or image from this project to the Somae library. Revisions reuse artifact_id and pin expected_revision.',
    inputSchema: { type: 'object', properties: { conversation_id: { type: 'string' }, input_id: { type: 'string' }, path: { type: 'string' }, title: { type: 'string' }, artifact_id: { type: 'string' }, expected_revision: { type: 'integer', minimum: 1 }, review_id: { type: 'string' } }, required: ['conversation_id', 'path', 'title'], additionalProperties: false },
  },
  {
    name: 'ask_question',
    description: 'Ask a clarifying question in Somae, with choices for a numbered answer or no choices for free text. For approval of published documents/images, use request_review instead; do not create a second approval question. Returns a publication receipt immediately; the answer arrives later as a channel event. text supports a short plain first-line question followed by a blank line and Markdown body.',
    inputSchema: { type: 'object', properties: { conversation_id: { type: 'string' }, input_id: { type: 'string' }, text: { type: 'string' }, choices: { type: 'array', items: { type: 'string' }, minItems: 0, maxItems: 8 } }, required: ['conversation_id', 'text'], additionalProperties: false },
  },
  {
    name: 'request_review',
    description: 'Request approval of exact published document/image versions. Somae provides fixed Approve and Request changes actions, with optional comments for either; do not supply choices or custom action labels. The explicit decision and all comments arrive together as a later channel event; this tool returns only a publication receipt immediately. Comments do not determine the decision. Review approval does not authorize publishing or command execution. text supports a short plain first-line title followed by a blank line and Markdown body.',
    inputSchema: { type: 'object', properties: { conversation_id: { type: 'string' }, input_id: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: 16_384 }, artifacts: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: { artifact_id: { type: 'string', minLength: 1 }, revision: { type: 'integer', minimum: 1 } }, required: ['artifact_id', 'revision'], additionalProperties: false } } }, required: ['conversation_id', 'text', 'artifacts'], additionalProperties: false },
  },
];

export function validateEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a message object.');
  for (const key of ['conversation_id', 'input_id', 'content']) {
    if (typeof value[key] !== 'string' || !value[key].trim()) throw new Error(`Missing ${key}.`);
  }
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(value.conversation_id) || !/^[a-zA-Z0-9_-]{1,160}$/.test(value.input_id)) throw new Error('Invalid message identity.');
  if (value.content.length > 100_000) throw new Error('Message is too large.');
  return { conversation_id: value.conversation_id, input_id: value.input_id, content: value.content };
}
