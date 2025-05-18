import { db } from '../config/db.js';

export const updateTodoTool = {
    id: 'updateTodo',
    name: 'Update Todo',
    description: 'Update an existing todo item by ID with new title and/or completion status',
    version: '1.0.0',
    type: 'function',
    inputSchema: {
        type: 'object',
        properties: {
            id: { 
                type: 'string', 
                description: 'The ID of the todo to update' 
            },
            title: { 
                type: 'string', 
                description: 'The new title of the todo' 
            },
            completed: { 
                type: 'boolean', 
                description: 'Whether the todo is completed' 
            }
        },
        required: ['id']
    },
    outputSchema: {
        type: 'object',
        properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            completed: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
        },
        required: ['id', 'title', 'completed', 'createdAt', 'updatedAt']
    },
    execute: async (params) => {
        await db.read(); // Ensure we have the latest data
        
        const todoIndex = db.data.todos.findIndex(todo => todo.id === params.id);
        if (todoIndex === -1) {
            throw new Error(`Todo with ID ${params.id} not found`);
        }
        
        const updatedTodo = {
            ...db.data.todos[todoIndex],
            title: params.title !== undefined ? params.title : db.data.todos[todoIndex].title,
            completed: params.completed !== undefined ? params.completed : db.data.todos[todoIndex].completed,
            updatedAt: new Date().toISOString()
        };
        
        db.data.todos[todoIndex] = updatedTodo;
        await db.write();
        
        return updatedTodo;
    }
};