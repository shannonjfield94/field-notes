#!/bin/bash

keys=(
  "woodruff-secor-divorce-1923"
  "woodruff-1920-census-interlachen"
  "simon-mary-marriage-index-1846"
  "simon-davis-headstone-croswell"
  "simon-davis-fold3-military-record"
  "simon-davis-findagrave-memorial-56982096"
  "simon-davis-1870-census-moore-township"
  "rosamond-brown-robert-davis-1930-census-bisbee"
  "rosamond-brown-findagrave-81881643"
  "robert-davis-1940-census-frank-household"
  "mary-davis-1900-census-cripple-creek"
  "mary-davis-1890-veterans-schedule-milan-tn"
  "frank-davis-1930-census-creede"
  "davis-woodruff-marriage-license-1895"
  "davis-woodruff-marriage-index-1895"
  "brown-davis-marriage-license-1894"
  "brown-davis-marriage-index-1894"
)

for key in "${keys[@]}"; do
  echo "=== $key ==="
  grep -A 5 "\"$key\": {" src/_data/sources.json
  echo "--- used in ---"
  grep -rl "$key" src/people/ src/families/ src/journal/ src/notes/ 2>/dev/null
  echo ""
done
