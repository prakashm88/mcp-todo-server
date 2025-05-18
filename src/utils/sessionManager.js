import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// Store active transports
const transports = new Map();

export const createTransport = () => {
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
            transports.set(sessionId, transport);
        }
    });

    transport.onclose = () => {
        if (transport.sessionId) {
            transports.delete(transport.sessionId);
        }
    };

    return transport;
};

export const getTransport = (sessionId) => {
    return transports.get(sessionId);
};

export const removeTransport = (sessionId) => {
    const transport = transports.get(sessionId);
    if (transport) {
        transport.close();
        transports.delete(sessionId);
    }
};