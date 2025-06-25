import express from "express";
import { randomUUID } from "node:crypto";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());

// Request and Response Logger Middleware
app.use((req, res, next) => {
  const requestId = req.headers["mcp-request-id"] || randomUUID().slice(0, 8);
  req.requestId = requestId; // Store requestId on req object for use in other handlers

  // Log request
  console.log(`[${requestId}] ➡️ ${req.method} ${req.originalUrl}`);
  console.log(
    `[${requestId}] 📨 Headers:`,
    JSON.stringify(req.headers, null, 2)
  );
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(
      `[${requestId}] 📝 Request Body:`,
      JSON.stringify(req.body, null, 2)
    );
  }

  // Store response body chunks for logging on finish
  res._responseBodyChunks = [];
  const originalJson = res.json;
  const originalSend = res.send;
  const originalWrite = res.write;
  const originalEnd = res.end;

  // Override json method to capture body before sending
  res.json = function (body) {
    try {
      res._responseBodyChunks.push(JSON.stringify(body, null, 2));
    } catch (e) {
      console.error(`[${requestId}] Error stringifying JSON response:`, e);
      res._responseBodyChunks.push(String(body)); // Fallback
    }
    return originalJson.call(this, body);
  };

  // Override send method to capture body before sending
  res.send = function (body) {
    if (typeof body === "string") {
      res._responseBodyChunks.push(body);
    } else if (Buffer.isBuffer(body)) {
      res._responseBodyChunks.push(body.toString());
    } else {
      try {
        res._responseBodyChunks.push(JSON.stringify(body, null, 2));
      } catch (e) {
        console.error(`[${requestId}] Error stringifying send response:`, e);
        res._responseBodyChunks.push(String(body)); // Fallback
      }
    }
    return originalSend.call(this, body);
  };

  // Override write method for streaming responses (e.g., SSE) to capture chunks
  res.write = function (chunk, encoding, callback) {
    let chunkStr = "";
    if (Buffer.isBuffer(chunk)) {
      chunkStr = chunk.toString(encoding);
    } else if (typeof chunk === "string") {
      chunkStr = chunk;
    } else {
      try {
        chunkStr = JSON.stringify(chunk);
      } catch (e) {
        chunkStr = String(chunk); // Fallback
      }
    }
    console.log(`[${requestId}] 📄 Response Chunk (write):`, chunkStr); // Log chunks as they are written
    res._responseBodyChunks.push(chunkStr); // Store all chunks
    return originalWrite.call(this, chunk, encoding, callback);
  };

  // Override end method. This might be called with the last chunk or just to signal end.
  res.end = function (chunk, encoding, callback) {
    if (chunk) {
      let chunkStr = "";
      if (Buffer.isBuffer(chunk)) {
        chunkStr = chunk.toString(encoding);
      } else if (typeof chunk === "string") {
        chunkStr = chunk;
      } else {
        try {
          chunkStr = JSON.stringify(chunk);
        } catch (e) {
          chunkStr = String(chunk); // Fallback
        }
      }
      console.log(`[${requestId}] 📄 Response Chunk (end):`, chunkStr); // Log last chunk if present
      res._responseBodyChunks.push(chunkStr); // Store last chunk
    }
    return originalEnd.call(this, chunk, encoding, callback);
  };

  // Add response finished logging
  res.on("finish", () => {
    // Consolidate all captured body chunks
    const fullResponseBody = res._responseBodyChunks.join("");
    const requestSuccessful = res.statusCode >= 200 && res.statusCode < 400;

    console.log(`[${requestId}] ⬅️ Final Response:`);
    console.log(`[${requestId}] 📊 Status:`, res.statusCode);
    console.log(`[${requestId}] 📨 Headers:`, res.getHeaders());
    if (fullResponseBody) {
      console.log(`[${requestId}] 📄 Response Body:`, fullResponseBody);
    } else {
      console.log(`[${requestId}] 📄 Response Body: (empty)`);
    }

    if (requestSuccessful) {
      console.log(`[${requestId}] ✅ Request completed successfully`);
    } else {
      console.log(`[${requestId}] ❌ Request completed with errors`);
    }
    console.log("-----------------------------------");
  });

  // Set CORS headers
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, mcp-request-id, mcp-session-id"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");

  next();
});

