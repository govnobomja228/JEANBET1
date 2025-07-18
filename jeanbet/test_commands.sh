#!/bin/bash

SERVER_URL="https://yourdomain.com"
USER_ID=123456
AMOUNT=500

echo "Testing deposit endpoint..."

# 1. Делаем тестовое пополнение
response=$(curl -s -X POST "$SERVER_URL/api/test-deposit" \
  -H "Content-Type: application/json" \
  -d '{"userId": '$USER_ID', "amount": '$AMOUNT'}')

echo "Response:"
echo $response | jq

# 2. Проверяем баланс
echo -e "\nChecking balance..."
balance=$(curl -s "$SERVER_URL/api/balance/$USER_ID")
echo $balance | jq