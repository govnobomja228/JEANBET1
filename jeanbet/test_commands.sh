#!/bin/bash

SERVER_URL="https://yourdomain.com"

# 1. Проверка работы сервера
echo "Testing server status..."
curl -s "$SERVER_URL/api/test" | jq

# 2. Создание тестового пользователя
echo -e "\nCreating test user..."
curl -s -X POST "$SERVER_URL/api/test/create-user" \
  -H "Content-Type: application/json" \
  -d '{"userId": 123456}' | jq

# 3. Проверка баланса тестового пользователя
echo -e "\nChecking test user balance..."
curl -s "$SERVER_URL/api/balance/123456" | jq

# 4. Размещение тестовой ставки
echo -e "\nPlacing test bet..."
curl -s -X POST "$SERVER_URL/api/test/place-bet" \
  -H "Content-Type: application/json" \
  -d '{"userId": 123456, "amount": 100, "racerId": 1}' | jq

# 5. Проверка активных ставок
echo -e "\nChecking active bets..."
curl -s "$SERVER_URL/api/admin/active-bets?userId=123456" | jq

# 6. Объявление победителя
echo -e "\nDeclaring winner..."
curl -s -X POST "$SERVER_URL/api/test/declare-winner" \
  -H "Content-Type: application/json" \
  -d '{"winner": 1}' | jq

# 7. Проверка баланса после объявления победителя
echo -e "\nChecking balance after settlement..."
curl -s "$SERVER_URL/api/balance/123456" | jq

# 8. Проверка статистики
echo -e "\nGetting stats..."
curl -s "$SERVER_URL/api/admin/stats?userId=123456" | jq

echo -e "\nTesting completed!"