// Global error handling middleware
app.use((err, req, res, next) => {
  const requestId = req.requestId || randomUUID().slice(0, 8);

  // Log the error with stack trace
  console.error(`[${requestId}] 🔥 Unhandled Error:`, err);
  if (err.stack) {
    console.error(`[${requestId}] 📚 Stack Trace:`, err.stack);
  }

  // Don't send multiple responses
  if (res.headersSent) {
    console.error(
      `[${requestId}] ⚠️ Headers already sent, cannot send error response`
    );
    return next(err);
  }

  // Format the error response based on whether it's an MCP request
  const isMcpRequest = req.originalUrl === "/mcp";
  if (isMcpRequest) {
    res.status(err.status || 500).json({
      jsonrpc: "2.0",
      error: {
        code: err.code || -32000,
        message: err.message || "Internal Server Error",
        data:
          process.env.NODE_ENV === "development"
            ? {
                stack: err.stack,
                details: err,
              }
            : undefined,
      },
      id: req.body?.id || null,
    });
  } else {
    // For non-MCP requests, send a regular error response
    res.status(err.status || 500).json({
      error: {
        message: err.message || "Internal Server Error",
        details: process.env.NODE_ENV === "development" ? err.stack : undefined,
      },
    });
  }

  // Log that we handled the error
  console.log(`[${requestId}] ⚡ Error handled by global error middleware`);
  console.log("-----------------------------------");
});

// Map to store transports by session ID
const transports = {};

const serverInfo = {
  name: "Todo Server",
  version: "1.0.0",
  description: "A Model Context Protocol server for managing todos",
};

const serverConfig = {
  protocolVersion: "2025-03-26",
  capabilities: {
    logging: {
      level: "info",
    },
    tools: {
      registration: true,
      invocation: true,
    },
    streaming: true,
    notifications: true,
  },
};

/**
 * MCP Prompt Examples for Client-Side LLMs:
 *
 * These are examples of user prompts that an external Language Model (LLM)
 * integrated with this MCP server could interpret and use to call the server's
 * registered tools, resources, or explicitly invoke registered prompts.
 *
 * 1.  To get all todos (via tool invocation):
 * "Can you list all my todo items?"
 * "What tasks do I have?"
 * (The LLM would typically call the 'get-todos' tool without the 'completed' parameter)
 *
 * 2.  To get only completed todos (via tool invocation):
 * "Show me my completed tasks."
 * "What todos have I finished?"
 * (The LLM would typically call the 'get-todos' tool with {"completed": true})
 *
 * 3.  To get only incomplete todos (via tool invocation):
 * "What are my pending todos?"
 * "Show me tasks I still need to do."
 * (The LLM would typically call the 'get-todos' tool with {"completed": false})
 *
 * 4.  To get the current time (via resource invocation):
 * "What is the current time?"
 * "Tell me the time."
 * (The LLM would typically fetch the 'todo-manager://current-time' resource)
 *
 * 5.  To get a summary of todos (via registered prompt invocation):
 * "Give me a summary of my tasks."
 * "Summarize my completed todos."
 * "How many incomplete tasks do I have?"
 * (The LLM would typically invoke the 'summarize-todos' prompt, optionally with the 'completed' parameter)
 */

