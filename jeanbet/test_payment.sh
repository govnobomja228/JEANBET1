#!/bin/bash
SERVER_URL="http://localhost:3000"  # или ваш домен

# 1. Создаем тестового пользователя
echo "Создаем пользователя 1001..."
curl -X POST "$SERVER_URL/api/user" \
  -H "Content-Type: application/json" \
  -d '{"userId": 1001, "username": "test_user"}'

# 2. Проверяем баланс (должен быть 0)
echo -e "\n\nПроверяем баланс:"
curl "$SERVER_URL/api/balance/1001"

# 3. Пополняем на 500
echo -e "\n\nПополняем баланс на 500..."
curl -X POST "$SERVER_URL/api/test-deposit" \
  -H "Content-Type: application/json" \
  -d '{"userId": 1001, "amount": 500}'

# 4. Проверяем баланс (должен быть 500)
echo -e "\n\nПроверяем обновленный баланс:"
curl "$SERVER_URL/api/balance/1001"