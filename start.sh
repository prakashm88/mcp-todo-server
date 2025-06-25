#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Enable debugging for MCP Protocol
export DEBUG=mcp:*,mcpp:*

# Enable debugging for Express
export DEBUG=express:*,$DEBUG

# Enable Node.js inspector
export NODE_OPTIONS='--inspect'

# Set logging level to debug
export LOG_LEVEL=debug

echo -e "${BLUE}Starting server with debugging enabled:${NC}"
echo -e "${GREEN}• MCP Protocol debugging: enabled${NC}"
echo -e "${GREEN}• Express debugging: enabled${NC}"
echo -e "${GREEN}• Node.js inspector: enabled on default port (9229)${NC}"
echo -e "${GREEN}• Log level: debug${NC}"
echo -e "${BLUE}Open chrome://inspect in Chrome to access the debugger${NC}\n"

# Clear terminal and start the server
clear && NODE_ENV=development node  --trace-warnings src/server.js 