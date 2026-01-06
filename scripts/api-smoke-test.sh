#!/bin/bash
# 48hr.email API Smoke Test
# Usage: bash api-smoke-test.sh
#
# This script tests the public API endpoints of https://48hr.email
# It will register, login, check session, get account info, and list inboxes.
#
# NOTE: This will create a test user on the public service. Change the username each run if needed.

BASE_URL="http://localhost:3000/api/v1"
USERNAME="testuser$RANDOM"
PASSWORD="TransientPass123!"
COOKIE_JAR="cookies.txt"

# Print section header with color
function print_section() {
  echo -e "\n==== $1 ===="
}

print_section "Register user ($USERNAME)"
curl -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
  -c "$COOKIE_JAR"

print_section "Login user"
curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" \
  -c "$COOKIE_JAR"

print_section "Get session info"
curl -s -X GET "$BASE_URL/auth/session" \
  -b "$COOKIE_JAR"

print_section "Get account info"
curl -s -X GET "$BASE_URL/account" \
  -b "$COOKIE_JAR"

print_section "List inbox (should be empty)"
curl -s -X GET "$BASE_URL/inbox/$USERNAME@demo.local" \
  -b "$COOKIE_JAR"

print_section "Get mail summaries (public)"
curl -s -X GET "$BASE_URL/inbox/$USERNAME@demo.local"

print_section "Get locks (should be empty)"
curl -s -X GET "$BASE_URL/locks" -b "$COOKIE_JAR"

print_section "Get stats (public)"
curl -s -X GET "$BASE_URL/stats"

print_section "Get config (public)"
curl -s -X GET "$BASE_URL/config/domains"

rm -f "$COOKIE_JAR"
