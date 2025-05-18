import { randomUUID } from 'node:crypto';
import { db } from '../config/db.js';

export const createTodoTool = {
    id: 'createTodo',
    name: 'Create Todo',
    description: 'Create a new todo item with a title and optional completion status',
    version: '1.0.0',
    type: 'function',
    inputSchema: {
        type: 'object',
        properties: {
            title: { 
                type: 'string', 
                description: 'The title of the todo' 
            },
            completed: { 
                type: 'boolean', 
                description: 'Whether the todo is completed', 
                default: false 
            }
        },
        required: ['title']
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
        console.log('====== CreateTodo Execute ======');
        console.log('Raw params:', params);
        console.log('typeof params:', typeof params);
        console.log('params keys:', Object.keys(params));
        console.log('================================');

        await db.read(); // Ensure we have the latest data

        const todo = {
            id: randomUUID(),
            title: params.title || 'Untitled Todo',
            completed: params.completed ?? false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Initialize todos array if it doesn't exist
        if (!db.data.todos) {
            db.data.todos = [];
        }
        
        db.data.todos.push(todo);
        await db.write();

        console.log('Created todo:', todo);

        return todo;
    }
};