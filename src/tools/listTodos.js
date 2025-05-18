import { db } from '../config/db.js';

export const listTodosTool = {
    id: 'listTodos',
    name: 'List Todos',
    description: 'List all todo items',
    version: '1.0.0',
    type: 'function',
    inputSchema: {
        type: 'object',
        properties: {
            completed: { 
                type: 'boolean', 
                description: 'Filter by completion status',
                optional: true
            }
        }
    },
    execute: async (params) => {
        await db.read(); // Ensure we have the latest data
        let todos = db.data.todos || [];
        
        if (params.completed !== undefined) {
            todos = todos.filter(todo => todo.completed === params.completed);
        }
        
        return todos;
    }
};
