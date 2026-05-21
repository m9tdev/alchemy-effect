#!/usr/bin/env bash
# Reads a registry on stdin, prints {"ServerURL","Username","Secret"} JSON on stdout.
read -r registry
printf '{"ServerURL":"%s","Username":"mock-user","Secret":"mock-secret"}\n' "$registry"
