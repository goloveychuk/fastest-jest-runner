#!/usr/bin/env bash
rm -rf gen
mkdir gen
for i in {1..499}; do
  cp 0.test.js gen/$i.test.js
done