// Handle POST requests for client-to-server communication
app.post("/mcp", async (req, res) => {
  // Check for existing session ID
  const sessionId = req.headers["mcp-session-id"] || undefined;
  const requestId = req.requestId; // Use the requestId we stored earlier
  let transport;

  try {
    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          console.log(
            `[${requestId}] 🔗 New session initialized: ${sessionId}`
          );
          // Store the transport by session ID
          transports[sessionId] = transport;
        },
      });

      transport.onmessage = (message, extra) => {
        const msgId = message.id || randomUUID().slice(0, 8);
        console.log(`[${requestId}:${msgId}] ⬅️ Transport Message:`);
        console.log(
          `[${requestId}:${msgId}] 📄 Message:`,
          JSON.stringify(message, null, 2)
        );
        if (extra) {
          console.log(
            `[${requestId}:${msgId}] 📎 Extra:`,
            JSON.stringify(extra, null, 2)
          );
        }
      };

      transport.onerror = (error) => {
        console.error(`[${requestId}] 🚨 Transport Error:`, error);
        if (transport.sessionId) {
          delete transports[transport.sessionId];
        }
      };

      // Clean up transport when closed
      transport.onclose = () => {
        console.log(
          `[${requestId}] 🔒 Closing session: ${transport.sessionId}`
        );
        if (transport.sessionId) {
          delete transports[transport.sessionId];
        }
      };

      const server = new McpServer(serverInfo, serverConfig);

      // Register the 'get-todos' tool
      server.registerTool(
        "get-todos",
        {
          title: "Get all the todo list",
          description: "Tool to get all the todo list",
          inputSchema: { completed: z.boolean().optional() }, // Use zod for input validation
        },
        async ({ completed }, { authInfo }) => {
          try {
            console.log("====== ListTodos Tool Invoked ======");
            console.log("Completed filter:", completed);

            // Mock todo data
            const allTodos = [
              {
                title: "Buy groceries",
                completed: false,
                createdAt: new Date("2024-01-15T10:00:00Z").toISOString(),
              },
              {
                title: "Walk the dog",
                completed: true,
                createdAt: new Date("2024-01-14T15:30:00Z").toISOString(),
              },
              {
                title: "Read a book",
                completed: false,
                createdAt: new Date("2024-01-16T09:00:00Z").toISOString(),
              },
              {
                title: "Pay bills",
                completed: true,
                createdAt: new Date("2024-01-10T11:45:00Z").toISOString(),
              },
              {
                title: "Call mom",
                completed: false,
                createdAt: new Date("2024-01-17T18:00:00Z").toISOString(),
              },
            ];

            let filteredTodos = allTodos;
            if (typeof completed === "boolean") {
              filteredTodos = allTodos.filter(
                (todo) => todo.completed === completed
              );
            }

            // Create a formatted list of todos
            const todoList = filteredTodos
              .map(
                (todo) =>
                  `• ${todo.title} (${
                    todo.completed ? "✓ Completed" : "□ Incomplete"
                  }) - Created: ${new Date(todo.createdAt).toLocaleString()}`
              )
              .join("\n");

            return {
              content: [
                {
                  type: "text",
                  text: filteredTodos.length
                    ? `Here are your todos:\n${todoList}`
                    : `You don't have any ${
                        typeof completed === "boolean"
                          ? completed
                            ? "completed"
                            : "incomplete"
                          : ""
                      } todos yet.`,
                },
              ],
              result: { todos: filteredTodos }, // Return the filtered array within an object as result
            };
          } catch (error) {
            console.error("Error in get-todos tool:", error);
            throw error;
          }
        }
      );

      // Register a prompt to summarize todos
      server.registerPrompt(
        "summarize-todos",
        {
          title: "Summarize Todos",
          description:
            "Generates a summary of todo items, optionally filtering by completion status.",
          inputSchema: {
            type: "object",
            properties: {
              completed: {
                type: "boolean",
                description:
                  "Filter by completion status (true for completed, false for incomplete). If not provided, summarizes all todos.",
              },
            },
          },
          // This 'messages' array provides a template for a client-side LLM
          // to understand how to formulate a request for this prompt,
          // though the server handler directly processes the inputSchema.
          messages: [
            {
              role: "system",
              content:
                "You are a helpful assistant that summarizes todo lists.",
            },
            {
              role: "user",
              // Example of using Handlebars-like syntax for client-side LLM
              content:
                "{{#if completed}}Please summarize my {{#if completed}}completed{{else}}incomplete{{/if}} todos.{{else}}Please summarize all my todos.{{/if}}",
            },
          ],
        },
        async ({ completed }, { authInfo, context }) => {
          console.log("====== Summarize Todos Prompt Invoked ======");
          console.log("Completed filter for summary:", completed);

          // Call the 'get-todos' tool internally to fetch the data
          const getTodosResult = await this.callTool("get-todos", {
            completed,
          });
          const todos = getTodosResult.todos || []; // Ensure todos is an array

          let summary = "";
          if (todos.length === 0) {
            summary = `You currently have no ${
              typeof completed === "boolean"
                ? completed
                  ? "completed"
                  : "incomplete"
                : ""
            } todos.`;
          } else {
            const completedCount = todos.filter((t) => t.completed).length;
            const incompleteCount = todos.filter((t) => !t.completed).length;

            if (typeof completed === "boolean") {
              if (completed) {
                summary = `You have ${completedCount} completed todo(s).`;
                if (completedCount > 0) {
                  summary += ` These include: ${todos
                    .map((t) => t.title)
                    .join(", ")}.`;
                }
              } else {
                summary = `You have ${incompleteCount} incomplete todo(s).`;
                if (incompleteCount > 0) {
                  summary += ` These include: ${todos
                    .map((t) => t.title)
                    .join(", ")}.`;
                }
              }
            } else {
              summary = `You have a total of ${todos.length} todo(s). ${completedCount} are completed and ${incompleteCount} are incomplete.`;
              if (todos.length > 0) {
                summary += ` Here are a few: ${todos
                  .slice(0, 3)
                  .map((t) => t.title)
                  .join(", ")}${todos.length > 3 ? "..." : ""}.`;
              }
            }
          }

          return {
            content: [
              {
                type: "text",
                text: summary,
              },
            ],
            result: {
              summaryText: summary,
              todosCount: todos.length,
              completedCount,
              incompleteCount,
            },
          };
        }
      );

      // Resource to get the current time
      server.resource(
        "current_time",
        new ResourceTemplate("todo-manager://current-time", {
          list: undefined,
        }), // Renamed URI for clarity
        async (uri) => ({
          contents: [{ uri: uri.href, text: new Date().toLocaleString() }],
        })
      );

      // Connect to the MCP server
      try {
        await server.connect(transport);
        console.log(`[${requestId}] 🚀 Server connected to transport`);
      } catch (error) {
        console.error(
          `[${requestId}] ❌ Failed to connect server to transport:`,
          error
        );
        throw error;
      }
    } else {
      // Invalid request: No session ID or not an initialize request
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "Bad Request: No valid session ID provided or not an initialization request.",
        },
        id: req.body?.id || null,
      });
      return;
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(
      `[${requestId}] ❌ Error handling request in /mcp endpoint:`,
      error
    );
    // Only send error response if one hasn't been sent yet
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Internal Server Error",
        },
        id: req.body?.id || null,
      });
    }
  }
});

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] || undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  const transport = transports[sessionId];
  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error(
      `Error handling session request for ${req.method} ${req.originalUrl}:`,
      error
    );
    if (!res.headersSent) {
      res.status(500).send("Internal Server Error processing session request.");
    }
  }
};

// Handle GET requests for server-to-client notifications via SSE
app.get("/mcp", handleSessionRequest);

// Handle DELETE requests for session termination
app.delete("/mcp", handleSessionRequest);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Test route for error handling
app.get("/test-error", (req, res) => {
  throw new Error("Test error for global error handler");
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 MCP Server running on port ${PORT}`);
});
