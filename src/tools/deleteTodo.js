import { db } from '../config/db.js';

export const deleteTodoTool = {
    id: 'deleteTodo',
    name: 'Delete Todo',
    description: 'Delete an existing todo item',
    version: '1.0.0',
    type: 'function',
    schema: {
        title: 'Delete Todo',
        type: 'object',
        parameters: {
            type: 'object',
            properties: {
                id: { 
                    type: 'string', 
                    description: 'The ID of the todo to delete' 
                }
            },
            required: ['id']
        },
        returns: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                deletedTodo: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        title: { type: 'string' },
                        completed: { type: 'boolean' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' }
                    }
                }
            },
            required: ['success']
        }
    },
    execute: async (params) => {
        await db.read(); // Ensure we have the latest data
        
        const initialLength = db.data.todos.length;
        const deletedTodo = db.data.todos.find(todo => todo.id === params.id);
        db.data.todos = db.data.todos.filter(todo => todo.id !== params.id);
        await db.write();
        
        return {
            success: db.data.todos.length < initialLength,
            deletedTodo: deletedTodo
        };
    }
};