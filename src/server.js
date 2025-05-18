import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { todosResource } from './resources/todos.js';
import { createTodoTool } from './tools/createTodo.js';
import { updateTodoTool } from './tools/updateTodo.js';
import { deleteTodoTool } from './tools/deleteTodo.js';
import { listTodosTool } from './tools/listTodos.js';
import { db, initDB } from './config/db.js';
import { z } from 'zod';

// @mcp Create a new todo item with title "Review code changes"

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Request and Response Logger Middleware
app.use((req, res, next) => {
    const requestId = req.headers['mcp-request-id'] || randomUUID().slice(0, 8);
    
    // Log request
    console.log(`[${requestId}] ➡️ ${req.method} ${req.originalUrl}`);
    console.log(`[${requestId}] 📨 Headers:`, JSON.stringify(req.headers, null, 2));
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(`[${requestId}] 📝 Body:`, JSON.stringify(req.body, null, 2));
    }

    // Capture the original methods
    const originalJson = res.json;
    const originalSend = res.send;
    const originalEnd = res.end;

    // Override json method
    res.json = function (body) {
        console.log(`[${requestId}] ⬅️ Response (json):`);
        console.log(`[${requestId}] 📊 Status:`, res.statusCode);
        console.log(`[${requestId}] 📨 Headers:`, res.getHeaders());
        console.log(`[${requestId}] 📄 Body:`, JSON.stringify(body, null, 2));
        return originalJson.call(this, body);
    };

    // Override send method
    res.send = function (body) {
        console.log(`[${requestId}] ⬅️ Response (send):`);
        console.log(`[${requestId}] 📊 Status:`, res.statusCode);
        console.log(`[${requestId}] 📨 Headers:`, res.getHeaders());
        if (body) {
            console.log(`[${requestId}] 📄 Body:`, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
        }
        return originalSend.call(this, body);
    };

    // Override end method for streaming responses
    res.end = function (chunk) {
        if (chunk) {
            console.log(`[${requestId}] ⬅️ Response (end):`);
            console.log(`[${requestId}] 📊 Status:`, res.statusCode);
            console.log(`[${requestId}] 📨 Headers:`, res.getHeaders());
            console.log(`[${requestId}] 📄 Chunk:`, chunk.toString());
        }
        return originalEnd.call(this, chunk);
    };

    // Add response finished logging
    res.on('finish', () => {
        console.log(`[${requestId}] ✅ Request completed`);
        console.log('-----------------------------------');
    });

    next();
});

// Initialize database
await initDB();

// Create MCP server instance with configuration
const server = new McpServer({
    info: {
        name: "Todo Server",
        version: "1.0.0",
        description: "A Model Context Protocol server for managing todos"
    },
    capabilities: {
        logging: { 
            level: "info" 
        }
    }
});

server.tool(
    "createTodo",
    "Create a new todo item",
    { 
        title: z.string().describe("Task title"),
        completed: z.boolean().optional().default(false).describe("Task completion status")
    },
    async ({ title, completed }, { authInfo }) => {
        console.log('====== CreateTodo Tool ======');
        console.log('Title:', title);
        console.log('Completed:', completed);
        
        const todo = await createTodoTool.execute({ title, completed });
        
        return { 
            content: [{ 
                type: "text", 
                text: `Created todo "${title}" (${completed ? 'completed' : 'not completed'})` 
            }],
            result: todo
        };
    }
);

server.tool(
    "listTodos",
    "List all todo items",
    { 
        completed: z.boolean().optional().describe("Filter by completion status")
    },
    async ({ completed }, { authInfo }) => {
        console.log('====== ListTodos Tool ======');
        console.log('Completed filter:', completed);
        
        const todos = await listTodosTool.execute({ completed });
        
        // Create a formatted list of todos
        const todoList = todos.map(todo => 
            `• ${todo.title} (${todo.completed ? '✓' : '□'}) - Created: ${new Date(todo.createdAt).toLocaleString()}`
        ).join('\n');
        
        return { 
            content: [{ 
                type: "text", 
                text: todos.length ? `Here are your todos:\n${todoList}` : "You don't have any todos yet."
            }],
            result: todos
        };
    }
);

server.tool(
    "updateTodo",
    "Update an existing todo",
    { 
        id: z.string().describe("Todo ID to update"),
        title: z.string().optional().describe("New title for the todo"),
        completed: z.boolean().optional().describe("New completion status")
    },
    async ({ id, title, completed }, { authInfo }) => {
        console.log('====== UpdateTodo Tool ======');
        console.log('ID:', id);
        console.log('Title:', title);
        console.log('Completed:', completed);
        
        const todo = await updateTodoTool.execute({ id, title, completed });
        
        return { 
            content: [{ 
                type: "text", 
                text: `Updated todo: ${todo.title} (${todo.completed ? 'completed' : 'not completed'})` 
            }],
            result: todo
        };
    }
);

server.tool(
    "deleteTodo",
    "Delete an existing todo",
    { 
        id: z.string().describe("Todo ID to delete")
    },
    async ({ id }, { authInfo }) => {
        console.log('====== DeleteTodo Tool ======');
        console.log('ID:', id);
        
        const result = await deleteTodoTool.execute({ id });
        
        return { 
            content: [{ 
                type: "text", 
                text: `Todo ${result.deletedTodo ? `"${result.deletedTodo.title}"` : ''} has been deleted` 
            }],
            result
        };
    }
);

server.resource("todos", "todos://{operation}", todosResource.schema, todosResource.fetch);

