#!/bin/bash

echo "Testing DDJEX Server API..."
echo ""

echo "1. GET /api/items:"
curl -s http://localhost:3456/api/items
echo ""
echo ""

echo "2. GET /api/items/1:"
curl -s http://localhost:3456/api/items/1
echo ""
echo ""

echo "3. POST /api/items:"
curl -s -X POST -H "Content-Type: application/json" -d '{"name":"New Item"}' http://localhost:3456/api/items
echo ""
echo ""

echo "4. GET /api/items (after POST):"
curl -s http://localhost:3456/api/items
echo ""
echo ""

echo "5. DELETE /api/items/1:"
curl -s -X DELETE http://localhost:3456/api/items/1
echo ""
echo ""

echo "6. GET /api/items (after DELETE):"
curl -s http://localhost:3456/api/items
echo ""
