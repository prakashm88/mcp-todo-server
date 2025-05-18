// filepath: mcp-todo-server/src/resources/todos.js
import { db } from '../config/db.js';

// Resource schema and implementation
export const todosResource = {
    schema: {
        type: "object",
        properties: {
            id: { type: "string" },
            title: { type: "string" },
            completed: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
        },
        required: ["id", "title", "completed"]
    },
    read: async () => {
        await db.read();
        return db.data.todos;
    }
};