// Map to store transports by session ID
const transports = new Map();

// Handle POST requests for client-to-server communication
app.post('/mcp', async (req, res) => {
    const requestId = req.headers['mcp-request-id'] || randomUUID();
    const sessionId = req.headers['mcp-session-id'];
    
    console.log(`[${requestId}] 🔍 Request - Method: POST, Session ID:`, sessionId);
    console.log(`[${requestId}] 📝 Request body:`, JSON.stringify(req.body, null, 2));

    // Validate Accept headers
    const acceptHeader = req.headers['accept'] || '';
    if (!acceptHeader.includes('application/json') || !acceptHeader.includes('text/event-stream')) {
        console.log(`[${requestId}] ❌ Invalid Accept header:`, acceptHeader);
        return res.status(406).json({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message: 'Not Acceptable: Client must accept both application/json and text/event-stream'
            },
            id: req.body?.id
        });
    }

    let transport;
    if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId);
        console.log(`[${requestId}] 🔄 Found existing transport for session:`, sessionId);
    } else if (isInitializeRequest(req.body)) {
        console.log(`[${requestId}] 🆕 Creating new transport for initialization request`);
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
                console.log(`[${requestId}] ✨ Session initialized with ID:`, sid);
                if (!transports.has(sid)) {
                    transports.set(sid, transport);
                }
            },
            // Add response logging to transport
            notifyClient: (method, params) => {
                console.log(`[${requestId}] ⬅️ StreamableHTTP Response:`);
                console.log(`[${requestId}] 📨 Method:`, method);
                console.log(`[${requestId}] 📄 Params:`, JSON.stringify(params, null, 2));
            }
        });

        // Log transport messages
        transport.onmessage = (message, extra) => {
            console.log(`[${requestId}] ⬅️ Transport Message:`);
            console.log(`[${requestId}] 📄 Message:`, JSON.stringify(message, null, 2));
            if (extra) {
                console.log(`[${requestId}] 📎 Extra:`, JSON.stringify(extra, null, 2));
            }
        };

        transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid && transports.has(sid)) {
                console.log(`[${requestId}] 🔴 Transport closed for session ${sid}`);
                transports.delete(sid);
            }
        };

        await server.connect(transport);
    } else {
        console.log(`[${requestId}] ❌ Invalid request - no session ID or not initialization request`);
        return res.status(400).json({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message: 'Bad Request: No valid session ID provided'
            },
            id: req.body?.id
        });
    }

    try {
        console.log(`[${requestId}] 🔄 Handling request through transport`);
        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error(`[${requestId}] ❌ Error processing request:`, error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Internal server error',
                    data: { message: error.message }
                },
                id: req.body?.id
            });
        }
    }
});

// Handle SSE endpoint for server-to-client communication
app.get('/mcp', async (req, res) => {
    const requestId = req.headers['mcp-request-id'] || randomUUID();
    const sessionId = req.headers['mcp-session-id'];

    console.log(`[${requestId}] 🔍 Request - Method: GET, Session ID:`, sessionId);

    if (!sessionId || !transports.has(sessionId)) {
        console.log(`[${requestId}] ❌ Invalid or missing session ID`);
        return res.status(400).json({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message: 'Invalid or missing session ID'
            }
        });
    }

    const transport = transports.get(sessionId);

    try {
        console.log(`[${requestId}] 🔄 Setting up SSE connection for session:`, sessionId);
        await transport.handleRequest(req, res);
    } catch (error) {
        console.error(`[${requestId}] ❌ Error setting up SSE connection:`, error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Internal server error',
                    data: { message: error.message }
                }
            });
        }
    }
});

// Handle session termination
app.delete('/mcp', async (req, res) => {
    const requestId = req.headers['mcp-request-id'] || randomUUID();
    const sessionId = req.headers['mcp-session-id'];

    console.log(`[${requestId}] 🔍 Request - Method: DELETE, Session ID:`, sessionId);

    if (!sessionId || !transports.has(sessionId)) {
        console.log(`[${requestId}] ❌ Invalid or missing session ID`);
        return res.status(400).json({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message: 'Invalid or missing session ID'
            }
        });
    }

    try {
        const transport = transports.get(sessionId);
        await transport.handleRequest(req, res);
    } catch (error) {
        console.error(`[${requestId}] ❌ Error handling session termination:`, error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Internal server error',
                    data: { message: error.message }
                }
            });
        }
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        jsonrpc: '2.0',
        error: {
            code: -32000,
            message: 'Not Found'
        }
    });
});

// Global error handler
app.use((err, req, res, next) => {
    const requestId = req.headers['mcp-request-id'] || randomUUID().slice(0, 8);
    console.error(`[${requestId}] ❌ Unhandled error:`, err);

    res.status(500).json({
        jsonrpc: '2.0',
        error: {
            code: -32000,
            message: 'Internal Server Error'
        }
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✨ MCP Todo Server listening on port ${PORT}`);
    console.log(`🌐 Server name: ${server.info?.name || 'unnamed'}`);
    console.log(`📝 Version: ${server.info?.version || '0.0.0'}`);
    
    // Get registered tools and resources
    const registeredTools = ['createTodo', 'listTodos', 'updateTodo', 'deleteTodo'];
    const registeredResources = ['todos'];
    
    console.log(`🔧 Active tools: ${registeredTools.join(', ')}`);
    console.log(`📦 Active resources: ${registeredResources.join(', ')}`);
});